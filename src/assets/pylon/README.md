# PyLoN visual models

Source: PyLoN `Assets/PyLoN/Models` at commit
`d62d948064d6665702d05957a669596244dca8da`, MIT, © 2026 Toshihiro Tange.
The complete license is in `public/assets/pylon/LICENSE` and ships with Vite output.
`provenance.json` records the source commit, model/texture hashes and reader hash.

These JSON assets contain the original triangle geometry and split normals,
indexed by position and normal (rounded to 1e-7 m). Float32 positions, normalized
Int16 normals and Uint16 indices are encoded as little-endian base64 buffers.
Rigid geometry is combined by material, retaining separate ServoRotor,
LinearSleeve and LinearRod groups. Source collider objects are not imported.
All source textures are uniform 4×4 swatches; their exact sRGB colors are stored
as material colors. The importer fails if any texture ceases to be uniform.
Unity shaders are approximated with Three.js standard materials.

The camera pivot is set to the source part.cfg's 90° default tilt. Coordinate
conversion preserves handedness and winding. Runtime mounting/size adjustments
are in `src/pylon-models.ts`; they preserve AstroForge's existing physics and
attachment interfaces. The axial servo is displayed on the existing Z hinge
axis. Linear stages scale axially to span AstroForge's 2 m travel; this is a
visual adaptation, not a transfer of PyLoN actuator dimensions or behavior.

## Rebuild (only when updating upstream assets)

Use Python 3 with numpy and Pillow. Obtain `mu.py` from the open-source
[io_object_mu reader](https://github.com/taniwha/io_object_mu/blob/master/mu.py)
and verify it against `readerSha256` in the provenance file. This external GPL
reader is only a conversion tool; its code is not bundled or needed at runtime.

```bash
python3 scripts/import-pylon-models.py /path/to/PyLoN /path/to/io_object_mu/mu.py
npm test
```

No upstream files are modified. Normal builds consume the checked-in generated
assets and do not require Python, Blender, io_object_mu or a PyLoN checkout.
For visual inspection, run Vite and open `/tests/pylon-models.html`.

## Verification (2026-09-25)

- Isolated checkout of AstroForge `ba19f72` plus this change: `npm test`
  passed all 158 tests, including typecheck, physics/UI builds and four model
  checks (geometry/normals, mounting, full travel, and instance isolation).
- `npm run docs:build` passed. Vite reports the existing large-chunk warning;
  the UI including the six detailed models is about 3.9 MB / 1.03 MB gzip.
- The model gallery rendered all six models in the Codex in-app browser, at
  rest and at maximum slider travel, with no console errors or warnings.
  The agent-browser CLI was unavailable, so browser verification used the
  installed browser tool. Rendering uses 6–11 draw calls per imported part.
- This change concerns visual models only; no ROS2 demo or bridge was changed.
