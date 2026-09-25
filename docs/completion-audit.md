> Historical audit of the initial MVP. The integrated browser demo described below has since been replaced by the standalone UDP CLI; see README.md and validation.md for the current workflow.

# MVP requirements and verification — 2026-09-23

The previous implementation pass made concrete progress: it added the UDP autopilot and Earth/space renderer. This pass inspected the current source and running server, verified the assembly changes, and filled the standard IMU, electrical observation and coherent snapshot gap.

| Requirement | Implementation | Observed evidence |
|---|---|---|
| Local browser game, Unity not required | Node HTTP server, Three.js, local procedural assets | `npm start` serves `http://localhost:3000`; current browser renders assembly and flight; no external runtime assets |
| Real UDP control and telemetry | `server/protocol.js`, `server/observations.js`; commands :49011, state :49010 | `tests/udp_smoke.py` passes actual socket ignition, ascent, replay rejection, command timeout, emergency stop, IMU, power and snapshot checks |
| PyLoN-compatible rocket control | Versioned session/lease/sequence, attitude, engine/RCS/separation, body wrench, atomic batch, observations | Upstream commit d62d948 decodes 119 packets; 7 upstream-generated command types accepted. Snapshot uses upstream's stricter coherent-observation validator |
| Lightweight | One npm runtime dependency; analytic Earth rendering; 120 Hz physics | Local browser payload 2.14 MiB uncompressed. See measured CPU results below |
| Assemble parts with mirror, repetition and snap | Common 1.25 m stack; free surface positioning; 1/2/4/6 symmetry; mirror; nearby snap points; preview; Undo | Browser: moved an RCS group to free offset −0.101 / 106°, then snapped to 0 / 135°; added a mirrored solar pair; restored original craft. `assembly.test.js` covers placement, symmetry, preview agreement and invalid targets |
| Required parts | Pod, tanks, engine, fins, RCS, battery and solar; separator also available | Catalog, geometry and physical properties in `shared/craft.js` and `public/scene.js`; starter craft launches through real UDP; power tests verify generation, eclipse and consumption |
| Credible MVP aerodynamics and orbital calculations | ISA atmosphere, density-based drag and fin forces/torques, variable mass/inertia, 6DoF RK4, inverse-square gravity, two-body elements | Reference atmosphere values; analytic apsides; three-orbit energy and angular momentum preservation; dissipative/stabilizing aerodynamic tests; mass/fuel and separation momentum conservation |
| UDP demonstration | Browser start/stop controls an independent UDP client; Python example also supplied | `tests/browser_demo.py` passes ignition, concurrent external telemetry, stop/release, restart and external takeover; numerical demo reaches >100 km; browser real-time run reached about 160 km |
| Earth and space | Coastlines, procedural clouds/stars, atmosphere, Sun, day/night, flight trail and vehicle marker; follow/globe cameras | Browser visual confirmation of coastlines, atmospheric limb, stars, marker and camera switching, without console warnings/errors |

## Current automated results

- `npm test`: 38 / 38 passed.
- `python3 tests/upstream_compatibility.py /tmp/astroforge-pylon-reference`: 119 packets decoded and 7 commands accepted.
- `python3 tests/udp_smoke.py`: passed against the restarted server, including the new observations.
- `python3 tests/browser_demo.py`: passed against the restarted server.
- `node tests/separation-smoke.js http://127.0.0.1:3003`: passed on an isolated server; verified real UDP separation, detached-body telemetry, upper-stage ignition and duplicate rejection. Temporary server stopped after the check.
- Source checks and `git diff --check`: passed.

## Measured CPU and payload size

`npm run benchmark`, Node v24.18.0 / macOS. Each case simulates ten seconds at 120 Hz and serializes telemetry at 20 Hz, after a warmup.

| Parts | Wall time for 10 simulated seconds | Physics step p95 | Approximate share of one CPU core at real time |
|---|---:|---:|---:|
| 13 | 229.2 ms | 0.333 ms | 2.29% |
| 80 | 1,879.8 ms | 2.801 ms | 18.80% |

The benchmark process used 76.3 MiB RSS; this includes the Node runtime. These are machine-specific measurements, not minimum-hardware guarantees. WebGL rendering, browser memory, network I/O and browser SSE serialization are excluded from this CPU benchmark. All browser JS/CSS/HTML/SVG/land data and the three shipped Three.js modules total 2.14 MiB uncompressed.

## Explicit boundaries

The requested rocket MVP is implemented. PyLoN compatibility covers the rocket control and observation contract documented in `protocol.md`; sensors, motors, docking and URDF/TF now have AstroForge simulation implementations described in `systems.md`. The upstream test validates actual encoders/decoders, and `tests/ros2-systems-smoke.py` additionally checks a real ROS2/DDS installation.

Aerodynamics uses coefficients and an ISA model, not CFD or coefficients identified from a real vehicle. Earth clouds and scattering are visual approximations. These limitations are recorded in README.md and are not used as evidence of higher physical fidelity.
