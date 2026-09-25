#!/usr/bin/env python3
"""Production VehicleUdp ↔ real UDP ↔ upstream BridgeRuntime (ROS not needed).
Usage: python3 tests/bridge_roundtrip.py /path/to/PyLoN
The child is an isolated test fixture, not the AstroForge application server.
"""
import json
from pathlib import Path
import select
import socket
import subprocess
import sys
import time

if len(sys.argv) != 2:
    raise SystemExit(__doc__)
sys.path.insert(0, str(Path(sys.argv[1])/'Ros2'/'pylon_bridge'))
from pylon_bridge.application.runtime import BridgeRuntime
from pylon_bridge.observations import control_snapshot_from_packet
from pylon_bridge.vehicle_packets import control_authority_command, actuator_command

root = Path(__file__).resolve().parents[1]


def run(terminal):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
        client.bind(('127.0.0.1', 0))
        client.settimeout(0.1)
        proc = subprocess.Popen(['node', '--import', 'tsx', 'tests/bridge-udp-driver.js',
            str(client.getsockname()[1])], cwd=root, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True)
        try:
            def line():
                assert select.select([proc.stdout], [], [], 5)[0], 'test peer stdout timeout'
                value = proc.stdout.readline()
                assert value, 'test peer exited'
                return json.loads(value)

            destination = ('127.0.0.1', line()['commandPort'])
            runtime = BridgeRuntime()
            seen = []

            def wait(predicate, timeout=3):
                deadline = time.monotonic()+timeout
                while time.monotonic() < deadline:
                    try:
                        raw, _ = client.recvfrom(65535)
                    except socket.timeout:
                        continue
                    event = runtime.receive(raw, time.monotonic())
                    if event:
                        seen.append(event.packet)
                        if predicate(event.packet):
                            return event.packet
                raise AssertionError(f'timeout waiting for {terminal}: {seen[-1:]}')

            def action(value):
                proc.stdin.write(value+'\n')
                proc.stdin.flush()
                assert line() == {'action': value}

            sequence = 0
            def command(action):
                nonlocal sequence
                sequence += 1
                packet = control_authority_command(action, runtime.session.key.vessel,
                    'roundtrip', 'lease', 1, 2, True, sequence)
                client.sendto(runtime.encode_command(packet, time.monotonic(), 1), destination)

            session = wait(lambda p: p['type'] == 'pylon_session')
            assert session['available']
            key = runtime.session.key
            command('acquire')
            acquired = wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'lease_acquired')
            assert acquired['controllerId'] == 'roundtrip' and acquired['state'] == 1
            command('renew')
            wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'lease_renewed')
            command('release')
            wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'lease_released')
            command('acquire')
            wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'lease_acquired')
            manifest = wait(lambda p: p['type'] == 'pylon_actuator_manifest')
            engine = next(a['name'] for a in manifest['actuators'] if a['actuatorType'] == 'engine')
            sequence += 1
            demand = actuator_command('engine', engine, {'enabled': True, 'targetThrust': 1000.0,
                'timeoutSeconds': 1.0}, sequence, key.vessel, 'roundtrip', 'lease')
            client.sendto(runtime.encode_command(demand, time.monotonic(), 1), destination)
            wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'command_accepted')
            wait(lambda p: p['type'] == 'pylon_actuator_state' and p.get('name') == engine and p['commandActive'])
            action(terminal)
            wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == f'vessel_{terminal}' and p['state'] == 0)
            previous = -1
            for _ in range(3):
                snapshot = wait(lambda p: p['type'] == 'pylon_control_snapshot')
                flight, engines, _ = control_snapshot_from_packet(snapshot)
                assert flight['landed'] == (terminal == 'landed')
                assert snapshot['observationSequence'] > previous
                previous = snapshot['observationSequence']
                assert all(not e['commandActive'] and not e['operational'] for e in engines)
            assert runtime.session.key == key and runtime.session.available
            command('acquire')
            rejected = wait(lambda p: p['type'] == 'pylon_control_authority_state' and p['reason'] == 'control_unavailable')
            assert rejected['state'] == 0
            action('destroyed')
            wait(lambda p: p['type'] == 'pylon_session' and not p['available'])
            assert not runtime.session.available
            # The bridge must reject terminal payloads after explicit invalidation.
            count = len(seen)
            wait(lambda p: p['type'] == 'pylon_session' and not p['available'])
            assert all(p['type'] == 'pylon_session' for p in seen[count:])
            action('off')
            drain_deadline = time.monotonic()+1
            while time.monotonic() < drain_deadline:  # allow only in-flight datagrams
                try:
                    client.recvfrom(65535)
                except socket.timeout:
                    break
            else:
                raise AssertionError('UDP OFF did not stop telemetry')
            assert runtime.expire_session(time.monotonic()+1, 0.5)
            try:
                command('acquire')
            except ValueError:
                pass
            else:
                raise AssertionError('bridge encoded a command without an available session')
            print(f'PASS: {terminal}: acquire/renew/release, engine command, final snapshots, control rejection, invalidation and UDP OFF')
        finally:
            proc.stdin.close()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            assert proc.returncode == 0, f'test peer exit: {proc.returncode}'


for terminal in ('landed', 'crashed'):
    run(terminal)
