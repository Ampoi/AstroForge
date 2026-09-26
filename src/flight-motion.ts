import {Quaternion} from 'three';
import {fixedPosition} from '../shared/terrain.ts';
import type {FlightSnapshot} from '../server/types.ts';

function compatible(a: FlightSnapshot, b: FlightSnapshot) {
  return a.id === b.id && a.status === b.status && b.time >= a.time &&
    JSON.stringify(a.craft) === JSON.stringify(b.craft);
}
function blend(a: FlightSnapshot, b: FlightSnapshot, t: number): FlightSnapshot {
  const scalar = (x: number, y: number) => x + (y - x) * t;
  const vector = (x: number[], y: number[]) => x.map((v, i) => scalar(v, y[i]));
  const q = new Quaternion().fromArray(a.quaternion).slerp(new Quaternion().fromArray(b.quaternion), t);
  const wheels=(b.wheels||[]).map(w=>{
    const old=a.wheels?.find(v=>v.id===w.id);if(!old)return w;
    const delta=Math.atan2(Math.sin(w.rotation-old.rotation),Math.cos(w.rotation-old.rotation));
    return {...w,compression:scalar(old.compression,w.compression),steering:scalar(old.steering,w.steering),rotation:old.rotation+delta*t};
  });
  const time=scalar(a.time,b.time);
  // Interpolate resting craft in the rotating frame, rather than cutting a
  // chord through the planet at high time warp.
  const position=['pad','landed','crashed'].includes(b.status)
    ?fixedPosition(vector(fixedPosition(a.position,a.time),fixedPosition(b.position,b.time)),-time)
    :vector(a.position,b.position);
  return {...b, wheels, time, position, altitudeAsl:scalar(a.altitudeAsl,b.altitudeAsl),
    quaternion: q.toArray(), com: vector(a.com, b.com), altitude: scalar(a.altitude, b.altitude)};
}

/** Smooth display poses over one received interval; never extrapolate physics. */
export class FlightMotion {
  private from: FlightSnapshot | null = null;
  private to: FlightSnapshot | null = null;
  private received = 0;
  private duration = 100;
  private blendDebris = new Set<string>();
  clear() { this.from = this.to = null; this.blendDebris.clear(); }
  snap() { this.from = this.to; }
  push(next: FlightSnapshot, now: number) {
    const previous = this.to, gap = now - this.received;
    const continuous = previous && compatible(previous, next) && gap <= 500 && gap >= 0;
    if (continuous && next.time === previous.time) { this.to = next; return; }
    this.from = continuous ? this.sample(now) : next;
    this.to = next;
    this.received = now;
    this.duration = Math.max(50, Math.min(200, gap));
    this.blendDebris.clear();
    for (const debris of next.debris) {
      const old = this.from?.debris.find(item => item.id === debris.id);
      if (old && compatible(old, debris)) this.blendDebris.add(debris.id);
    }
  }
  sample(now: number): FlightSnapshot | null {
    if (!this.from || !this.to) return this.to;
    const t = Math.max(0, Math.min(1, (now - this.received) / this.duration));
    if (t >= 1 || this.from === this.to) return this.to;
    const oldDebris = new Map(this.from.debris.map(item => [item.id, item]));
    return {...blend(this.from, this.to, t), debris: this.to.debris.map(item => {
      const old = oldDebris.get(item.id);
      return old && this.blendDebris.has(item.id) ? blend(old, item, t) : item;
    })};
  }
}
