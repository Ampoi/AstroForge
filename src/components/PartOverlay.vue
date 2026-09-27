<script setup lang="ts">
import { computed } from 'vue';
import { PARTS } from '../../shared/craft.ts';
import type { Part } from '../../shared/types.ts';
import type { FlightSnapshot } from '../../server/types.ts';
import { layoutPartCallouts, partApiLink, partInfoRows, type PartInfoSettings, type PartProjection } from '../part-info.ts';
const props = defineProps<{
  parts: Part[]; flight?: Pick<FlightSnapshot, 'engines' | 'wheels' | 'joints'> | null;
  projection: PartProjection; settings: PartInfoSettings; selected: string | null; flying: boolean; connected: boolean;
}>();
const emit = defineEmits<{ select: [id: string | null]; copy: [id: string] }>();
const entries = computed(() => new Map(props.parts.map(part => {
  const rows = partInfoRows(part, props.flight).filter(row => props.settings[row.key]);
  return [part.id, { part, rows }];
})));
const labels = computed(() => {
  const heights = new Map<string, number>();
  for (const [id, { rows }] of entries.value) {
    if (id === props.selected) heights.set(id, 192 + rows.filter(r => r.key !== 'id' && r.key !== 'name').length * 20);
    else if (props.settings.enabled && rows.length) heights.set(id, 16 + rows.length * 20);
  }
  return layoutPartCallouts(props.projection, heights, props.selected, props.flying).map(label => ({ ...label, ...entries.value.get(label.id)! }));
});
const hiddenCount = computed(() => props.settings.enabled ? Math.max(0, props.projection.anchors.filter(a => entries.value.get(a.id)?.rows.length).length - labels.value.length) : 0);
</script>
<template>
  <div class="part-overlay" aria-label="パーツ情報オーバーレイ">
    <svg class="part-leaders" aria-hidden="true">
      <g v-for="label in labels" :key="label.id" :class="{ selected: label.id === selected }">
        <path :d="`M ${label.x} ${label.y} L ${(label.x + label.endX) / 2} ${label.y} L ${label.endX} ${label.endY}`" />
        <circle :cx="label.x" :cy="label.y" r="3" />
      </g>
    </svg>
    <section v-for="label in labels" :key="label.id" class="part-callout" :class="{ selected: label.id === selected }"
      :data-part-id="label.id" :style="{ left: `${label.left}px`, top: `${label.top}px`, width: `${label.width}px`, height: `${label.height}px` }">
      <template v-if="label.id === selected">
        <div class="part-callout-heading"><strong>PART INFO</strong><button aria-label="パーツ選択を解除" @click="emit('select', null)">×</button></div>
        <strong class="part-callout-name">{{ PARTS[label.part.type].name }}</strong>
        <div class="part-callout-id"><code>{{ label.id }}</code><button aria-label="パーツIDをコピー" title="パーツIDをコピー" @click="emit('copy', label.id)">コピー</button></div>
        <p v-if="flying && !connected" class="part-stale">通信切断 · 最終受信値</p>
        <dl v-for="row in label.rows.filter(r => r.key !== 'id' && r.key !== 'name')" :key="row.key" class="part-info-row"><dt>{{ row.label }}</dt><dd :title="row.value">{{ row.value }}</dd></dl>
        <nav class="part-api-links" aria-label="選択パーツのAPI資料">
          <a :href="partApiLink(label.part)" target="_blank" rel="noopener">このパーツのAPI利用 ↗</a>
          <a href="/docs/udp/telemetry#アクチュエータ" target="_blank" rel="noopener">IDとmanifestの対応 ↗</a>
        </nav>
        <p class="part-callout-note">動作ON/OFFは実出力の有無。未取得の状態は「未取得」で表示。</p>
      </template>
      <button v-else class="part-callout-select" :aria-label="`${label.id}の詳細を表示`" @click="emit('select', label.id)">
        <dl v-for="row in label.rows" :key="row.key" class="part-info-row"><dt>{{ row.label }}</dt><dd :title="row.value">{{ row.value }}</dd></dl>
      </button>
    </section>
    <p v-if="hiddenCount" class="part-overlay-overflow">ほか {{ hiddenCount }} パーツ · 拡大／選択で詳細</p>
  </div>
</template>
