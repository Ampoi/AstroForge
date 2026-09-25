"""Two-stage SDK flight: flameout -> confirmed separation -> upper-stage ignition."""
import time
from astroforge import AstroForgeError, Client, ControlLost, EngineCommand
from launch import arguments, guidance


def main():
    args = arguments(__doc__, duration=240)
    try:
        with Client(args.host, args.command_port, args.telemetry_port) as client:
            state = client.wait_until_ready()
            client.acquire_control()
            deadline = time.monotonic() + args.duration
            pending = None
            separated_at = None
            cutoff = False
            while time.monotonic() < deadline:
                flight = state.flight
                cutoff |= bool(flight['orbitBound'] and flight['altitudeAgl'] > 30000 and flight['apoapsis'] >= 160000)
                available = [e for e in state.engines if e['available']]
                if pending:
                    name, requested, next_retry = pending
                    if any(s['name'] == name and s['separated'] for s in state.separations):
                        print(f'T+{state.simulation_time:.1f}: separation confirmed', flush=True)
                        separated_at = state.simulation_time
                        pending = None
                    elif time.monotonic() - requested > 3:
                        raise ControlLost('Separation was not confirmed; upper stage will not ignite')
                    elif time.monotonic() >= next_retry:
                        client.separate(name)
                        pending = (name, requested, time.monotonic() + .3)
                elif not cutoff and available and all(e['flameout'] for e in available):
                    rings = [s for s in state.separations if s['available'] and not s['separated']]
                    if len(rings) == 1:
                        client.separate(rings[0]['name'])
                        pending = (rings[0]['name'], time.monotonic(), time.monotonic() + .3)
                    elif len(rings) > 1:
                        raise ControlLost('This example expects a two-stage craft with one remaining ring')
                    else:
                        cutoff = True
                allow_ignition = not cutoff and pending is None and (separated_at is None or state.simulation_time - separated_at >= .8)
                session = client.latest('pylon_session')
                client.send_batch([EngineCommand(e['name'], 60000 if allow_ignition and e['operational'] else 0)
                                   for e in available], attitude=guidance(flight, args.turn, session.data.get('warpRate', 1)))
                state = client.wait_for_snapshot(after=state)
    except KeyboardInterrupt:
        print('Controller interrupted; shutdown attempted.')
    except (AstroForgeError, ValueError) as error:
        print(f'Controller stopped: {error}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
