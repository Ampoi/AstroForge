FROM osrf/space-ros:jazzy-2026.07.0@sha256:a7df4a7bbb7019b45842ce60f4fb7998dcc64ad383c02e9c76ce082031c39fe5
SHELL ["/bin/bash", "-eo", "pipefail", "-c"]
RUN mkdir -p /home/spaceros-user/pathfinder_ws
WORKDIR /home/spaceros-user/pathfinder_ws
COPY --chown=spaceros-user:spaceros-user Ros2/pylon_interfaces src/pylon_interfaces
COPY --chown=spaceros-user:spaceros-user Ros2/pylon_bridge src/pylon_bridge
COPY --chown=spaceros-user:spaceros-user examples/pathfinder3 src/pathfinder3
RUN source /opt/ros/spaceros/setup.bash && colcon build --executor sequential --packages-up-to pathfinder3 --cmake-args -DCMAKE_BUILD_TYPE=Release
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
COPY examples/pathfinder3/entrypoint.sh /tmp/pathfinder-entrypoint.sh
ENTRYPOINT ["/bin/bash", "/tmp/pathfinder-entrypoint.sh"]
CMD ["ros2", "launch", "pathfinder3", "orbit.launch.py"]
