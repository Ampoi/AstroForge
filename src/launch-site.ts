import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

/** Blender-authored scenery in metres, with the existing launch contact at Y=0.
 * The small apron is also the offline/loading fallback, so the vehicle never
 * appears to float while the external model is being fetched.
 */
export class LaunchSite extends THREE.Group {
  readonly ready: Promise<void>;
  loadError: unknown = null;
  private disposed = false;

  constructor() {
    super();
    this.name = 'Launch Complex 01';
    this.userData.loadState = 'loading';
    const fallback = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({color: '#aeb3af', roughness: .9});
    for (const [x, y, z, w, h, d] of [
      [0, -1.02, 0, 92, .35, 92],
      [-7, -.5, 0, 11, 1, 13],
      [7, -.5, 0, 11, 1, 13],
      [0, -.5, 4.5, 3, 1, 4],
    ]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      fallback.add(mesh);
    }
    this.add(fallback);
    const base = import.meta.env?.BASE_URL ?? '/';
    this.ready = new GLTFLoader().loadAsync(`${base}assets/launch-complex/launch-complex.glb`).then(gltf => {
      if (this.disposed) {
        disposeMeshes(gltf.scene);
        return;
      }
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      this.remove(fallback);
      disposeMeshes(fallback);
      this.add(gltf.scene);
      this.userData.loadState = 'ready';
    }).catch(error => {
      if (this.disposed) return;
      this.loadError = error;
      this.userData.loadState = 'error';
      console.error('Launch complex could not be loaded; retaining the launch apron.', error);
    });
  }

  dispose() {
    this.disposed = true;
    disposeMeshes(this);
    this.clear();
  }
}

function disposeMeshes(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function makeLaunchSite() {
  return new LaunchSite();
}
