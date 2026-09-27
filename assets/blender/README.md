# Blender mechanical part library

Original AstroForge models authored in **Blender 5.2.1 LTS**. The editable source
is [`astroforge-parts.blend`](astroforge-parts.blend). No third-party model,
image texture, add-on or external font is required.

The library covers docking, command pod, three engine variants, separator,
stabilizer/wing surface, battery, chassis, RCS, wheel and solar array. Existing
part types, nominal sizes, attachment datums, colours and animation pivots are
retained. The fuel tank and imported PyLoN instruments/motors are unchanged.

## Contents and editing

Each part has its own named collection. Individual bolts, shell panels, pipe
curves, nozzle walls, cell traces and other components remain editable. Bevel and
weighted-normal modifiers are kept live. Principled materials carry colour,
metalness and roughness. The library is laid out in metres in Blender's Z-up
space; the exporter removes the library placement and restores runtime Y-up.

- `engine-gimbal`: existing pivot at runtime `(0, .24, 0)`.
- `suspension → steering → tire`: existing wheel hierarchy.
- `spring`: existing local-Y stretch, rotated into the suspension direction.
- Root custom property `part_type` and pivot `runtime_name` identify export nodes.
  Keep these names and the root transform convention when editing.

Regenerate the authored library and runtime meshes from the modelling script
(overwrites edits to the `.blend`):

```sh
blender --background --factory-startup -noaudio --threads 4 --python-exit-code 1 \
  --python scripts/build-blender-parts.py
```

Export **manual edits** from the saved `.blend` without rebuilding or modifying
that source file:

```sh
blender --background --factory-startup -noaudio --threads 4 --python-exit-code 1 \
  --python scripts/build-blender-parts.py -- \
  --export-blend assets/blender/astroforge-parts.blend
```

The evaluated meshes are grouped by material within each animated pivot, then
written to `src/assets/blender/*.json`. Positions are float32, split normals are
normalized int16, and triangle indices are uint16. Collapsed triangles at export
precision are removed. `manifest.json` records Blender's version, the generator
hash, each exported file hash, triangle counts and draw calls. Blender is needed
only for authoring/export; normal app builds use the committed assets.

## Visual review and validation

Run `npx vite --host 127.0.0.1 --port 5174`, then open
`http://127.0.0.1:5174/tests/blender-models.html`. The gallery uses the application's
actual `makePart` path. Cards open enlarged views; controls rotate the view, show
the back/underside, and exercise engine gimbals and wheel compression/steering.
[`preview.png`](preview.png) is the front-view contact sheet.

Validated with Blender 5.2.1 LTS (build `9e2066aef7ef`), including reopening and
exporting the saved `.blend`, and with:

```sh
npm test
node --import tsx tests/blender-models.test.js
```

`npm test` passed all 214 tests, including typecheck, physics build and production
UI build. Mesh checks cover normals/winding, degenerate triangles, indices,
export provenance, silhouette envelopes, stack datums, the 0.4 m pod nose,
open engine/separator interiors, animated pivots and independent instances.
The browser gallery was inspected from both sides with the joints at rest and
at their review limits. The assembled craft and palette were also checked in
an isolated app instance.

Models contain 7,856–56,608 triangles. Static parts use 5–9 material batches;
engines use 9–11 and the animated wheel uses 18. Geometry detail increases the
production payload; this is not a GPU performance benchmark.
