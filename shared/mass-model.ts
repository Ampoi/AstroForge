import {DIAMETER, layoutCraft} from './craft.ts';
import {inverse3} from './math.ts';
import type {Craft} from './types.ts';

/** Prepared once per immutable flight configuration. Moments are measured near
 * the dry COM to avoid subtracting large moments about the engine datum. */
export function prepareMassModel(craft: Craft) {
  const parts = layoutCraft(craft).map(p => ({...p, mass: p.def.mass}));
  const dryMass = parts.reduce((s, p) => s + p.mass, 0);
  const origin = [0, 1, 2].map(i => parts.reduce((s, p) => s + p.mass * p.position[i], 0) / dryMass);
  const coefficients = parts.map(p => {
    const r = p.position.map((x, i) => x - origin[i]);
    const rr = r.reduce((s, x) => s + x * x, 0), radius = p.def.radial ? .18 : DIAMETER / 2;
    const own = p.def.width && p.def.depth
      ? [(p.def.width ** 2 + p.def.depth ** 2) / 12, (p.def.height ** 2 + p.def.depth ** 2) / 12, (p.def.height ** 2 + p.def.width ** 2) / 12]
      : [radius ** 2 / 2, (3 * radius ** 2 + p.def.height ** 2) / 12, (3 * radius ** 2 + p.def.height ** 2) / 12];
    return [1, ...r, ...Array.from({length: 9}, (_, k) => {
      const i = Math.floor(k / 3), j = k % 3;
      return (i === j ? rr + own[i] : 0) - r[i] * r[j];
    })];
  });
  const dry = new Float64Array(13), work = new Float64Array(13);
  parts.forEach((p, i) => coefficients[i].forEach((c, j) => dry[j] += c * p.mass));
  const resources = parts.flatMap((p, i) => p.def.fuel || p.def.mono ? [{p, c: coefficients[i]}] : []);
  return {
    craft,
    update(fuel: Record<string, number>, monoFraction: number) {
      work.set(dry);
      for (const {p, c} of resources) {
        const extra = (fuel[p.id] || 0) + (p.def.mono || 0) * monoFraction;
        p.mass = p.def.mass + extra;
        for (let j = 0; j < 13; j++) work[j] += c[j] * extra;
      }
      const mass = work[0], center = [work[1] / mass, work[2] / mass, work[3] / mass];
      const rr = center.reduce((s, x) => s + x * x, 0);
      const inertia = Array.from({length: 9}, (_, k) => {
        const i = Math.floor(k / 3), j = k % 3;
        return work[4 + k] - mass * ((i === j ? rr : 0) - center[i] * center[j]);
      });
      return {mass, com: center.map((x, i) => x + origin[i]), inertia, inverseInertia: inverse3(inertia), parts};
    },
  };
}
