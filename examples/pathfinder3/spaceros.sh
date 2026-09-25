#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${PATHFINDER3_IMAGE:-astroforge-pathfinder3:jazzy-2026.07.0}"
action="${1:-help}"
if (($#)); then shift; fi
case "$action" in
  build)
    pylon_root="${PYLON_ROOT:-$root/../PyLoN}"
    for source in LICENSE Ros2/pylon_interfaces/package.xml Ros2/pylon_bridge/package.xml; do
      if [[ ! -f "$pylon_root/$source" ]]; then
        echo "Missing PyLoN source: $pylon_root/$source. Clone PyLoN separately and set PYLON_ROOT=/path/to/PyLoN." >&2
        exit 1
      fi
    done
    # Stage only the external dependencies and demo in a disposable build context.
    context="$(mktemp -d)"
    trap 'rm -rf "$context"' EXIT
    mkdir -p "$context/pylon" "$context/examples"
    tar -C "$pylon_root" --exclude=__pycache__ --exclude=.pytest_cache -cf - \
      LICENSE Ros2/pylon_interfaces Ros2/pylon_bridge | tar -C "$context/pylon" -xf -
    tar -C "$root/examples" --exclude=__pycache__ --exclude=.pytest_cache -cf - \
      pathfinder3 | tar -C "$context/examples" -xf -
    docker build -f "$context/examples/pathfinder3/Dockerfile" -t "$image" "$context"
    ;;
  check) docker run --rm --init --network none "$image" bash -ec '
    colcon test --packages-select pylon_bridge pathfinder3 --event-handlers console_direct+
    colcon test-result --verbose
    python3 -m pytest -q src/pylon_bridge/test src/pathfinder3/test
    ' ;;
  run)
    output="${PATHFINDER3_OUTPUT:-/tmp/pathfinder3-$(date +%Y%m%d-%H%M%S)}"
    mkdir -p "$output"
    exec docker run --rm --init --network host --user "$(id -u):$(id -g)" \
      -e ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-176}" -e ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST \
      -e ROS_LOG_DIR=/tmp/ros-logs -v "$output:/results" "$image" \
      ros2 launch pathfinder3 orbit.launch.py output_dir:=/results "$@" ;;
  *) echo 'Usage: PYLON_ROOT=/path/to/PyLoN examples/pathfinder3/spaceros.sh {build|check|run [launch arguments]}' ;;
esac
