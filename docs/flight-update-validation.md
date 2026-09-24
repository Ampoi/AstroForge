# Flight workspace update — validation

Date: 2026-09-23

- `npm test`: 62 tests pass, including the concurrent Zig/Wasm backend tests.
- `npm start`: physics build, VitePress build, then HTTP/UDP startup succeeds.
- `npm run docs:build`: all Markdown links validate and all pages render.
- Dependencies: VitePress 2.0.0-alpha.20 pinned; npm reports zero known vulnerabilities at installation.
- Browser: default flight workspace, GMT-only clock, new VAB flow, two-stage preset, name/save, saved library, launch, ×10/×1, independent focus/control selection, HTTP API documentation and navigation verified.
- Real UDP demo: flew and separated a two-stage rocket at ×10, then observed destroyed vehicle and detached stage after their return to the ground. Also placed a second vehicle while the first was flying and focused the first without changing the UDP target.
- Physics regressions: controlled soft landing; ground breakup and catastrophic removal; moving fragments and cleanup; head-on and high-speed swept collisions; near misses; normal stage separation; fixed-step time scaling and real-time command expiration.
- API regressions: startup in flight; multiple saved crafts and replacement; saved library survives process restart; VAB preserves flight/session; invalid time scale/IDs/craft rejection; multiple active vehicles; old UDP sessions rejected after target switch; SSE initial snapshot.

The collision model uses approximate part spheres and stack-joint fragmentation, not a material-strength model. Debris expires after 20 simulation seconds. Camera targeting is local to each browser; UDP now supports independent per-vehicle channels; see validation.md for the multi-vehicle checks.
