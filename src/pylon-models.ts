import * as THREE from 'three';
import type {PartType} from '../shared/types.ts';
import {PARTS} from '../shared/craft.ts';
import {SLIM_DIAMETER} from '../shared/part-dimensions.ts';
import lidar2d from './assets/pylon/lidar2d.json';
import lidar3d from './assets/pylon/lidar3d.json';
import camera from './assets/pylon/camera.json';
import startracker from './assets/pylon/startracker.json';
import servo from './assets/pylon/servo.json';
import linear from './assets/pylon/linear.json';

const assets = {lidar2d, lidar3d, camera, startracker, servo, linear};
type ModelType = keyof typeof assets;
const decoded = new Map<string, ArrayBuffer>();
function buffer(value: string) {
  let result = decoded.get(value);
  if (!result) {
    result = Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;
    decoded.set(value, result);
  }
  return result;
}

/** Imported PyLoN visuals, fitted to AstroForge's existing attachment geometry. */
export function makePylonPart(type: PartType): THREE.Group | null {
  if (!(type in assets)) return null;
  const asset = assets[type as ModelType], part = new THREE.Group(), model = new THREE.Group();
  part.userData.pylonModel = type;
  part.add(model);
  const groups = new Map<string, THREE.Group>();
  for (const chunk of asset.chunks) {
    let group = groups.get(chunk.group);
    if (!group) { group = new THREE.Group(); group.name = chunk.group; groups.set(chunk.group, group); model.add(group); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer(chunk.position)), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(buffer(chunk.normal)), 3, true));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer(chunk.index)), 1));
    const source = asset.materials[chunk.material];
    const glass = /glass|lens/i.test(source.name);
    const material = new THREE.MeshStandardMaterial({color: source.color, metalness: glass ? .45 : .25, roughness: glass ? .18 : .5});
    material.name = source.name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (type === 'linear') {
    // Keep both existing stack nodes. Moving stages stretch to cover the full
    // AstroForge travel (2 m), which differs from PyLoN's native 1.6 m travel.
    model.scale.setScalar(PARTS.linear.height / 1.6049312);
    // The source flange is 0.3125 m across; retain stack height/travel while
    // fitting both end flanges to the nominal small attachment standard.
    model.scale.x=model.scale.z=SLIM_DIAMETER/.3125;
    model.position.y = -PARTS.linear.height / 2;
  } else if (type === 'servo') {
    // PyLoN's axial rotor becomes the existing Z-axis hinge in this simulator.
    const scale = PARTS.servo.height / .625;
    model.scale.setScalar(scale);
    model.rotation.x = Math.PI / 2;
    model.position.z = -.07 * scale;
    const rotor = groups.get('ServoRotor')!;
    rotor.position.y = .07;
    for (const mesh of rotor.children as THREE.Mesh[]) {
      // The decoded arrays are shared, so translation must own its vertices.
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.translate(0, -.07, 0);
    }
  } else {
    // Unity +Z (LiDAR) / -Z (optics) faces out from the radial mount (+X).
    model.rotation.y = type.startsWith('lidar') ? -Math.PI / 2 : Math.PI / 2;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    model.position.set(-bounds.min.x, -(bounds.min.y + bounds.max.y) / 2, -(bounds.min.z + bounds.max.z) / 2);
  }
  return part;
}

/** The same joint animation is used for the active vehicle and separated craft. */
export function updatePylonJoint(part: THREE.Object3D, position: number) {
  const rotor = part.getObjectByName('ServoRotor');
  if (rotor) rotor.rotation.y = position;
  const sleeve = part.getObjectByName('LinearSleeve'), rod = part.getObjectByName('LinearRod');
  if (sleeve && rod) {
    const extension = Math.max(0, position), scale = PARTS.linear.height / 1.6049312;
    sleeve.scale.y = 1 + extension / (2 * 1.533 * scale);
    rod.scale.y = 1 + extension / PARTS.linear.height;
  }
}
