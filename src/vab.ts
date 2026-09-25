import * as THREE from 'three';

// A cutaway assembly building: the near walls open as the camera moves outside,
// so orbiting and fitting large assemblies never hides the work behind a wall.
export class VabEnvironment extends THREE.Group {
  private walls: { group: THREE.Group; normal: THREE.Vector3 }[] = [];
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly floodShadow: THREE.LightShadow;
  private readonly glowTexture: THREE.DataTexture;
  private readonly surfaces = {
    steel: new THREE.MeshStandardMaterial({ color: '#46575a', metalness: .65, roughness: .6 }),
    wall: new THREE.MeshStandardMaterial({ color: '#263337', metalness: .35, roughness: .85 }),
    deck: new THREE.MeshStandardMaterial({ color: '#566264', metalness: .25, roughness: .75 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#c89842', metalness: .35, roughness: .55 }),
    dark: new THREE.MeshStandardMaterial({ color: '#111b20', roughness: .8 }),
    white: new THREE.MeshBasicMaterial({ color: '#d6eeef' }),
    amber: new THREE.MeshBasicMaterial({ color: '#ffc17b' }),
  };

  constructor() {
    super();
    this.name = 'Vehicle assembly building';
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, radius = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      pixels.set([255, 255, 255, Math.round(Math.pow(Math.max(0, 1 - radius), 2.5) * 150)], i);
    }
    this.glowTexture = new THREE.DataTexture(pixels, 64, 64);
    this.glowTexture.needsUpdate = true;
    const glow = (color: string) => new THREE.MeshBasicMaterial({ color, map: this.glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const amberGlow = glow('#ffa14e'), whiteGlow = glow('#c8ebff');
    const glowPlane = new THREE.PlaneGeometry(1, 1);
    for (let side = 0; side < 4; side++) {
      const wall = new THREE.Group();
      wall.rotation.y = side * Math.PI / 2;
      this.add(wall);
      this.walls.push({ group: wall, normal: new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), wall.rotation.y) });
      const batches = new Map<keyof typeof this.surfaces, THREE.Matrix4[]>();
      const box = (kind: keyof typeof this.surfaces, x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) => {
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle), new THREE.Vector3(w, h, d));
        if (!batches.has(kind)) batches.set(kind, []);
        batches.get(kind)!.push(matrix);
      };
      box('wall', 0, 30, -23, 46, 60, .3);
      for (let x = -22; x <= 22; x += .8) box('steel', x, 30, -22.75, .075, 60, .12);
      for (const x of [-21, -7, 7, 21]) {
        box('steel', x, 30, -21.9, .45, 60, .65);
        for (const flange of [-.35, .35]) box('steel', x, 30, -21.9 + flange, .85, 60, .09);
      }
      for (const y of [4, 12, 20, 28, 36, 44, 52]) {
        box('deck', 0, y, -20, 44, .25, 5);
        box('steel', 0, y - .45, -17.6, 44, .65, .18);
        box('yellow', 0, y + 1.15, -17.5, 44, .07, .07);
        box('steel', 0, y + .65, -17.5, 44, .045, .045);
        for (let x = -21; x <= 21; x += 2) box('yellow', x, y + .6, -17.5, .055, 1.2, .055);
        for (const x of [-14, 0, 14]) {
          box('steel', x, y + 4, -21.5, .22, 15.8, .24, 1.05);
          box('steel', x, y + 4, -21.5, .22, 15.8, .24, -1.05);
          box('dark', x, y + 2.5, -22.4, 1.3, .5, .4);
          box('amber', x, y + 2.4, -22.1, .9, .16, .12);
          box('white', x, y - .2, -17.45, 2.4, .055, .08);
          const pool = new THREE.Mesh(glowPlane, amberGlow);
          pool.position.set(x, y + 1.8, -22.5); pool.scale.set(6, 6, 1); wall.add(pool);
        }
        // Service ladders, set back from the unobstructed assembly volume.
        for (let rung = 0; rung < 20; rung++) box('steel', 19, y + rung * .4, -18.6, .7, .055, .08);
        for (const x of [18.6, 19.4]) box('yellow', x, y + 4, -18.6, .06, 8, .09);
      }
      for (const x of [-20, -19.5]) box('yellow', x, 28, -22.2, .12, 56, .12);
      for (const [kind, matrices] of batches) {
        const mesh = new THREE.InstancedMesh(this.unitBox, this.surfaces[kind], matrices.length);
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.receiveShadow = true;
        wall.add(mesh);
      }
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#46545a', metalness: .15, roughness: .85 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; floor.receiveShadow = true; this.add(floor);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.7, .12, 96), this.surfaces.deck);
    platform.position.y = -.055; platform.receiveShadow = true; this.add(platform);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.25, 4.29, 128), this.surfaces.yellow);
    ring.rotation.x = -Math.PI / 2; ring.position.y = .009; this.add(ring);
    for (let i = 0; i < 48; i++) {
      const a = i * Math.PI / 24;
      const mark = new THREE.Mesh(this.unitBox, i % 2 ? this.surfaces.dark : this.surfaces.yellow);
      mark.scale.set(.18, .012, .3); mark.position.set(Math.cos(a) * 4.48, .012, Math.sin(a) * 4.48); mark.rotation.y = -a; this.add(mark);
    }
    for (const x of [-6, 6]) {
      const lane = new THREE.Mesh(this.unitBox, this.surfaces.yellow);
      lane.scale.set(.065, .015, 32); lane.position.set(x, -.06, 0); this.add(lane);
      for (const z of [-5, 0, 5]) {
        const fixture = new THREE.Group(); fixture.position.set(x, .12, z); this.add(fixture);
        const base = new THREE.Mesh(this.unitBox, this.surfaces.dark); base.scale.set(.8, .22, .55); fixture.add(base);
        const lens = new THREE.Mesh(this.unitBox, this.surfaces.white); lens.scale.set(.62, .035, .32); lens.position.y = .14; fixture.add(lens);
        const pool = new THREE.Mesh(glowPlane, whiteGlow);
        pool.rotation.x = -Math.PI / 2; pool.position.set(x * .82, -.045, z); pool.scale.set(5, 5, 1); this.add(pool);
      }
    }
    const ambient = new THREE.HemisphereLight('#8aa7b7', '#6b7972', .8); this.add(ambient);
    // Broad floor-mounted floods keep undersides bright without per-lamp shadows.
    const floods: THREE.DirectionalLight[] = [];
    for (const [color, intensity, x, y, z] of [
      ['#dcefff', 3.4, 4, .4, 7], ['#9ccee6', 1.5, -6, 1, 2], ['#ffbe83', .9, -8, 3, -12],
    ] as const) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(x, y, z); light.target.position.set(0, 7, 0); this.add(light, light.target);
      floods.push(light);
    }
    floods[0].castShadow = true;
    this.floodShadow = floods[0].shadow;
    this.floodShadow.mapSize.set(1024, 1024);
    Object.assign(this.floodShadow.camera, { left: -16, right: 16, top: 32, bottom: -16, near: .1, far: 100 });
    this.floodShadow.normalBias = .035;
  }

  update(camera: THREE.Camera) {
    for (const { group, normal } of this.walls) group.visible = camera.position.dot(normal) < 20;
  }

  // Mesh geometry/materials are released by RocketScene's normal scene traversal.
  dispose() { this.glowTexture.dispose(); this.floodShadow.dispose(); }
}

// Existing outdoor lights stay intact and resume when returning to flight.
export function setVabLighting(scene: THREE.Scene, active: boolean) {
  for (const child of scene.children) if (child instanceof THREE.Light) child.visible = !active;
}
