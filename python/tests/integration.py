"""Disposable AstroForge server and real UDP SDK acceptance checks.

Run after npm run build:physics and installing ./python. No user's server is used.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from astroforge import Client, EngineCommand, AttitudeCommand, TelemetryTimeout

ROOT = Path(__file__).resolve().parents[2]


def free_port(kind):
    with socket.socket(socket.AF_INET, kind) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def run():
    port = free_port(socket.SOCK_STREAM)
    command = free_port(socket.SOCK_DGRAM)
    telemetry = free_port(socket.SOCK_DGRAM)
    while telemetry == command:
        telemetry = free_port(socket.SOCK_DGRAM)
    base = f'http://127.0.0.1:{port}'

    def api(path='/api/state', data=None):
        request = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None,
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.load(response)

    def until(predicate, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = api()
            if predicate(state):
                return state
            time.sleep(.03)
        raise AssertionError('Expected server state was not reached')

    with tempfile.TemporaryDirectory(prefix='astroforge-sdk-') as data_dir, tempfile.TemporaryFile() as log:
        env = dict(os.environ, PORT=str(port), UDP_COMMAND_PORT=str(command), UDP_TELEMETRY_PORT=str(telemetry),
                   ASTROFORGE_DATA_DIR=data_dir)
        proc = subprocess.Popen(['node', '--import', 'tsx', 'server/index.ts'], cwd=ROOT, env=env,
                                stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    initial = api()
                    break
                except (OSError, ValueError):
                    if proc.poll() is not None:
                        log.seek(0)
                        raise AssertionError(log.read().decode(errors='replace'))
                    time.sleep(.05)
            else:
                raise AssertionError('Server did not start')
            assert initial['connection']['physicsBackend'] == 'zig-wasm'
            with Client(command_port=command, telemetry_port=telemetry) as observer:
                observer.wait_until_ready()
                observer.wait_for_snapshot()
            assert api()['connection']['received'] == 0, 'Receiver sent commands'

            with Client(command_port=command, telemetry_port=telemetry) as client:
                snapshot = client.wait_until_ready()
                client.acquire_control(lease_duration=.6)
                deadline = time.monotonic() + 5
                while snapshot.flight['altitudeAgl'] < initial['flight']['altitudeAsl'] + 6:
                    assert time.monotonic() < deadline
                    client.send_batch([EngineCommand('engine_1', 60000)], attitude=AttitudeCommand())
                    snapshot = client.wait_for_snapshot(after=snapshot)
                assert client.state.controlling
                # Allow the last command to expire while the SDK continues renewing the lease.
                until(lambda s: s['flight']['thrust'] == 0)
                assert api()['connection']['authority']['controllerId'] == client.controller_id
                client.separate('separator_1')
                until(lambda s: len(s['flight']['separations']) == 1)
                deadline = time.monotonic() + 2
                while not any(s['name'] == 'separator_1' and s['separated'] for s in snapshot.separations):
                    assert time.monotonic() < deadline
                    snapshot = client.wait_for_snapshot(after=snapshot)
                assert any(e['name'] == 'upper_engine' and e['available'] for e in snapshot.engines)
                client.set_engine('upper_engine', 60000)
                until(lambda s: s['flight']['thrust'] > 59000)
                client.set_rcs('rcs_1', 100)
                until(lambda s: s['connection']['lastCommand']['type'] == 'pylon_actuator_command'
                      and s['connection']['lastCommand']['accepted'])
                client.set_wrench([10000, 0, 0], [0, 0, 0])
                until(lambda s: s['connection']['lastCommand']['type'] == 'pylon_body_wrench_command'
                      and s['connection']['lastCommand']['accepted'])
                client.emergency_stop()
                until(lambda s: s['connection']['authority']['state'] == 2 and s['flight']['thrust'] == 0)
                client.clear_emergency_stop()
                until(lambda s: s['connection']['authority']['state'] == 0)
                client.acquire_control()
                client.set_engine('upper_engine', 10000)
                until(lambda s: s['flight']['thrust'] > 0)
            until(lambda s: s['connection']['authority']['state'] == 0 and s['flight']['thrust'] == 0)
            print('PASS: receive-only, acquire/renew, ignition, attitude/batch, deadline cutoff, separation, upper ignition, wrench, emergency stop, release')

            with Client(command_port=command, telemetry_port=telemetry, stale_after=.2) as client:
                old = client.wait_until_ready()
                client.acquire_control()
                vehicle = api()['activeVehicleId']
                api('/api/control', {'vehicleId': vehicle, 'enabled': False})
                try:
                    client.wait_for_snapshot(timeout=.5)
                except TelemetryTimeout:
                    pass
                assert not client.state.controlling
                api('/api/control', {'vehicleId': vehicle, 'enabled': True})
                new = client.wait_until_ready()
                assert old.session != new.session
                assert not client.state.controlling
                client.acquire_control()
                assert client.state.controlling
            print('PASS: UDP OFF/ON reconnects observations and requires explicit control reacquisition')

            # Reset only this disposable server and exercise the installed SDK staging example.
            api('/api/revert', {})
            state = api()
            state = api('/api/control', {'vehicleId': state['activeVehicleId'], 'enabled': True})
            api('/api/time-scale', {'scale': 10})
            udp = state['connection']
            demo = subprocess.Popen([sys.executable, 'examples/python_staging.py', '--duration', '24',
                                     '--command-port', str(udp['commandPort']), '--telemetry-port', str(udp['telemetryPort'])],
                                    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            saw_separation = saw_upper = saw_space = False
            try:
                deadline = time.monotonic() + 30
                while demo.poll() is None and time.monotonic() < deadline:
                    current = api()
                    saw_separation |= bool(current['flight']['separations'])
                    saw_upper |= saw_separation and current['flight']['thrust'] > 1000
                    saw_space |= current['flight']['altitude'] > 100000
                    time.sleep(.1)
                output, _ = demo.communicate(timeout=2)
                assert demo.returncode == 0, output.decode(errors='replace')
                assert saw_separation and saw_upper and saw_space, (saw_separation, saw_upper, saw_space, output)
                until(lambda s: s['connection']['authority']['state'] == 0 and s['flight']['thrust'] == 0)
                print('PASS: Python staging example at x10: automatic separation, upper-stage ignition, >100 km, release')
            finally:
                if demo.poll() is None:
                    demo.terminate()
                    demo.wait(timeout=5)
        finally:
            proc.terminate()
            proc.wait(timeout=5)


if __name__ == '__main__':
    run()
