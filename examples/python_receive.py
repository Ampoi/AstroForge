"""Receive-only SDK example. Run after installing ./python."""
import argparse
from astroforge import Client


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--command-port', type=int, default=49011)
    parser.add_argument('--telemetry-port', type=int, default=49010)
    args = parser.parse_args()
    try:
        with Client(args.host, args.command_port, args.telemetry_port) as client:
            state = client.wait_until_ready()
            while True:
                print(f'T+{state.simulation_time:.1f}s  altitude={state.flight["altitudeAgl"]:.1f}m')
                state = client.wait_for_snapshot(after=state)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
