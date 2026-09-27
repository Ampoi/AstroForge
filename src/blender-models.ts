import * as THREE from 'three';
import type {PartType} from '../shared/types.ts';
import docking from './assets/blender/docking.json';
import pod from './assets/blender/pod.json';
import engine from './assets/blender/engine.json';
import booster_engine from './assets/blender/booster_engine.json';
import vacuum_engine from './assets/blender/vacuum_engine.json';
import decoupler from './assets/blender/decoupler.json';
import fin from './assets/blender/fin.json';
import battery from './assets/blender/battery.json';
import chassis from './assets/blender/chassis.json';
import rcs from './assets/blender/rcs.json';
import wheel from './assets/blender/wheel.json';
import solar from './assets/blender/solar.json';

const assets = {docking, pod, engine, booster_engine, vacuum_engine, decoupler, fin, battery, chassis, rcs, wheel, solar};
const decoded = new Map<string, ArrayBuffer>();
function buffer(value: string) {
  let result = decoded.get(value);
  if (!result) {
    result = Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;
    decoded.set(value, result);
  }
  return result;
}

/** Blender-authored visuals in the existing metre/Y-up attachment coordinates.
 * Geometry is batched offline within each material/pivot. Each instance owns its
 * geometry/material wrappers, so selection, ghosting and disposal stay isolated.
 */
export function makeBlenderPart(type: PartType): THREE.Group | null {
  if (!(type in assets)) return null;
  const asset = assets[type as keyof typeof assets], part = new THREE.Group();
  part.userData.blenderModel = type;
  const fixed = new THREE.Group(); fixed.name = 'fixed'; part.add(fixed);
  const groups = new Map<string, THREE.Group>([['fixed', fixed]]);
  for (const node of asset.nodes) {
    const group = new THREE.Group(); group.name = node.name;
    group.position.fromArray(node.position);
    group.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2]);
    group.scale.fromArray(node.scale);
    groups.set(node.name, group);
  }
  for (const node of asset.nodes) groups.get(node.parent)!.add(groups.get(node.name)!);
  // Share a material only within this instance (including its animated groups).
  const materials = asset.materials.map(source => {
    const material = new THREE.MeshStandardMaterial({color: source.color, metalness: source.metalness, roughness: source.roughness});
    material.name = source.name;
    return material;
  });
  for (const chunk of asset.chunks) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer(chunk.position)), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buffer(chunk.normal)), 3, true));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer(chunk.index)), 1));
    const mesh = new THREE.Mesh(geometry, materials[chunk.material]);
    mesh.castShadow = mesh.receiveShadow = true;
    groups.get(chunk.group)!.add(mesh);
  }
  return part;
}
