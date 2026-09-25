import {Vector3} from 'three';
import type {ExhaustFrame} from './exhaust.ts';
interface Api {
  memory: WebAssembly.Memory; abi_version(): number;
  particles_ptr(): number; frame_ptr(): number; emitters_ptr(): number; obstacles_ptr(): number;
  particle_count(): number; clear(): void; step(emitters: number, obstacles: number, capacity: number): number;
}
/** One bounded arena per effect; rendering reads particle memory without copying it. */
export class WasmExhaustFlow {
  readonly data: Float64Array;
  readonly capacity: number;
  private api: Api;
  private frame: Float64Array;
  private emitters: Float64Array;
  private obstacles: Float64Array;
  private origin = new Vector3();
  private shift = new Vector3();
  private hasOrigin = false;
  constructor(module: WebAssembly.Module, capacity = 2400) {
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 2400) throw RangeError('Exhaust capacity must be 0–2400');
    this.capacity = capacity;
    this.api = new WebAssembly.Instance(module).exports as unknown as Api;
    if (this.api.abi_version() !== 1) throw Error('Exhaust Wasm ABI mismatch');
    const memory = this.api.memory.buffer;
    this.data = new Float64Array(memory, this.api.particles_ptr(), 2400 * 10);
    this.frame = new Float64Array(memory, this.api.frame_ptr(), 13);
    this.emitters = new Float64Array(memory, this.api.emitters_ptr(), 800);
    this.obstacles = new Float64Array(memory, this.api.obstacles_ptr(), 800);
  }
  get count() { return this.api.particle_count(); }
  // Diagnostic compatibility only; the renderer uses data/count directly.
  get particles() {
    return Array.from({length: this.count}, (_, i) => {
      const k = i * 10, d = this.data;
      return {position: new Vector3(d[k], d[k+1], d[k+2]), velocity: new Vector3(d[k+3], d[k+4], d[k+5]),
        age: d[k+6], life: d[k+7], size: d[k+8], seed: d[k+9]};
    });
  }
  clear() { this.api.clear(); this.hasOrigin = false; }
  step(dt: number, frame: ExhaustFrame) {
    if (!Number.isFinite(dt)) { this.clear(); return; }
    if (dt < 0) { this.clear(); dt = 0; }
    if (dt > .3) {
      this.clear(); dt = 1 / 15;
      this.origin.copy(frame.origin).addScaledVector(frame.emitters[0]?.velocity ?? frame.airVelocity, -dt);
      this.hasOrigin = true;
    }
    this.shift.set(0, 0, 0);
    if (this.hasOrigin) this.shift.subVectors(frame.origin, this.origin);
    this.origin.copy(frame.origin); this.hasOrigin = true;
    if (dt === 0) return;
    const steps = Math.ceil(dt * 120);
    this.shift.multiplyScalar(1 / steps).toArray(this.frame, 0);
    frame.airVelocity.toArray(this.frame, 3); frame.up.toArray(this.frame, 6);
    this.frame[9] = frame.groundHeight; this.frame[10] = frame.density;
    this.frame[11] = dt / steps; this.frame[12] = steps;
    let emitters = 0;
    for (const e of frame.emitters) {
      if (e.throttle <= 0) continue;
      if (emitters === 80) throw RangeError('Exhaust supports at most 80 emitters');
      const k = emitters++ * 10;
      e.position.toArray(this.emitters, k); e.direction.toArray(this.emitters, k+3);
      e.velocity.toArray(this.emitters, k+6); this.emitters[k+9] = e.throttle;
    }
    if (frame.obstacles.length > 80) throw RangeError('Exhaust supports at most 80 obstacles');
    frame.obstacles.forEach((b, i) => {
      const k = i * 10;
      b.start.toArray(this.obstacles, k); b.end.toArray(this.obstacles, k+3);
      this.obstacles[k+6] = b.radius; (b.velocity ?? frame.airVelocity).toArray(this.obstacles, k+7);
    });
    if (!this.api.step(emitters, frame.obstacles.length, this.capacity)) this.clear();
  }
}
let pending: Promise<WebAssembly.Module> | undefined;
export function loadExhaustKernel() {
  return pending ??= fetch(new URL('../build/exhaust.wasm', import.meta.url))
    .then(response => { if (!response.ok) throw Error(`Exhaust Wasm HTTP ${response.status}`); return response.arrayBuffer(); })
    .then(bytes => WebAssembly.compile(bytes));
}
