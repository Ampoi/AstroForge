#!/usr/bin/env python3
"""End-to-end HTTP + real UDP check against a running local server in editor mode.
The original craft is preserved and the server is returned to the editor.
"""
import json
from pathlib import Path
import socket
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'examples'))
from launch import PylonClient

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000'


def api(path, data=None):
    request = urllib.request.Request(BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


original = api('/api/state')
assert original['mode'] == 'editor', 'Return to the editor before running this check.'
client = None


def until(predicate, timeout=3):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        packet = client.poll()
        if packet and predicate(packet):
            return packet
    raise AssertionError('Timed out waiting for telemetry.')


try:
    placed = api('/api/launch', original['craft'])
    enabled = api('/api/control', {'vehicleId': placed['activeVehicleId'], 'enabled': True})
    client = PylonClient(command_port=enabled['connection']['commandPort'],
                         telemetry_port=enabled['connection']['telemetryPort'])
    until(lambda p: bool(client.latest and client.engines))
    imu = until(lambda p: p['type'] == 'pylon_imu')
    assert 9.7 < imu['linearAcceleration'][0] < 9.9
    assert abs(imu['angularVelocity'][2] - 7.292115e-5) < 1e-8
    health = until(lambda p: p['type'] == 'pylon_vehicle_health')
    assert health['electricCapacity'] == original['flight']['stats']['power']
    snapshot = until(lambda p: p['type'] == 'pylon_control_snapshot')
    for member in [snapshot['flight'], *snapshot['engines'], *snapshot['separations']]:
        assert member['universalTime'] == snapshot['universalTime']
        assert member['observationSequence'] == snapshot['observationSequence']
    client.authority_command('acquire')
    until(lambda p: p['type']=='pylon_control_authority_state' and p['state']==1)
    command = client.send('pylon_actuator_command', actuatorType='engine', name=client.engines[0],
                         enabled=True, targetThrust=60000, timeoutSeconds=.8,
                         hasGimbalCommand=False, gimbalPitch=0, gimbalYaw=0, gimbalRoll=0)
    fired = until(lambda p: p['type']=='pylon_actuator_state' and p.get('actuatorType')=='engine' and p['thrust']>59000)
    client.socket.sendto(json.dumps(command).encode(), client.endpoint)
    until(lambda p: p['type']=='pylon_control_authority_state' and p['reason']=='stale_sequence')
    climbed = until(lambda p: p['type']=='pylon_flight_state' and p['verticalSpeed']>3)
    cutoff = until(lambda p: p['type']=='pylon_actuator_state' and p.get('actuatorType')=='engine' and p['thrust']==0)
    assert api('/api/state')['flight']['fuel'] < original['flight']['fuel']
    client.authority_command('emergency_stop')
    until(lambda p: p['type']=='pylon_control_authority_state' and p['state']==2)
    print(f'PASS: real UDP lease, ignition ({fired["thrust"]:.0f} N), ascent '
          f'({climbed["verticalSpeed"]:.2f} m/s), duplicate rejection, command timeout, emergency stop; IMU, power, coherent snapshot.')
finally:
    if client:
        client.socket.close()
    api('/api/revert', {})
