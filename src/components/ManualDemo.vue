<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import type {ApiRoutes, Vehicle} from '../../shared/api.ts';
const props=defineProps<{vehicle:Vehicle;connected:boolean}>();
const emit=defineEmits<{error:[message:string]}>();
const demo=computed(()=>props.vehicle.udp.demo);
const pending=ref(false),output=ref(0),editing=ref(false);
let heartbeat:ReturnType<typeof setInterval>,sliderTimer:ReturnType<typeof setTimeout>|undefined;
let queue=Promise.resolve(),disposed=false,heartbeatPending=false;
type Action=ApiRoutes['/api/manual-demo']['input']['action'];
const vehicleId=props.vehicle.id;
watch(()=>demo.value?.throttle,value=>{if(!editing.value)output.value=value??0;},{immediate:true});
async function request(action:Action,throttle?:number){
  const response=await fetch('/api/manual-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId,action,throttle})});
  if(!response.ok){const result=await response.json();throw Error(result.error||'手動デモに接続できません');}
}
function enqueue(action:Action,throttle?:number){
  queue=queue.then(()=>request(action,throttle)).catch(error=>{if(!disposed)emit('error',error instanceof Error?error.message:String(error));});
  return queue;
}
async function act(action:Action,throttle?:number){
  clearTimeout(sliderTimer);sliderTimer=undefined;editing.value=false;pending.value=true;
  if(action==='stop'||action==='separate'||throttle===0)output.value=0;
  await enqueue(action,throttle);pending.value=false;
}
function slide(event:Event){
  output.value=Number((event.target as HTMLInputElement).value);editing.value=true;
  if(sliderTimer)return;
  sliderTimer=setTimeout(async()=>{
    sliderTimer=undefined;
    await enqueue('throttle',output.value);
    if(!sliderTimer)editing.value=false;
  },80);
}
onMounted(()=>{
  heartbeat=setInterval(async()=>{
    if(!demo.value?.running||!props.connected||heartbeatPending)return;
    heartbeatPending=true;
    try{await request('heartbeat');}catch{}finally{heartbeatPending=false;}
  },750);
});
onUnmounted(()=>{
  disposed=true;clearInterval(heartbeat);clearTimeout(sliderTimer);
  if(demo.value?.running||pending.value)void enqueue('stop');
});
</script>

<template>
  <details class="manual-demo" open>
    <summary><span class="status-dot" :class="{off:!demo?.ready}" /> UDP 手動デモ <span>⌄</span></summary>
    <div class="manual-demo-body">
      <strong class="manual-target" :title="vehicle.craft.name">{{vehicle.craft.name}}</strong>
      <p class="manual-phase" role="status">{{demo?.phase??'出力と切り離しをここから操作できます'}}</p>
      <div v-if="vehicle.udp.enabled" class="manual-ports">RX :{{vehicle.udp.commandPort}} → TX :{{vehicle.udp.telemetryPort}}</div>
      <button v-if="!demo?.running" class="manual-start" :disabled="pending||!connected||!vehicle.controllable||!vehicle.udp.enabled||vehicle.udp.authority?.state!==0" @click="act('start')">手動デモを開始</button>
      <p v-if="!vehicle.udp.enabled" class="manual-note">機体メニューでUDPをONにしてください。</p>
      <p v-else-if="!demo?.running&&vehicle.udp.authority?.state!==0" class="manual-note">外部コントローラの終了、または緊急停止の解除を待っています。</p>
      <label class="manual-output" for="manual-throttle">エンジン出力 <output>{{output}}<small>%</small></output></label>
      <input id="manual-throttle" type="range" min="0" max="100" step="1" :value="output" :disabled="!connected||!demo?.ready||pending||demo.separating" @input="slide" />
      <div class="manual-scale"><span>停止 0%</span><span>最大 100%</span></div>
      <div class="manual-thrust">実推力 <b>{{(vehicle.thrust/1000).toFixed(1)}} kN</b><span> / {{((demo?.maxThrust??0)/1000).toFixed(1)}} kN</span></div>
      <div class="manual-buttons">
        <button :disabled="!connected||!demo?.ready||pending" @click="act('throttle',0)">推力停止</button>
        <button class="manual-separate" :disabled="!connected||!demo?.canSeparate||pending" @click="act('separate')">{{demo?.separating?'分離確認中…':'段を切り離す'}}</button>
      </div>
      <p class="manual-note">{{demo?.nextSeparator?`次の分離: ${demo.nextSeparator}`:'切り離せる段はありません'}}<br />分離後は出力0%。スライダーで上段を点火します。</p>
      <button v-if="demo?.running" class="manual-end" :disabled="pending" @click="act('stop')">デモ終了 · 推力OFF</button>
      <p class="manual-note">姿勢は自動保持。追尾する機体の変更・画面を閉じると停止します。</p>
    </div>
  </details>
</template>
