#!/usr/bin/env python3
"""SDK launch controller; no automatic stage separation. Install ./python first."""
import argparse
import math
import time

from astroforge import AstroForgeError, AttitudeCommand, Client, EngineCommand


def guidance(flight, turn=0, warp=1):
    tilt = math.radians(turn) * max(0, min(1, (flight['altitudeAgl'] - 3000) / 10000))
    up = [u * math.cos(tilt) + e * math.sin(tilt)
          for u, e in zip(flight['upBody'], flight['eastBody'])]
    omega = flight['angularVelocityBody']
    clip = lambda value: max(-1.0, min(1.0, value))
    position_gain, rate_gain = min(2, 10 / max(1, warp)), min(1.8, 3 / max(1, warp))
    return AttitudeCommand(pitch=clip(-position_gain * up[2] - rate_gain * omega[1]),
                           yaw=clip(position_gain * up[1] - rate_gain * omega[2]),
                           roll=clip(-rate_gain * omega[0]))


def arguments(description=__doc__, duration=90):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--command-port', type=int, default=49011)
    parser.add_argument('--telemetry-port', type=int, default=49010)
    parser.add_argument('--duration', type=float, default=duration)
    parser.add_argument('--turn', type=float, default=0)
    args = parser.parse_args()
    if not math.isfinite(args.duration) or not 0 < args.duration <= 3600 or not math.isfinite(args.turn) or not 0 <= args.turn <= 45:
        parser.error('duration must be in (0, 3600], turn in [0, 45]')
    return args


def main():
    args = arguments()
    print('テレメトリ受信後、制御権を取得すると自動点火します。Ctrl+Cで終了。', flush=True)
    try:
        with Client(args.host, args.command_port, args.telemetry_port) as client:
            state = client.wait_until_ready()
            client.acquire_control()
            deadline, next_print = time.monotonic() + args.duration, 0
            while time.monotonic() < deadline:
                session = client.latest('pylon_session')
                client.send_batch([EngineCommand(e['name'], 60000) for e in state.engines if e['available']],
                                  attitude=guidance(state.flight, args.turn, session.data.get('warpRate', 1)))
                if time.monotonic() >= next_print:
                    print(f'T+{state.simulation_time:.1f}s | h={state.flight["altitudeAgl"]:.1f}m', flush=True)
                    next_print = time.monotonic() + 1
                state = client.wait_for_snapshot(after=state)
    except KeyboardInterrupt:
        print('Controller interrupted; shutdown attempted.', flush=True)
    except (AstroForgeError, ValueError) as error:
        print(f'Controller stopped: {error}', flush=True)
        return 1
    print('Controller closed. The simulation continues; verify thrust/authority in telemetry.', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
