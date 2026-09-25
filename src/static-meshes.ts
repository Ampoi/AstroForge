import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge only unnamed leaf meshes with a common parent/material. Named pivots
 * (gimbal, suspension, steering, spring) and part selection boundaries survive. */
export function mergeStaticMeshes(root: THREE.Object3D) {
  for (const child of [...root.children]) mergeStaticMeshes(child);
  const groups = new Map<string, THREE.Mesh[]>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || child.name || child.children.length || Array.isArray(child.material)) continue;
    const attributes = Object.keys(child.geometry.attributes).sort().map(name => {
      const a = child.geometry.getAttribute(name);
      return `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`;
    }).join(',');
    const key = `${child.material.uuid}/${child.castShadow}/${child.receiveShadow}/${!!child.geometry.index}/${attributes}`;
    const group = groups.get(key) ?? []; group.push(child); groups.set(key, group);
  }
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => { mesh.updateMatrix(); return mesh.geometry.clone().applyMatrix4(mesh.matrix); });
    const geometry = mergeGeometries(geometries, false);
    for (const item of geometries) item.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, meshes[0].material);
    mesh.castShadow = meshes[0].castShadow; mesh.receiveShadow = meshes[0].receiveShadow;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    for (const old of meshes) { root.remove(old); old.geometry.dispose(); }
    root.add(mesh);
  }
  return root;
}
