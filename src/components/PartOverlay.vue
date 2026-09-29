<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import PartControls from './PartControls.vue';
import { canControlPart } from '../part-controls.ts';
import type { UdpState } from '../../shared/api.ts';
import { PARTS } from '../../shared/craft.ts';
import type { Part } from '../../shared/types.ts';
import type { FlightSnapshot } from '../../server/types.ts';
import { partApiLink, partInfoRows, type PartInfoSettings, type PartProjection } from '../part-info.ts';
const props = defineProps<{
  parts: Part[]; flight?: Pick<FlightSnapshot, 'engines' | 'wheels' | 'joints'> | null;
  projection: PartProjection; settings: PartInfoSettings; selected: string | null; flying: boolean; connected: boolean;
  udp?: UdpState; unavailable: boolean; sendCommand: (command: Record<string, unknown>) => Promise<void>;
}>();
const selectedCard = shallowRef<HTMLElement | null>(null);
const cardBounds = ref({left:0,top:0,width:0,height:0});
let cardObserver: ResizeObserver | undefined;
watch(selectedCard, card => {
  cardObserver?.disconnect();
  cardBounds.value={left:0,top:0,width:0,height:0};
  if (!card) return;
  const measure = () => { cardBounds.value={left:card.offsetLeft,top:card.offsetTop,width:card.offsetWidth,height:card.offsetHeight}; };
  measure();
  cardObserver=new ResizeObserver(measure);
  cardObserver.observe(card);
}, {flush:'post'});
onUnmounted(()=>cardObserver?.disconnect());
const leader = computed(() => {
  const anchor=props.projection.anchors.find(point=>point.id===props.selected);
  const card=cardBounds.value;
  if (!anchor || !card.width || !card.height) return null;
  const left=anchor.x < card.left;
  const endX=left ? card.left : card.left+card.width;
  const inset=Math.min(24,card.height/2);
  const endY=Math.max(card.top+inset,Math.min(card.top+card.height-inset,anchor.y));
  const elbowX=endX+(left ? -18 : 18);
  return {...anchor,path:`M ${anchor.x} ${anchor.y} L ${elbowX} ${endY} L ${endX} ${endY}`};
});
const emit = defineEmits<{ select: [id: string | null]; copy: [id: string]; enable: [] }>();
const entries = computed(() => new Map(props.parts.map(part => {
  const rows = partInfoRows(part, props.flight).filter(row => props.settings[row.key]);
  return [part.id, { part, rows }];
})));
const labels = computed(() => [...entries.value.values()]
  .filter(({ part, rows }) => part.id === props.selected || (props.settings.enabled && rows.length))
  .sort((a, b) => Number(b.part.id === props.selected) - Number(a.part.id === props.selected))
  .map(entry => ({ ...entry, id: entry.part.id })));
</script>
<template>
  <div v-if="labels.length" class="sidebar-part-info" :class="{ 'has-summary': labels.some(label => label.id !== selected) }" aria-label="パーツ情報">
    <Teleport to="#part-selection-layer">
      <svg v-if="leader" class="part-leaders" aria-hidden="true">
        <g class="selected"><path :d="leader.path" /><circle :cx="leader.x" :cy="leader.y" r="3" /></g>
      </svg>
    </Teleport>
    <Teleport v-for="label in labels" :key="label.id" to="#part-selection-layer" :disabled="label.id !== selected">
    <section :ref="label.id === selected ? (node) => { selectedCard = node as HTMLElement | null } : undefined" class="part-callout" :class="{ selected: label.id === selected }"
      :data-part-id="label.id">
      <template v-if="label.id === selected">
        <div class="part-callout-heading"><strong>PART INFO</strong><button aria-label="パーツ選択を解除" @click="emit('select', null)">×</button></div>
        <strong class="part-callout-name">{{ PARTS[label.part.type].name }}</strong>
        <div class="part-callout-id"><code>{{ label.id }}</code><button aria-label="パーツIDをコピー" title="パーツIDをコピー" @click="emit('copy', label.id)">コピー</button></div>
        <p v-if="flying && !connected" class="part-stale">通信切断 · 最終受信値</p>
        <dl v-for="row in label.rows.filter(r => r.key !== 'id' && r.key !== 'name')" :key="row.key" class="part-info-row"><dt>{{ row.label }}</dt><dd :title="row.value">{{ row.value }}</dd></dl>
        <PartControls v-if="canControlPart(label.part)" :key="label.id" :part="label.part" :flying="flying" :connected="connected"
          :udp="udp" :unavailable="unavailable" :send="sendCommand" @enable="emit('enable')" />
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
    </Teleport>
  </div>
</template>
