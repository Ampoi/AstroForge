export const loadingStages = {
  models: { label: 'パーツモデルとサムネイル', weight: 10 },
  scene: { label: '格納庫・天体の構築', weight: 10 },
  launch: { label: '発射場の3Dモデルを読み込み', weight: 10 },
  planet: { label: '地形テクスチャの生成', weight: 30 },
  weather: { label: '雲データの読み込み・生成', weight: 15 },
  state: { label: '機体データの受信', weight: 5 },
  effects: { label: '噴射エフェクトの読み込み', weight: 5 },
  gpu: { label: 'GPUへの転送・描画の準備', weight: 15 },
} as const;
export type LoadingStage = keyof typeof loadingStages;
export type LoadingReporter = (stage: LoadingStage, progress: number) => void;
export function createLoadingProgress() {
  const values = new Map<LoadingStage, number>();
  return (stage: LoadingStage, progress: number) => {
    values.set(stage, Math.max(values.get(stage) ?? 0, Math.min(1, Math.max(0, progress))));
    const entries = Object.entries(loadingStages) as [LoadingStage, {label: string; weight: number}][];
    return {
      progress: Math.floor(entries.reduce((sum, [key, {weight}]) => sum + weight * (values.get(key) ?? 0), 0)),
      label: entries.filter(([key]) => values.has(key) && values.get(key)! < 1).map(([, {label}]) => label).join(' / ') || '次の工程を準備しています',
    };
  };
}
// Give the browser a paint between expensive synchronous preparation stages.
export const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
