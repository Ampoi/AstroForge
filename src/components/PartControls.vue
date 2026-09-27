<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Part } from '../../shared/types.ts';
import type { UdpState } from '../../shared/api.ts';
import { isJoint } from '../../shared/articulation.ts';
import { controlFields, partCommand, type MotorMode } from '../part-controls.ts';
const props = defineProps<{
  part: Part; flying: boolean; connected: boolean; udp?: UdpState; unavailable: boolean;
  send: (command: Record<string, unknown>) => Promise<void>;
}>();
const emit = defineEmits<{ enable: [] }>();
const mode = ref<MotorMode>('position'), values = ref<Record<string,number>>({}), duration = ref(10);
const busy = ref(false), message = ref(''), failed = ref(false);
const fields = computed(() => controlFields(props.part, mode.value));
const disabled = computed(() => !props.flying || !props.connected || !props.udp?.enabled || props.unavailable || busy.value);
watch([() => props.part.id, mode], () => {
  values.value = Object.fromEntries(fields.value.map(f => [f.key, f.initial]));
  message.value = '';
}, { immediate:true });
watch(() => props.udp?.session?.runtimeEpoch, () => { message.value = ''; });
async function submit(operation: () => Record<string,unknown>) {
  if (disabled.value) return;
  busy.value = true; message.value = ''; failed.value = false;
  try {
    const command = operation();
    await props.send(command);
    message.value = command.action === 'release' ? 'この機体のGUI指令を停止し、制御権を解放しました' : command.enabled === false ? '停止指令を受け付けました' : command.timeoutSeconds ? `指令を受け付けました（${command.timeoutSeconds}秒間）` : '指令を受け付けました';
  } catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}
const apply = (enabled: boolean) => submit(() => partCommand(props.part, mode.value, values.value, enabled, enabled ? duration.value : .05));
const dock = (action: number) => submit(() => ({type:'pylon_docking_port_command',name:props.part.id,action}));
const separate = () => submit(() => ({type:'pylon_actuator_command',actuatorType:'separation',name:props.part.id,separate:true,operationId:crypto.randomUUID()}));
</script>
<template>
  <div class="part-controls" @pointerdown.stop @click.stop @wheel.stop>
    <strong>パーツ操作</strong>
    <p v-if="!flying" class="part-control-help">機体を配置後、フライト画面で操作できます。</p>
    <p v-else-if="!connected" class="part-control-help">接続待ち · 操作できません</p>
    <p v-else-if="unavailable" class="part-control-help">この機体は現在操作できません。</p>
    <button v-else-if="!udp?.enabled" type="button" @click="emit('enable')">UDPを有効にして操作</button>
    <form @submit.prevent="apply(true)">
      <fieldset :disabled="disabled">
        <label v-if="isJoint(part.type)" class="part-control-field">制御モード
          <select v-model="mode"><option value="position">位置</option><option value="velocity">速度</option><option value="effort">{{ part.type === 'servo' ? 'トルク' : '推力' }}</option></select>
        </label>
        <label v-for="field in fields" :key="field.key" class="part-control-field">
          <span>{{ field.label }}</span>
          <input v-model.number="values[field.key]" type="number" :min="field.min" :max="field.max" step="any" required />
          <input v-model.number="values[field.key]" type="range" :min="field.min" :max="field.max" :step="field.step" :aria-label="`${field.label} スライダー`" />
        </label>
        <template v-if="fields.length">
          <label class="part-control-field">指令時間 (実秒)<input v-model.number="duration" type="number" min="0.05" max="10" step="any" required /></label>
          <div class="part-control-actions"><button type="submit">適用・作動</button><button type="button" @click="apply(false)">停止</button></div>
          <p class="part-control-help">適用した値だけを送信します。最大10秒で失効します。続けるには再度適用してください。</p>
        </template>
        <template v-else-if="part.type === 'decoupler'">
          <p class="part-control-help">このデカプラーで段を分離します。</p>
          <button type="button" @click="separate">この段を分離</button>
        </template>
        <div v-else-if="part.type === 'docking'" class="part-control-actions">
          <button type="button" @click="dock(1)">カメラ選択</button><button type="button" @click="dock(2)">選択解除</button><button type="button" @click="dock(3)">ドッキング解除</button>
        </div>
        <button type="button" class="part-control-release" @click="submit(() => ({type:'pylon_control_authority_command',action:'release'}))">GUIの制御権を解放</button>
      </fieldset>
    </form>
    <p v-if="message" class="part-control-result" :class="{ failed }" role="status">{{ message }}</p>
  </div>
</template>
