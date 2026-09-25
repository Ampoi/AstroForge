"""Convert MIT PyLoN meshes to compact, indexed Three.js visual assets.

Usage: python3 scripts/import-pylon-models.py PYLON_CHECKOUT IO_OBJECT_MU_MU_PY
Requires numpy and Pillow. The external io_object_mu reader is a build-time tool
only; its source is not copied into AstroForge. See src/assets/pylon/README.md.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

source, reader = map(Path, sys.argv[1:])
spec = importlib.util.spec_from_file_location('mu_reader', reader)
mu_reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mu_reader)
output = Path(__file__).resolve().parents[1] / 'src/assets/pylon'
output.mkdir(parents=True, exist_ok=True)
models = dict(lidar2d='Lidar2D', lidar3d='Lidar3D', camera='RgbCamera',
              startracker='StarTracker', servo='RosServo', linear='RosLinearMotor')
# io_object_mu returns right-handed Blender coordinates; convert Z-up to Y-up.
basis = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])


def matrix(t):
    w, x, y, z = t.localRotation
    rotation = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    result = np.eye(4)
    result[:3, :3] = rotation @ np.diag(t.localScale)
    result[:3, 3] = t.localPosition
    return result


def encoded(values, dtype):
    return base64.b64encode(np.asarray(values, dtype=dtype).tobytes()).decode('ascii')


manifest = {'sourceCommit': subprocess.check_output(
    ['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
    'readerSha256': hashlib.sha256(reader.read_bytes()).hexdigest(), 'models': {}}
for part, folder in models.items():
    directory = source / 'Assets/PyLoN/Models' / folder
    asset = mu_reader.Mu()
    assert asset.read(str(directory / 'model.mu'))
    palette = []
    for material in asset.materials:
        texture = material.textureProperties['_MainTex']
        path = directory / (Path(asset.textures[texture.index].name).name + '.png')
        image = Image.open(path).convert('RGBA')
        # These assets use solid swatches. Fail rather than silently lose detail
        # if upstream starts using image textures.
        assert all(lo == hi for lo, hi in image.getextrema()), path
        r, g, b, a = image.getpixel((0, 0))
        assert a == 255
        palette.append({'name': material.name, 'color': f'#{r:02x}{g:02x}{b:02x}'})
    buckets = {}

    def visit(obj, parent, group='fixed'):
        name = obj.transform.name
        transform = matrix(obj.transform)
        if part == 'camera' and name == 'CameraPivot':
            # The source prefab starts at tilt=0; its part.cfg sets tilt=90.
            tilt = np.eye(4)
            tilt[:3, :3] = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
            transform = transform @ tilt
        world = parent @ transform
        if name in ('ServoRotor', 'LinearSleeve', 'LinearRod'):
            group = name
        if hasattr(obj, 'shared_mesh') and hasattr(obj, 'renderer'):
            mesh = obj.shared_mesh
            assert len(mesh.normals) == len(mesh.verts)
            positions = (np.asarray(mesh.verts) @ world[:3, :3].T + world[:3, 3]) @ basis.T
            normals = np.asarray(mesh.normals) @ np.linalg.inv(world[:3, :3]) @ basis.T
            normals /= np.linalg.norm(normals, axis=1)[:, None]
            for triangles, material_index in zip(mesh.submeshes, obj.renderer.materials, strict=True):
                indices = np.asarray(triangles).reshape(-1)
                buckets.setdefault((group, material_index), []).append(
                    np.concatenate((positions[indices], normals[indices]), axis=1))
        for child in obj.children:
            visit(child, world, group)

    visit(asset.obj, np.eye(4))
    chunks = []
    for (group, material_index), arrays in buckets.items():
        # Deduplicate positions AND split normals without changing triangles.
        vertices, indices = np.unique(np.round(np.concatenate(arrays), 7), axis=0, return_inverse=True)
        assert len(vertices) < 65536
        chunks.append({'group': group, 'material': material_index,
                       'position': encoded(vertices[:, :3], '<f4'),
                       'normal': encoded(np.rint(vertices[:, 3:] * 32767), '<i2'),
                       'index': encoded(indices, '<u2')})
    data = {'materials': palette, 'chunks': chunks}
    (output / f'{part}.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
    inputs = [directory / 'model.mu', *sorted(directory.glob('*.png'))]
    manifest['models'][part] = {'path': f'Assets/PyLoN/Models/{folder}',
                              'sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
                              'triangles': sum(len(base64.b64decode(c['index'])) // 6 for c in chunks)}
    print(part, manifest['models'][part]['triangles'], 'triangles')
(output / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
license_path = output.parents[2] / 'public/assets/pylon/LICENSE'
license_path.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'LICENSE', license_path)
