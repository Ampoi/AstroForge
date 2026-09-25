"""Real loopback sockets with a deliberately small, fault-injectable peer."""
import json
import socket
import threading
import time
import unittest

from astroforge import (Client, EngineCommand, AttitudeCommand, SeparationCommand, ClientClosed,
                        ConnectionError, ControlLost, TelemetryTimeout, SessionChanged, AuthorityTimeout)


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Peer:
    def __init__(self):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(('127.0.0.1', 0))
        self.socket.settimeout(.01)
        self.command_port = self.socket.getsockname()[1]
        self.telemetry_port = free_port()
        self.identity = dict(runtimeInstance='test', runtimeGeneration=1, runtimeEpoch='epoch-1',
                             runtimeVesselId='vessel', vesselId='vessel')
        self.observation = 0
        self.received = []
        self.authority = dict(state=0, controllerId='', leaseId='', leaseRemainingSeconds=0,
                              lastSequence=0, reason='idle')
        self.silent = False
        self.deny = False
        self.no_snapshot = False
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def packet(self, kind, **fields):
        return dict(type=kind, version=1, **self.identity, observationSequence=self.observation,
                    universalTime=self.observation * .02, **fields)

    def flight(self):
        return self.packet('pylon_flight_state', altitudeAgl=100, altitudeAsl=100, verticalSpeed=1,
                           horizontalSpeed=0, mass=100, liquidFuel=10, oxidizer=10, electricCharge=10,
                           dynamicPressure=0, apoapsis=110, periapsis=-100, orbitBound=True,
                           upBody=[1, 0, 0], eastBody=[0, 1, 0], northBody=[0, 0, 1],
                           angularVelocityBody=[0, 0, 0], landed=False)

    def snapshot(self):
        engine = self.packet('pylon_actuator_state', name='engine', actuatorType='engine', available=True,
                             operational=True, flameout=False, enabled=False, commandActive=False,
                             thrust=0, maxThrust=60000)
        return self.packet('pylon_control_snapshot', flight=self.flight(), engines=[engine], separations=[])

    def send(self, packet):
        raw = packet if isinstance(packet, bytes) else json.dumps(packet).encode()
        self.socket.sendto(raw, ('127.0.0.1', self.telemetry_port))

    def run(self):
        next_tick = 0
        while not self.stop.is_set():
            try:
                raw, _ = self.socket.recvfrom(65535)
                command = json.loads(raw)
                with self.lock:
                    self.received.append(command)
                    action = command.get('action')
                    if action in ('acquire', 'renew') and not self.deny:
                        self.authority = dict(state=1, controllerId=command['controllerId'], leaseId=command['leaseId'],
                                              leaseRemainingSeconds=command['leaseDurationSeconds'],
                                              lastSequence=command['sequence'], reason='lease_acquired')
                    elif action in ('release', 'clear_emergency_stop'):
                        self.authority = dict(state=0, controllerId='', leaseId='', leaseRemainingSeconds=0,
                                              lastSequence=0, reason='lease_released')
                    elif action == 'emergency_stop':
                        self.authority = dict(state=2, controllerId=command['controllerId'], leaseId=command['leaseId'],
                                              leaseRemainingSeconds=0, lastSequence=command['sequence'], reason='emergency_stop')
                    if not self.silent:
                        self.send(self.packet('pylon_control_authority_state', **self.authority))
            except (socket.timeout, ConnectionResetError):
                pass
            if not self.silent and time.monotonic() >= next_tick:
                with self.lock:
                    self.observation += 1
                    self.send(self.packet('pylon_session', available=True, warpRate=1))
                    self.send(self.packet('pylon_control_authority_state', **self.authority))
                    if not self.no_snapshot:
                        self.send(self.snapshot())
                next_tick = time.monotonic() + .02

    def until(self, predicate, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.lock:
                if predicate(self.received):
                    return
            time.sleep(.01)
        raise AssertionError('Expected command was not observed')

    def close(self):
        self.stop.set()
        self.thread.join(1)
        self.socket.close()


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.peer = Peer()
        self.client = Client(command_port=self.peer.command_port, telemetry_port=self.peer.telemetry_port,
                             stale_after=.25)
        self.addCleanup(self.peer.close)
        self.addCleanup(self.client.close)
        self.client.wait_until_ready()

    def test_receive_only_defensive_copy_and_no_shutdown_commands(self):
        first = self.client.snapshot
        first.flight['mass'] = -1
        self.assertEqual(self.client.snapshot.flight['mass'], 100)
        self.assertGreater(self.client.wait_for_snapshot(after=first).sequence, first.sequence)
        self.client.close()
        self.client.close()
        time.sleep(.03)
        self.assertEqual(self.peer.received, [])
        self.assertFalse(self.client._thread.is_alive())
        with self.assertRaises(ClientClosed):
            self.client.wait_for_snapshot()

    def test_all_commands_and_atomic_batch_envelopes(self):
        self.client.acquire_control()
        sequences = [self.client.set_engine('engine', 50000, gimbal=(.1, -.1, 0)),
                     self.client.set_attitude(pitch=.1, yaw=.2, roll=-.3),
                     self.client.set_rcs('rcs', 200), self.client.set_wrench([1, 2, 3], [4, 5, 6]),
                     self.client.separate('ring'),
                     self.client.send_batch([EngineCommand('upper', 40000)], attitude=AttitudeCommand(),
                                            separation=SeparationCommand('ring'))]
        self.peer.until(lambda packets: any(p['sequence'] == sequences[-1] for p in packets))
        packets = {p['sequence']: p for p in self.peer.received}
        self.assertEqual(packets[sequences[0]]['gimbalPitch'], .1)
        self.assertEqual(packets[sequences[1]]['timeoutSeconds'], .4)
        self.assertEqual(packets[sequences[2]]['thrustLimit'], 200)
        self.assertEqual(packets[sequences[3]]['frame'], 'base_link')
        self.assertTrue(packets[sequences[4]]['separate'])
        batch = packets[sequences[-1]]
        for raw in [*batch['engineJson'], batch['flightJson'], batch['separationJson']]:
            child = json.loads(raw)
            for key in (*self.peer.identity, 'sequence', 'controllerId', 'leaseId', 'version'):
                self.assertEqual(child[key], batch[key])
        self.assertEqual(sequences, sorted(set(sequences)))
        self.client.close()
        self.peer.until(lambda packets: packets[-1].get('action') == 'release')

    def test_invalid_commands_send_nothing(self):
        self.client.acquire_control()
        invalid = [lambda: self.client.set_engine('engine', float('nan')),
                   lambda: self.client.set_engine('engine', True),
                   lambda: self.client.set_attitude(pitch=2),
                   lambda: self.client.set_rcs('rcs', enabled=1),
                   lambda: self.client.set_wrench([1, 2], [0, 0, 0]),
                   lambda: self.client.send_batch([EngineCommand('x', 1), EngineCommand('x', 2)]),
                   lambda: self.client.send_batch([EngineCommand('x', 1, timeout=2)]),
                   lambda: self.client.send_batch(attitude={}),
                   lambda: self.client.send_batch([EngineCommand(str(i), 1) for i in range(17)])]
        for call in invalid:
            with self.assertRaises(ValueError):
                call()
        time.sleep(.03)
        self.assertTrue(all(p['type'] == 'pylon_control_authority_command' for p in self.peer.received))

    def test_lease_renews_but_commands_do_not_repeat(self):
        self.client.acquire_control(lease_duration=.3)
        self.client.set_engine('engine', 60000)
        self.peer.until(lambda packets: sum(p.get('action') == 'renew' for p in packets) >= 3)
        self.assertEqual(sum(p['type'] == 'pylon_actuator_command' for p in self.peer.received), 1)

    def test_stale_snapshot_stops_renewal_even_with_live_heartbeat(self):
        self.client.acquire_control(lease_duration=.3)
        self.peer.no_snapshot = True
        with self.assertRaises(TelemetryTimeout):
            self.client.wait_for_snapshot()
        self.assertFalse(self.client.state.controlling)
        count = len(self.peer.received)
        time.sleep(.2)
        self.client.close()
        self.assertEqual(len(self.peer.received), count)

    def test_preemption_stops_commands_and_does_not_release_new_owner(self):
        self.client.acquire_control()
        with self.peer.lock:
            self.peer.authority.update(controllerId='other', leaseId='other')
        time.sleep(.06)
        with self.assertRaises(ControlLost):
            self.client.set_engine('engine', 1)
        self.client.close()
        self.assertFalse(any(p.get('action') == 'release' for p in self.peer.received))

    def test_session_change_needs_explicit_reacquisition(self):
        self.client.acquire_control()
        old_session = self.client.snapshot.session
        with self.peer.lock:
            self.peer.identity.update(runtimeGeneration=2, runtimeEpoch='epoch-2')
        time.sleep(.06)
        with self.assertRaises(SessionChanged):
            self.client.wait_for_snapshot()
        self.assertFalse(self.client.state.controlling)
        with self.peer.lock:
            old = self.peer.packet('pylon_session', available=True)
            old.update(runtimeGeneration=1, runtimeEpoch='epoch-1', observationSequence=10000)
            self.peer.send(old)
        self.client.wait_until_ready()
        self.assertNotEqual(self.client.snapshot.session, old_session)
        self.client.acquire_control()
        self.assertTrue(self.client.state.controlling)

    def test_malformed_old_incoherent_and_foreign_packets_are_ignored(self):
        with self.peer.lock:
            self.peer.silent = True
            time.sleep(.02)
            state = self.client.snapshot
            self.peer.send(b'not json')
            self.peer.send(b'{"x": NaN}')
            self.peer.send(b'[]')
            self.peer.send(b'{"version":1,"runtimeGeneration":1e1000}')
            wrong = self.peer.snapshot()
            wrong['observationSequence'] = state.sequence + 100
            self.peer.send(wrong)  # Nested members have a different observation.
            old = self.peer.snapshot()
            old['observationSequence'] = 0
            self.peer.send(old)
            wrong_session = self.peer.snapshot()
            wrong_session['vesselId'] = 'elsewhere'
            self.peer.send(wrong_session)
        time.sleep(.03)
        self.assertEqual(self.client.snapshot.sequence, state.sequence)
        self.assertTrue(self.client._thread.is_alive())
        self.peer.silent = False
        self.assertGreater(self.client.wait_for_snapshot(after=state).sequence, state.sequence)

    def test_port_collision_and_bounded_wait(self):
        with self.assertRaises(ConnectionError):
            Client(command_port=self.peer.command_port, telemetry_port=self.peer.telemetry_port)
        with Client(command_port=self.peer.command_port, telemetry_port=free_port()) as client:
            with self.assertRaises(TelemetryTimeout):
                client.wait_until_ready(timeout=.05)

    def test_acquisition_timeout_and_emergency_stop(self):
        self.peer.deny = True
        with self.assertRaises(AuthorityTimeout):
            self.client.acquire_control(timeout=.1)
        self.assertFalse(self.client.state.controlling)
        self.peer.deny = False
        self.client.acquire_control()
        self.client.emergency_stop()
        self.peer.until(lambda packets: any(p.get('action') == 'emergency_stop' for p in packets))
        self.assertFalse(self.client.state.controlling)
        self.client.clear_emergency_stop()
        self.peer.until(lambda packets: packets[-1].get('action') == 'clear_emergency_stop')

    def test_session_passive_vehicle_is_observable_but_not_controllable(self):
        before = self.client.snapshot
        with self.peer.lock:
            self.peer.silent = True
            self.peer.observation += 1
            self.peer.send(self.peer.packet('pylon_session', available=False))
            self.peer.send(self.peer.snapshot())
        state = self.client.wait_for_snapshot(after=before)
        self.assertEqual(state.flight['mass'], 100)
        with self.assertRaises(ControlLost):
            self.client.acquire_control()

    def test_socket_failure_wakes_waiters(self):
        self.client._socket.close()
        with self.assertRaises(ConnectionError):
            self.client.wait_for_snapshot(timeout=.5)
        self.client.close()
        self.assertFalse(self.client._thread.is_alive())

    def test_foreign_sender_cannot_replace_session(self):
        before = self.client.snapshot
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as foreign:
            packet = self.peer.packet('pylon_session', available=True)
            packet.update(runtimeInstance='foreign', observationSequence=10000)
            foreign.sendto(json.dumps(packet).encode(), ('127.0.0.1', self.peer.telemetry_port))
        current = self.client.wait_for_snapshot(after=before)
        self.assertEqual(before.session, current.session)

    def test_no_auto_reacquire_after_observation_recovery(self):
        self.client.acquire_control(lease_duration=.3)
        self.peer.silent = True
        with self.assertRaises(TelemetryTimeout):
            self.client.wait_for_snapshot(timeout=.6)
        self.peer.silent = False
        self.client.wait_until_ready()
        with self.assertRaises(ControlLost):
            self.client.set_engine('engine', 1)
        self.assertEqual(sum(p.get('action') == 'acquire' for p in self.peer.received), 1)

    def test_expired_authority_and_bad_imu_are_rejected(self):
        self.client.acquire_control()
        with self.peer.lock:
            self.peer.silent = True
            self.peer.observation += 1
            self.peer.send(self.peer.packet('pylon_imu', angularVelocity=[0, 0], linearAcceleration=[0, 0, 0]))
            self.peer.authority['leaseRemainingSeconds'] = 0
            self.peer.send(self.peer.packet('pylon_control_authority_state', **self.peer.authority))
        time.sleep(.03)
        self.assertIsNone(self.client.imu)
        with self.assertRaises(ControlLost):
            self.client.set_attitude()


if __name__ == '__main__':
    unittest.main()
