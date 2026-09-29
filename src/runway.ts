import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RUNWAY} from '../shared/launch-sites.ts';
import {LightGlows} from './site-lighting.ts';

/** Batched geometry keeps the runway markings inexpensive at facility scale. */
export function makeRunway() {
  const group = new THREE.Group();
  group.name = 'Runway 09 / 27';
  group.position.set(RUNWAY.east, RUNWAY.height, -RUNWAY.north);
  const batches = new Map<string, THREE.BufferGeometry[]>();
  const lightColors = ['#fff1ce', '#6dff9c', '#ff6555'];
  const lightPositions: number[] = [], lightTints: number[] = [];
  function box(color: string, x: number, z: number, w: number, d: number, y = .015, h = .015) {
    const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y - h / 2, z);
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color)!.push(geometry);
    if (lightColors.includes(color)) {
      lightPositions.push(x, y + .003, z);
      const tint = new THREE.Color(color);
      lightTints.push(tint.r, tint.g, tint.b);
    }
  }
  box('#343b40', 0, 0, RUNWAY.length, RUNWAY.width, 0, .3);
  for (const side of [-1, 1]) {
    box('#e6e8df', 0, side * 28, RUNWAY.length - 20, .4);
    for (let x = -880; x <= 880; x += 40) box('#fff1ce', x, side * 30.5, .65, .65, .12, .12);
    for (const end of [-1, 1]) {
      for (let lane = 1; lane <= 6; lane++) box('#e6e8df', end * 866, side * lane * 3.5, 28, 1.8);
      box('#e6e8df', end * 620, side * 13, 40, 5);
    }
  }
  for (let x = -810; x <= 810; x += 60) box('#e6e8df', x, 0, 28, .65);
  for (let x = -870; x <= 870; x += 30) box('#fff1ce', x, 0, .45, .45, .02, .02);
  for (const end of [-1, 1]) for (let z = -24; z <= 24; z += 4) {
    box('#6dff9c', end * 886, z, .65, 1, .02, .02);
    box('#ff6555', end * 898, z, .65, 1, .02, .02);
  }
  for (const [color, geometries] of batches) {
    const material = new THREE.MeshStandardMaterial({color, roughness: .95});
    if (lightColors.includes(color)) {
      material.emissive.set(color); material.emissiveIntensity = 4;
    }
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  group.add(new LightGlows(lightPositions, lightTints));
  return group;
}
