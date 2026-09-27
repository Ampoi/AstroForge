import { PARTS, isEngine } from '../shared/craft.ts';
import type { Part } from '../shared/types.ts';
import type { FlightSnapshot } from '../server/types.ts';

export const partInfoFields = [
  { key: 'id', label: 'パーツID' }, { key: 'name', label: 'パーツ名' },
  { key: 'status', label: '動作状態（ON / OFF）' },
  { key: 'angle', label: 'ジンバル角・関節位置' }, { key: 'output', label: '出力' },
] as const;
export type PartInfoField = typeof partInfoFields[number]['key'];
export type PartInfoSettings = { enabled: boolean } & Record<PartInfoField, boolean>;
export const defaultPartInfoSettings: PartInfoSettings = { enabled: false, id: true, name: false, status: true, angle: true, output: true };
export function restorePartInfoSettings(value: unknown): PartInfoSettings {
  const settings = { ...defaultPartInfoSettings };
  if (value && typeof value === 'object') for (const key of Object.keys(settings) as (keyof PartInfoSettings)[]) {
    if (key in value && typeof (value as Record<string, unknown>)[key] === 'boolean') settings[key] = (value as PartInfoSettings)[key];
  }
  return settings;
}
export type PartInfoRow = { key: PartInfoField; label: string; value: string };
type PartSnapshot = Pick<FlightSnapshot, 'engines' | 'wheels' | 'joints'>;
const number = (value: number, digits = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
const degrees = (value: number) => `${number(value * 180 / Math.PI)}°`;

// Only report observed output as activity, never infer an enabled command from it.
export function partInfoRows(part: Part, flight?: PartSnapshot | null): PartInfoRow[] {
  const def = PARTS[part.type];
  const rows: PartInfoRow[] = [{ key: 'id', label: 'ID', value: part.id }, { key: 'name', label: '名前', value: def.name }];
  const add = (key: PartInfoField, label: string, value: string) => rows.push({ key, label, value });
  if (isEngine(part.type)) {
    const engine = flight?.engines.find(e => e.id === part.id);
    add('status', '燃焼', !flight ? '組立中' : !engine ? '未取得' : !engine.available ? '使用不可' : engine.thrust > 0 ? 'ON' : 'OFF');
    add('angle', 'ジンバル P / Y', engine ? `${degrees(Math.atan(engine.gimbalPitch * Math.tan(Math.PI / 30)))} / ${degrees(Math.atan(engine.gimbalYaw * Math.tan(Math.PI / 30)))}` : '—');
    add('output', flight ? '推力' : '定格推力', flight ? engine ? `${number(engine.thrust)} N` : '未取得' : `${number(def.thrust!)} N`);
  } else if (part.type === 'wheel') {
    const wheel = flight?.wheels.find(w => w.id === part.id);
    add('status', '駆動', !flight ? '組立中' : !wheel ? '未取得' : Math.abs(wheel.driveTorque) > 0 ? 'ON' : 'OFF');
    add('angle', '操舵角', wheel ? degrees(wheel.steering) : '—');
    add('output', '駆動トルク', wheel ? `${number(wheel.driveTorque)} N·m` : '—');
  } else if (part.type === 'servo' || part.type === 'linear') {
    const joint = flight?.joints.find(j => j.id === part.id);
    add('angle', '関節位置', joint ? part.type === 'servo' ? degrees(joint.position) : `${number(joint.position, 3)} m` : '—');
    add('status', '動作', flight ? '未取得' : '組立中');
  } else if (part.type === 'rcs' || def.watts) {
    add('status', '動作', flight ? '未取得' : '組立中');
    add('output', part.type === 'rcs' ? '定格推力' : '定格電力', `${number(def.thrust ?? def.watts!)} ${part.type === 'rcs' ? 'N' : 'W'}`);
  } else if (def.power) {
    add('output', '電池容量', `${number(def.power)} Wh`);
  } else {
    add('status', '状態', flight ? '搭載' : '組立中');
  }
  return rows;
}
export function partApiLink(part: Part) {
  return partApiPath(part).normalize('NFKD');
}
function partApiPath(part: Part) {
  if (isEngine(part.type)) return '/docs/udp/commands#エンジンを点火・停止する';
  if (part.type === 'rcs') return '/docs/udp/commands#rcsを有効にする';
  if (part.type === 'decoupler') return '/docs/udp/commands#段を分離する';
  if (part.type === 'wheel') return '/docs/rover#pylon互換udp';
  if (part.type === 'servo' || part.type === 'linear') return '/docs/systems#回転サーボ・直動モーター';
  if (part.type === 'docking') return '/docs/systems#ドッキング';
  if (PARTS[part.type].category === 'sensors') return '/docs/systems#搭載センサー';
  return '/docs/api/schema#craft';
}

export type PartAnchor = { id: string; x: number; y: number };
export type PartProjection = { width: number; height: number; anchors: PartAnchor[] };
export type PartCallout = PartAnchor & { left: number; top: number; width: number; height: number; endX: number; endY: number };
// Fit labels into two non-overlapping columns, preserving the selected part first.
export function layoutPartCallouts(projection: PartProjection, heights: Map<string, number>, selected: string | null, flying: boolean): PartCallout[] {
  const { width, height } = projection, top = flying ? 120 : 195, bottom = height - (flying ? 150 : 100);
  if (width < 180 || bottom - top < 80) return [];
  const labelWidth = Math.min(230, (width - 84) / 2), gap = 8;
  const candidates = projection.anchors.filter(a => heights.has(a.id)).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const columns: PartAnchor[][] = [[], []];
  candidates.forEach((a, index) => columns[Math.abs(a.x - width / 2) < 45 ? index % 2 : a.x < width / 2 ? 0 : 1].push(a));
  const result: PartCallout[] = [];
  columns.forEach((column, side) => {
    let used = 0;
    const kept = [...column].sort((a, b) => Number(b.id === selected) - Number(a.id === selected)).filter(a => {
      const size = Math.min(heights.get(a.id)!, bottom - top);
      if (used + size > bottom - top) return false;
      used += size + gap; return true;
    }).sort((a, b) => a.y - b.y);
    let cursor = top;
    const labels = kept.map(a => {
      const size = Math.min(heights.get(a.id)!, bottom - top);
      const y = Math.max(cursor, Math.min(bottom - size, a.y - size / 2));
      cursor = y + size + gap;
      const left = side ? width - labelWidth - 56 : 12;
      return { ...a, left, top: y, width: labelWidth, height: size, endX: side ? left : left + labelWidth, endY: y + size / 2 };
    });
    let limit = bottom;
    for (const label of labels.reverse()) {
      label.top = Math.min(label.top, limit - label.height); label.endY = label.top + label.height / 2;
      limit = label.top - gap;
      result.push(label);
    }
  });
  return result;
}
