#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${PATHFINDER3_IMAGE:-astroforge-pathfinder3:jazzy-2026.07.0}"
action="${1:-help}"
if (($#)); then shift; fi
case "$action" in
  build) docker build -f "$root/examples/pathfinder3/Dockerfile" -t "$image" "$root" ;;
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
  *) echo 'Usage: examples/pathfinder3/spaceros.sh {build|check|run [launch arguments]}' ;;
esac
