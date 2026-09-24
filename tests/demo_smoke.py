#!/usr/bin/env python3
"""Standalone demo subprocess + ordinary UDP. Use a freshly started disposable app server."""
import json
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
ROOT = Path(__file__).resolve().parents[1]


def request(path, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.load(response)


def until(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = request('/api/state')
        if predicate(state):
            return state
        time.sleep(.05)
    raise AssertionError('Timed out waiting for flight state')


initial = request('/api/state')
assert initial['mode'] == 'flight' and initial['flight']['status'] == 'pad', 'Use a freshly started disposable test server.'
assert 'demo' not in initial, 'The app must not carry demo state'
try:
    request('/api/demo/start', initial['craft'])
    raise AssertionError('The app must not expose demo lifecycle APIs')
except urllib.error.HTTPError as error:
    assert error.code == 404

command_port = initial['connection']['commandPort']
telemetry_port = initial['connection']['telemetryPort']
processes = []
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def start(duration=240):
    child = subprocess.Popen(['node', '--import', 'tsx', 'examples/demo.ts', '--command-port', str(command_port),
                              '--telemetry-port', str(telemetry_port), '--duration', str(duration)], cwd=ROOT,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    processes.append(child)
    return child


try:
    demo = start()
    live = until(lambda s: s['flight']['altitude'] > 5)
    assert live['flight']['thrust'] > 0
    assert live['activeVehicleId'] == initial['activeVehicleId'], 'Ignite the existing pad vehicle without a launch action'
    assert live['connection']['session'] == initial['connection']['session']
    assert live['connection']['authority']['controllerId'] == 'astroforge-udp-demo'
    demo.send_signal(signal.SIGINT)
    output, _ = demo.communicate(timeout=4)
    assert demo.returncode == 0, output
    stopped = until(lambda s: s['flight']['thrust'] == 0 and s['connection']['authority']['state'] == 0)
    assert stopped['mode'] == 'flight', 'Demo stop must not reset simulation'
    assert 'UDP commands' in output, 'Telemetry and demo logs stay in the standalone process'

    request('/api/revert', {})
    demo = start()
    time.sleep(.5)
    assert demo.poll() is None, 'Demo should wait if no flight session is available'
    placed = request('/api/launch', initial['craft'])
    request('/api/control', {'vehicleId': placed['activeVehicleId'], 'enabled': True})
    # Leave enough altitude for the authority handoff before the unpowered vehicle returns to the ground.
    live = until(lambda s: s['connection']['authority']['controllerId'] == 'astroforge-udp-demo' and s['flight']['thrust'] > 59000 and s['flight']['altitude'] > 50)
    packet = dict(type='pylon_control_authority_command', **live['connection']['session'],
                  controllerId='test-external', leaseId='external-test', sequence=1,
                  action='acquire', priority=10, leaseDurationSeconds=5, suppressSas=True)
    sock.sendto(json.dumps(packet).encode(), ('127.0.0.1', command_port))
    output, _ = demo.communicate(timeout=4)
    assert '制御権が移りました' in output, output
    state = request('/api/state')
    assert state['connection']['authority']['controllerId'] == 'test-external'
    assert state['connection']['authority']['state'] == 1
    packet.update(action='release', sequence=2)
    sock.sendto(json.dumps(packet).encode(), ('127.0.0.1', command_port))
    until(lambda s: s['connection']['authority']['state'] == 0)

    request('/api/revert', {})
    placed = request('/api/launch', initial['craft'])
    request('/api/control', {'vehicleId': placed['activeVehicleId'], 'enabled': True})
    demo = start()
    until(lambda s: s['connection']['authority']['controllerId'] == 'astroforge-udp-demo' and s['flight']['thrust'] > 59000)
    request('/api/revert', {})
    output, _ = demo.communicate(timeout=4)
    assert '飛行終了' in output or 'セッションが変更' in output or 'テレメトリ' in output, output

    two_stage = next(entry['craft'] for entry in initial['library'] if entry['id'] == 'two-stage')
    placed = request('/api/launch', two_stage)
    request('/api/control', {'vehicleId': placed['activeVehicleId'], 'enabled': True})
    request('/api/time-scale', {'scale': 10})
    demo = start(duration=180)
    upper = until(lambda s: len(s['flight']['separations']) == 1 and s['flight']['thrust'] > 59000, timeout=20)
    assert upper['flight']['debris'][0]['fuel'] < .001
    assert upper['flight']['fuel'] < 1200
    assert not any(p['id'] == 'engine_1' for p in upper['craft']['parts'])
    output, _ = demo.communicate(timeout=25)
    assert demo.returncode == 0, output
    assert '第1段 燃焼終了' in output and '第1段 分離確認' in output and '第2段 点火' in output, output
    completed = until(lambda s: s['connection']['authority']['state'] == 0 and s['flight']['thrust'] == 0)
    assert len(completed['flight']['separations']) == 1
    assert completed['flight']['maxAltitude'] > 100000, f"Max altitude: {completed['flight']['maxAltitude']:.0f}m\n{output}"
    print(f"Staging: separation at T={upper['flight']['separations'][0]['time']:.1f}s; "
          f"upper thrust={upper['flight']['thrust']:.0f}N; max altitude={completed['flight']['maxAltitude']:.0f}m")
    print('PASS: standalone UDP ignition, wait, SIGINT, restart, preemption, session reset; two-stage burnout, separation, upper ignition and spaceflight at 10x')
finally:
    for child in processes:
        if child.poll() is None:
            child.send_signal(signal.SIGINT)
            child.communicate(timeout=4)
    request('/api/time-scale', {'scale': 1})
    request('/api/revert', {})
    sock.close()
