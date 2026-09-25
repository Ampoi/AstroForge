# AstroForge ROS2 integration

This directory vendors the standard PyLoN `pylon_bridge`, `pylon_interfaces`, and
`pylon_vehicle_control` packages from revision
`d62d948064d6665702d05957a669596244dca8da` of
[PyLoN](https://github.com/PyLoN-sim/PyLoN/tree/d62d948064d6665702d05957a669596244dca8da).
The package sources are unmodified; the original MIT notice is in
[PyLoN-LICENSE](./PyLoN-LICENSE). They run in separate processes and communicate
with AstroForge exclusively through public UDP. Package READMEs retain upstream
KSP terminology. KSP-specific craft-builder operations are not implemented by
AstroForge.

With ROS2 Jazzy installed, build from the AstroForge repository root:

```sh
source /opt/ros/jazzy/setup.bash
colcon build --base-paths Ros2 --packages-up-to pylon_bridge pylon_vehicle_control
source install/setup.bash
ros2 run pylon_bridge udp_bridge --host 127.0.0.1 --port 49010 --command-port 49011
```

Enable UDP for the selected AstroForge vehicle and use its actual port pair.
Start one bridge per vehicle, in a separate ROS domain or with distinct topic
and frame prefixes. The standard defaults use `/ksp_vessel` for compatibility.
ROS installation and system dependencies are managed by the user; these
packages do not install or start anything as part of AstroForge startup.

The control node accepts `pylon_interfaces/msg/ControlSetpoint` on
`/ksp_vessel/control/setpoint`. Start it in another sourced terminal:

```sh
ros2 run pylon_vehicle_control setpoint_controller --ros-args \
  -p controller_id:=astroforge-controller
```

Publish the desired position and quaternion in `pylon_ground_truth_enu`, using a
fresh ground-truth timestamp, `mode: 3` for six-degree-of-freedom control, and
continuous setpoints at 10–20 Hz. The controller acquires a lease and sends
bounded body wrench requests. A vehicle requires suitable thrusters and enough
power; the default 2000 N force limit cannot lift the starter rocket on Earth.
Configure force limits and gains for the particular vehicle. The controller
releases authority when input or observations become stale.

Verification from a sourced build:

```sh
python3 tests/upstream_compatibility.py . --systems
python3 tests/bridge_roundtrip.py .
python3 tests/ros2-systems-smoke.py
```

The last test starts an isolated physics/UDP fixture, the real ROS2 bridge and
setpoint controller on DDS domain 187. It checks sensor topics, URDF/TF,
thermal/nearby/wheel state, motor movement, port-camera selection, separation
receipts and their query service, and controller wrench output. It neither
starts the application HTTP server nor reads saved vehicle data.
