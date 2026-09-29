<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import PartControls from './PartControls.vue';
import { canControlPart } from '../part-controls.ts';
import type { UdpState } from '../../shared/api.ts';
import { PARTS } from '../../shared/craft.ts';
import type { Part } from '../../shared/types.ts';
import type { FlightSnapshot } from '../../server/types.ts';
import { partApiLink, partInfoRows, type PartInfoSettings } from '../part-info.ts';
const props = defineProps<{
  parts: Part[]; flight?: Pick<FlightSnapshot, 'engines' | 'wheels' | 'joints'> | null;
  settings: PartInfoSettings; selected: string | null; flying: boolean; connected: boolean;
  udp?: UdpState; unavailable: boolean; sendCommand: (command: Record<string, unknown>) => Promise<void>;
}>();
const panel = ref<HTMLElement>();
function revealSelection(){if(props.selected)panel.value?.querySelector('.selected')?.scrollIntoView({block:'nearest'});}
onMounted(revealSelection);
watch(()=>props.selected,revealSelection,{flush:'post'});
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
  <div v-if="labels.length" ref="panel" class="sidebar-part-info" aria-label="パーツ情報">
    <section v-for="label in labels" :key="label.id" class="part-callout" :class="{ selected: label.id === selected }"
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
  </div>
</template>
