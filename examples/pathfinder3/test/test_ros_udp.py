"""Real ROS2 -> bridge -> UDP round trips, with no AstroForge process or imports."""
from contextlib import ExitStack
import json
from pathlib import Path
import socket
import time
import pytest
import rclpy
from rclpy.parameter import Parameter
from rclpy.executors import SingleThreadedExecutor
from pylon_bridge.udp_bridge import PyLoNBridge, parse_args
from pathfinder3.node import OrbitController


class Peer:
    def __init__(self):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(('127.0.0.1', 0))
        self.socket.setblocking(False)
        self.destination = None
        self.sequence, self.generation = 0, 1
        self.commands = []
        self.state, self.owner, self.lease = 0, '', ''
        self.reply, self.available = True, True
        self.next_emit = 0.
        self.landed = True
        self.separated = self.flameout = False

    def packet(self, kind, **values):
        return dict(type=kind, version=1, runtimeInstance='fixture', runtimeGeneration=self.generation,
                    runtimeEpoch=f'epoch-{self.generation}', runtimeVesselId='vessel', vesselId='vessel',
                    observationSequence=self.sequence, universalTime=self.sequence*.05, **values)

    def send(self, packet):
        self.socket.sendto(json.dumps(packet).encode(), self.destination)

    def authority(self):
        self.send(self.packet('pylon_control_authority_state', state=self.state,
            controllerId=self.owner, leaseId=self.lease, priority=1, leaseRemainingSeconds=2.,
            lastSequence=0, reason='lease_acquired' if self.state else 'idle'))

    def telemetry(self):
        self.sequence += 1
        self.send(self.packet('pylon_session', available=self.available, vesselName='arbitrary rocket',
            realtimeSinceStartup=self.sequence*.05, paused=False, packed=False, warpRate=1., physicsWarp=False))
        if self.reply:
            self.authority()
        flight = self.packet('pylon_flight_state', bodyName='Earth', altitudeAsl=15., altitudeAgl=15.,
            latitude=0., longitude=0., mass=15000., liquidFuel=100., oxidizer=100., electricCharge=800.,
            gravity=9.81, bodyRadius=6371000., gravitationalParameter=3.986e14, atmosphereDepth=150000.,
            apoapsis=15., periapsis=-6000000., timeToApoapsis=0., verticalSpeed=0., horizontalSpeed=0.,
            dynamicPressure=0., landed=self.landed, splashed=False, upBody=[1,0,0], eastBody=[0,1,0],
            northBody=[0,0,1], surfaceVelocityBody=[0,0,0], orbitalVelocityBody=[0,465,0], angularVelocityBody=[0,0,0])
        engines = [self.packet('pylon_actuator_state', actuatorType='engine', name=name,
            enabled=False, operational=(self.separated if name == 'second' else not self.flameout),
            flameout=self.flameout and name == 'first', throttle=0., thrust=0.,
            maxThrust=80000. if name == 'second' and self.separated else 350000., commandActive=False,
            gimbalAvailable=True, gimbalCommandActive=False, gimbalPitch=0., gimbalYaw=0., gimbalRoll=0.)
            for name in ['first', 'second']]
        rings = [self.packet('pylon_actuator_state', actuatorType='separation', name='ring',
            mechanism='decoupler', available=True, separated=self.separated)]
        self.send(self.packet('pylon_control_snapshot', flight=flight, engines=engines, separations=rings))

    def pump(self, emit=True):
        if emit and time.monotonic() >= self.next_emit:
            self.telemetry()
            self.next_emit = time.monotonic()+.05
        while True:
            try:
                raw, _ = self.socket.recvfrom(65535)
            except BlockingIOError:
                break
            p = json.loads(raw)
            self.commands.append(p)
            assert p['runtimeInstance'] == 'fixture'
            assert p['vesselId'] == 'vessel'
            if p['type'] == 'pylon_control_authority_command' and self.reply:
                if p['action'] == 'release':
                    self.state, self.owner, self.lease = 0, '', ''
                else:
                    self.state, self.owner, self.lease = 1, p['controllerId'], p['leaseId']
                self.authority()


@pytest.fixture
def connection(tmp_path):
    with ExitStack() as cleanup:
        rclpy.init()
        cleanup.callback(rclpy.shutdown)
        peer = Peer()
        cleanup.callback(peer.socket.close)
        bridge = PyLoNBridge(parse_args(['--host','127.0.0.1','--port','0',
            '--command-port',str(peer.socket.getsockname()[1]),'--topic-timeout-sec','0.5']))
        cleanup.callback(bridge.destroy_node)
        peer.destination = bridge.transport._socket.getsockname()
        client = OrbitController(parameter_overrides=[Parameter('engines', value='first,second'),
            Parameter('separators', value='ring'), Parameter('output_dir', value=str(tmp_path/'flight'))])
        cleanup.callback(client.destroy_node)
        cleanup.callback(client.csv_file.close)
        executor = SingleThreadedExecutor()
        cleanup.callback(executor.shutdown)
        executor.add_node(bridge)
        executor.add_node(client)

        def spin(predicate, timeout=4., emit=True):
            deadline = time.monotonic()+timeout
            while time.monotonic() < deadline:
                peer.pump(emit)
                executor.spin_once(timeout_sec=.005)
                if predicate():
                    return
            raise AssertionError(f'timeout: {client.reason}; packets: {peer.commands[-3:]}')
        yield client, peer, spin


def batches(peer):
    return [p for p in peer.commands if p['type'] == 'pylon_control_batch']


def test_ignition_requires_ack_and_batch_uses_configured_names(connection):
    client, peer, spin = connection
    peer.reply = False
    spin(lambda: len(peer.commands) >= 2)
    assert not batches(peer)
    peer.reply = True
    spin(lambda: bool(batches(peer)))
    batch = batches(peer)[0]
    assert batch['renewLease'] and batch['hasFlight']
    engines = [json.loads(raw) for raw in batch['engineJson']]
    assert [e['name'] for e in engines] == ['first','second']
    assert engines[0]['enabled'] and not engines[1]['enabled']
    assert engines[0]['timeoutSeconds'] == .4
    client.stop()
    spin(lambda: any(p.get('action') == 'release' for p in peer.commands))
    release = next(p for p in peer.commands if p.get('action') == 'release')
    assert release['sequence'] > max(p['sequence'] for p in batches(peer))
    assert client.done


@pytest.mark.parametrize('failure', ['stale', 'session', 'preempted'])
def test_failure_stops_commands_without_reacquiring(connection, failure):
    client, peer, spin = connection
    spin(lambda: bool(batches(peer)))
    if failure == 'session':
        peer.generation += 1
    elif failure == 'preempted':
        peer.owner, peer.lease = 'other', 'other-lease'
    spin(lambda: client.done, emit=failure != 'stale')
    assert not client.success
    before = len(batches(peer))
    # Drain queued packets before measuring steady stopped state.
    for _ in range(3):
        peer.pump(False)
    before = len(batches(peer))
    client.watchdog()
    client.on_snapshot(client.latest)
    peer.pump(False)
    assert len(batches(peer)) == before
    if failure != 'stale':
        before = len(peer.commands)
        client.stop()
        peer.pump(False)
        assert len(peer.commands) == before


def test_separation_crosses_ros_udp_and_waits_for_confirmation(connection):
    client, peer, spin = connection
    spin(lambda: bool(batches(peer)))
    peer.landed, peer.flameout = False, True
    spin(lambda: any(p['hasSeparation'] for p in batches(peer)))
    separation = next(p for p in batches(peer) if p['hasSeparation'])
    assert json.loads(separation['separationJson'])['name'] == 'ring'
    assert separation['engineJson'] == []
    assert client.guidance.stage == 0
    spin(lambda: sum(p['hasSeparation'] for p in batches(peer)) >= 2)
    requests = [json.loads(p['separationJson']) for p in batches(peer) if p['hasSeparation']]
    assert len({p['operationId'] for p in requests}) == 1
    peer.separated = True
    spin(lambda: client.guidance.stage == 1)
    spin(lambda: any(any(json.loads(raw)['name'] == 'second' and json.loads(raw)['enabled']
                        for raw in p['engineJson']) for p in batches(peer)))


def test_client_has_no_simulator_or_http_dependency():
    for file in (Path(__file__).parents[1]/'pathfinder3').glob('*.py'):
        source = file.read_text()
        for forbidden in ('server/', 'shared/', '/api/', 'craft.json', 'import socket', 'import requests'):
            assert forbidden not in source
