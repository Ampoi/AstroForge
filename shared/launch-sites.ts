/** Earth-fixed metres: east, north, and height above the launch tangent plane. */
export const RUNWAY = { east: 600, north: -450, length: 1800, width: 60, height: -.8, spawnEast: -220 } as const;
export const LAUNCH_SITES = {
  pad: { label: 'ロケット発射場', description: '発射台に垂直に配置します。' },
  runway: { label: '滑走路', description: '全長1,800 m・幅60 m。東向きに水平配置します。滑走には車輪付きの機体を推奨します。' },
  ground: { label: '地表', description: '発射場の東側に配置します。ローバーは水平姿勢になります。' },
} as const;
export type LaunchSiteId = keyof typeof LAUNCH_SITES;
export interface LaunchOptions { site?: LaunchSiteId; recoverVehicleIds?: string[] }
export interface LaunchPreview {
  site: LaunchSiteId;
  occupants: { id: string; name: string; recoverable: boolean }[];
}
export function launchSiteId(value: unknown, rover: boolean): LaunchSiteId {
  if (value === undefined) return rover ? 'ground' : 'pad';
  if (value !== 'pad' && value !== 'runway' && value !== 'ground') throw Error('配置先が不正です');
  return value;
}
