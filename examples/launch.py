#!/usr/bin/env python3
"""PyLoN v1 UDP-only launch controller. Python 3 standard library only."""
import argparse
import json
import math
import socket
import time
import uuid

IDENTITY = ('runtimeInstance', 'runtimeGeneration', 'runtimeEpoch', 'runtimeVesselId', 'vesselId')


class PylonClient:
    def __init__(self, host='127.0.0.1', command_port=49011, telemetry_port=49010):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(('127.0.0.1', telemetry_port))
        self.socket.settimeout(.1)
        self.endpoint = (host, command_port)
        self.session = None
        self.controller = 'astroforge-python-demo'
        self.lease = uuid.uuid4().hex
        self.sequence = 0
        self.latest = {}
        self.engines = []
        self.last_heartbeat = 0
        self.last_flight = 0
        self.authority = None

    def poll(self):
        try:
            raw, _ = self.socket.recvfrom(65535)
        except socket.timeout:
            return None
        packet = json.loads(raw)
        if packet.get('version') != 1:
            return None
        if packet.get('type') == 'pylon_session':
            if not packet.get('available'):
                return None
            session = {key: packet[key] for key in IDENTITY}
            if self.session and self.session != session:
                raise RuntimeError('Flight session changed; restart this controller.')
            self.session = session
            self.last_heartbeat = time.monotonic()
        elif not self.session or any(packet.get(k) != v for k, v in self.session.items()):
            return None
        if packet['type'] == 'pylon_flight_state':
            self.latest = packet
            self.last_flight = time.monotonic()
        elif packet['type'] == 'pylon_actuator_manifest':
            self.engines = [p['name'] for p in packet['actuators'] if p['actuatorType'] == 'engine']
        elif packet['type'] == 'pylon_control_authority_state':
            self.authority = packet
        return packet

    def send(self, kind, **fields):
        if not self.session:
            raise RuntimeError('No active flight session.')
        self.sequence += 1
        packet = dict(type=kind, version=1, **self.session,
                      controllerId=self.controller, leaseId=self.lease,
                      sequence=self.sequence, **fields)
        self.socket.sendto(json.dumps(packet, allow_nan=False).encode(), self.endpoint)
        return packet

    def authority_command(self, action):
        return self.send('pylon_control_authority_command', action=action, priority=10,
                         leaseDurationSeconds=2.0, suppressSas=True)

    def engine(self, name, thrust):
        return self.send('pylon_actuator_command', actuatorType='engine', name=name,
                         enabled=True, targetThrust=thrust, hasGimbalCommand=False,
                         gimbalPitch=0.0, gimbalYaw=0.0, gimbalRoll=0.0, timeoutSeconds=.4)

    def close(self):
        if self.session:
            for name in self.engines:
                self.engine(name, 0)
            self.authority_command('release')
        self.socket.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--command-port', type=int, default=49011)
    parser.add_argument('--telemetry-port', type=int, default=49010)
    parser.add_argument('--duration', type=float, default=90, help='Controller run time in seconds')
    parser.add_argument('--turn', type=float, default=0, help='Optional tilt toward east, degrees after 3 km')
    args = parser.parse_args()
    if not math.isfinite(args.duration) or not 0 < args.duration <= 3600 or not math.isfinite(args.turn) or not 0 <= args.turn <= 45:
        parser.error('duration must be in (0, 3600], turn in [0, 45]')
    try:
        client = PylonClient(args.host, args.command_port, args.telemetry_port)
    except OSError as error:
        parser.exit(1, f'Cannot bind telemetry port: {error}. Stop any other client using this port.\n')
    print('テレメトリを受信し、制御権を取得すると自動点火します。Ctrl+Cで停止。', flush=True)
    try:
        while not (client.session and client.engines and client.latest):
            client.poll()
        client.authority_command('acquire')
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            client.poll()
            if client.authority and client.authority['state'] == 1 and client.authority['leaseId'] == client.lease:
                break
        else:
            raise RuntimeError('Could not acquire control authority.')
        print(f'Lease acquired. Igniting {", ".join(client.engines)}.', flush=True)
        start = time.monotonic()
        next_command = start
        next_renewal = start + .5
        next_print = start
        clip = lambda v: max(-1.0, min(1.0, v))
        while time.monotonic() - start < args.duration:
            client.poll()
            now = time.monotonic()
            if now - client.last_heartbeat > 1 or now - client.last_flight > .75:
                raise RuntimeError('Telemetry stale. Thrust is being stopped.')
            if now >= next_renewal:
                client.authority_command('renew')
                next_renewal = now + .5
            if now >= next_command:
                f = client.latest
                tilt = math.radians(args.turn) * max(0, min(1, (f['altitudeAgl'] - 3000) / 10000))
                up = [u*math.cos(tilt) + e*math.sin(tilt) for u, e in zip(f['upBody'], f['eastBody'])]
                omega = f['angularVelocityBody']
                # Body frame: x forward, y left, z up; right-handed torque axes.
                client.send('pylon_flight_control_command', pitch=clip(-2.0*up[2] - 1.8*omega[1]),
                            yaw=clip(2.0*up[1] - 1.8*omega[2]), roll=clip(-1.8*omega[0]),
                            landingGear=False, timeoutSeconds=.4)
                for name in client.engines:
                    client.engine(name, 60000)
                next_command = now + .05
            if now >= next_print:
                f = client.latest
                print(f'T+{f["universalTime"]:6.1f}s | h={f["altitudeAgl"]:9.1f}m | '
                      f'vz={f["verticalSpeed"]:7.1f}m/s | q={f["dynamicPressure"]/1000:6.2f}kPa | '
                      f'm={f["mass"]:7.1f}kg', flush=True)
                next_print = now + 1
    except KeyboardInterrupt:
        print('\nController stopped.', flush=True)
    except (RuntimeError, OSError) as error:
        print(f'Controller stopped: {error}', flush=True)
    finally:
        client.close()
        print('Thrust off; lease released. The simulation continues in the browser.', flush=True)


if __name__ == '__main__':
    main()
