import * as THREE from 'three';
import {WasmExhaustFlow, loadExhaustKernel} from './exhaust-kernel.ts';
import {ExhaustPlume} from './exhaust-plume.ts';

const UP = new THREE.Vector3(0, 1, 0);
/** Same six-degree, normalized thrust vector as Simulation.actuation, in model axes. */
export function engineGimbal(pitch: number, yaw: number) {
  return new THREE.Quaternion().setFromUnitVectors(UP,
    new THREE.Vector3(yaw * Math.tan(Math.PI / 30), 1, pitch * Math.tan(Math.PI / 30)).normalize());
}
export interface ExhaustEmitter {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  velocity: THREE.Vector3;
  throttle: number;
}
export interface ExhaustObstacle { start: THREE.Vector3; end: THREE.Vector3; radius: number; velocity?: THREE.Vector3 }
export interface ExhaustFrame {
  origin: THREE.Vector3;
  airVelocity: THREE.Vector3;
  up: THREE.Vector3;
  groundHeight: number;
  density: number;
  emitters: ExhaustEmitter[];
  obstacles: ExhaustObstacle[];
}
interface Parcel {
  position: THREE.Vector3; velocity: THREE.Vector3;
  age: number; life: number; size: number; seed: number;
}

/** Lagrangian visual flow: entrainment, buoyancy, eddies and surface slip.
 * Coordinates are inertial, relative to the current vessel COM; never feed forces back to physics.
 * Jet speeds and cooling times are artistic scales, not a combustion/CFD solution.
 */
export class ExhaustFlow {
  readonly particles: Parcel[] = [];
  private origin: THREE.Vector3 | null = null;
  private credit = 0;
  private serial = 0;
  constructor(readonly capacity = 2400) {}
  clear() { this.particles.length = 0; this.origin = null; this.credit = 0; }
  step(dt: number, frame: ExhaustFrame) {
    if (dt < 0) { this.clear(); dt = 0; }
    // Keep a fresh short jet at high time warp or after a stall, with bounded catch-up work.
    if (dt > .3) {
      this.clear(); dt = 1 / 15;
      this.origin = frame.origin.clone().addScaledVector(frame.emitters[0]?.velocity ?? frame.airVelocity, -dt);
    }
    const shift = this.origin ? frame.origin.clone().sub(this.origin) : new THREE.Vector3();
    this.origin = frame.origin.clone();
    if (dt === 0) return;
    const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
    shift.multiplyScalar(1 / steps);
    const density = THREE.MathUtils.clamp(frame.density, 0, 1);
    const axis = new THREE.Vector3(), nearest = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let step = 0; step < steps; step++) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]; p.age += h;
        if (p.age >= p.life) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
        // The hot core keeps momentum; mixed outer gas quickly follows the ambient air.
        const mix = 1 - Math.exp(-density * (.5 + p.age * 32) * h);
        p.velocity.lerp(frame.airVelocity, mix);
        const eddy = density * Math.min(1, p.age * 5) * 7 * h;
        p.velocity.x += Math.sin(p.seed + p.age * 13 + p.position.z * 1.6) * eddy;
        p.velocity.z += Math.cos(p.seed * 1.7 + p.age * 11 + p.position.x * 1.6) * eddy;
        p.velocity.addScaledVector(frame.up, density * 4 * h);
        p.position.addScaledVector(p.velocity, h).sub(shift);
        // Slip along the ground: turn the impinging jet into an expanding wall jet.
        const height = p.position.dot(frame.up) + frame.groundHeight;
        if (height < .06 && density > .001) {
          p.position.addScaledVector(frame.up, .06 - height);
          normal.copy(p.position).addScaledVector(frame.up, -p.position.dot(frame.up));
          if (normal.lengthSq() < .01) normal.set(Math.cos(p.seed), 0, Math.sin(p.seed)).addScaledVector(frame.up, -normal.dot(frame.up));
          normal.normalize();
          const incoming = p.velocity.clone().sub(frame.airVelocity).dot(frame.up);
          if (incoming < 0) p.velocity.addScaledVector(frame.up, -incoming).addScaledVector(normal, -incoming * .65);
        }
        // Capsule obstacles keep recirculating gas outside the hull while letting it wash up its sides.
        for (const body of frame.obstacles) {
          axis.subVectors(body.end, body.start);
          const t = THREE.MathUtils.clamp(nearest.subVectors(p.position, body.start).dot(axis) / (axis.lengthSq() || 1), 0, 1);
          nearest.copy(body.start).addScaledVector(axis, t); normal.subVectors(p.position, nearest);
          const radius = body.radius + p.size * .15;
          if (normal.lengthSq() >= radius * radius) continue;
          if (normal.lengthSq() < 1e-10) normal.set(Math.cos(p.seed), 0, Math.sin(p.seed));
          normal.normalize(); p.position.copy(nearest).addScaledVector(normal, radius);
          const inward = p.velocity.clone().sub(body.velocity ?? frame.airVelocity).dot(normal);
          if (inward < 0) p.velocity.addScaledVector(normal, -inward);
        }
      }
      const active = frame.emitters.filter(e => e.throttle > 0);
      if (!active.length) { this.credit = 0; continue; }
      // Bounded total emission rate, shared fairly across engines.
      this.credit += h * Math.min(1500, 1200 * active.length);
      while (this.credit >= 1 && this.particles.length < this.capacity) {
        this.credit--;
        const serial = this.serial++, e = active[serial % active.length];
        const seed = serial * 2.3999632297, spread = Math.sqrt((serial * .61803398875) % 1);
        const tangent = new THREE.Vector3(1, 0, 0);
        if (Math.abs(e.direction.x) > .9) tangent.set(0, 1, 0);
        tangent.cross(e.direction).normalize();
        const side = new THREE.Vector3().crossVectors(e.direction, tangent);
        const radial = tangent.multiplyScalar(Math.cos(seed)).addScaledVector(side, Math.sin(seed));
        const throttle = THREE.MathUtils.clamp(e.throttle, 0, 1);
        const speed = 72 * Math.sqrt(throttle) * (1 - .58 * spread * spread);
        this.particles.push({position: e.position.clone().addScaledVector(radial, .38 * spread),
          velocity: e.velocity.clone().addScaledVector(e.direction, speed).addScaledVector(radial, (2 + 5 * (1 - density)) * spread),
          age: 0, life: (.65 + density * .9) * (.35 + .65 * Math.sqrt(throttle)), size: (.20 + .20 * spread) * Math.sqrt(throttle), seed});
      }
      this.credit = Math.min(this.credit, 1);
    }
  }
}

export class ExhaustEffect {
  flow: ExhaustFlow | WasmExhaustFlow = new ExhaustFlow();
  private plume = new ExhaustPlume();
  private disposed = false;
  private view = new THREE.Matrix4();
  private order = new Uint32Array(2400);
  private depths = new Float64Array(2400);
  private geometry = new THREE.InstancedBufferGeometry();
  private offsets = new Float32Array(this.flow.capacity * 3);
  private values = new Float32Array(this.flow.capacity * 3);
  private material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: {air: {value: 1}},
    vertexShader: `
      attribute vec3 offset; attribute vec3 parcel;
      varying vec2 uvFlow; varying float age; varying float fade;
      void main(){
        uvFlow=uv; age=parcel.y; fade=parcel.z;
        vec4 center=modelViewMatrix*vec4(offset,1.0);
        center.xy+=position.xy*parcel.x;
        gl_Position=projectionMatrix*center;
      }`,
    fragmentShader: `
      uniform float air;
      varying vec2 uvFlow; varying float age; varying float fade;
      void main(){
        float r=length(uvFlow*2.0-1.0); if(r>1.0) discard;
        // Parcels represent only the dilute, cooled mixing wake. Emission is
        // continuous gas, rendered separately; never light up individual dots.
        float alpha=exp(-r*r*5.0)*(1.0-smoothstep(.65,1.0,r))*
          smoothstep(.08,.3,age)*.006*air*fade;
        gl_FragColor=vec4(vec3(.48,.52,.55),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  readonly mesh: THREE.Mesh;
  constructor() {
    if (typeof window !== 'undefined') void loadExhaustKernel().then(module => {
      if (!this.disposed) this.flow = new WasmExhaustFlow(module);
    }).catch(error => console.warn('Exhaust uses the JS fallback:', error));
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(this.offsets, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('parcel', new THREE.InstancedBufferAttribute(this.values, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.frustumCulled = false;
    this.mesh.name = 'engine-exhaust';
    this.mesh.add(this.plume.mesh);
  }
  clear() { this.flow.clear(); this.geometry.instanceCount = 0; this.plume.clear(); }
  update(dt: number, frame: ExhaustFrame, camera: THREE.Camera) {
    this.plume.update(dt < 0 ? {...frame, emitters: []} : frame);
    this.material.uniforms.air.value = THREE.MathUtils.clamp(frame.density, 0, 1);
    // This parcel field is the atmospheric mixing wake, not the hot free jet.
    // No atmosphere means no entrained smoke and no CPU/overdraw cost for it.
    if (frame.density < .001) this.flow.clear();
    else this.flow.step(dt, frame);
    this.mesh.updateMatrixWorld(); camera.updateMatrixWorld();
    const view = this.view.multiplyMatrices(camera.matrixWorldInverse, this.mesh.matrixWorld).elements;
    const data = this.flow instanceof WasmExhaustFlow ? this.flow.data : null;
    const particles = this.flow instanceof ExhaustFlow ? this.flow.particles : null;
    const alive = data ? (this.flow as WasmExhaustFlow).count : particles!.length;
    let count = 0;
    for (let i = 0; i < alive; i++) {
      const k = i * 10, p = particles?.[i];
      const age = data ? data[k+6] : p!.age, seed = data ? data[k+9] : p!.seed;
      // Stable, emission-seeded thinning; compensate optical weight below.
      // Never render the young parcels that used to expose the spiral pattern.
      if (age < .08 || Math.floor(seed * 1000) % 3 !== 0 || count === 800) continue;
      this.order[count++] = i;
      this.depths[i] = view[2]*(data ? data[k] : p!.position.x) + view[6]*(data ? data[k+1] : p!.position.y) + view[10]*(data ? data[k+2] : p!.position.z);
    }
    // Cache each depth once and sort indices, keeping simulation order stable.
    const order = this.order.subarray(0, count);
    order.sort((a, b) => this.depths[a] - this.depths[b] || a - b);
    for (let i = 0; i < count; i++) {
      const index = order[i], k = index * 10, j = i * 3, p = particles?.[index];
      this.offsets[j] = data ? data[k] : p!.position.x;
      this.offsets[j+1] = data ? data[k+1] : p!.position.y;
      this.offsets[j+2] = data ? data[k+2] : p!.position.z;
      const age = data ? data[k+6] : p!.age, life = data ? data[k+7] : p!.life, size = data ? data[k+8] : p!.size;
      const radius = size + .3 + age * (1 + .8 * frame.density);
      this.values[j] = 2 * radius;
      // Projected optical depth falls with parcel area as the mixed gas spreads.
      this.values[j+1] = age;
      this.values[j+2] = 3 * Math.min(1, (life - age) * 3) * ((size + .3) / radius) ** 2;
    }
    this.geometry.instanceCount = count;
    for (const name of ['offset', 'parcel']) {
      const attribute = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, count * 3); attribute.needsUpdate = true;
    }
  }
  dispose() { this.disposed = true; this.geometry.dispose(); this.material.dispose(); this.plume.dispose(); }
}
