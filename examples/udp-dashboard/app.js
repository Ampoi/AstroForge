const $=id=>document.getElementById(id);
let state={},tab='engine',queue=Promise.resolve(),sliderTimer,renderedLog=0,polling=false;
const number=id=>{const value=$(id).value.trim();if(!value||!Number.isFinite(Number(value)))throw Error(`${id}: 数値を入力してください`);return Number(value);};
const name=id=>{const value=$(id).value.trim();if(!value)throw Error('送信対象のnameを入力してください');return value;};
function feedback(text,error=false){$('feedback').textContent=text;$('feedback').classList.toggle('error',error);}
function cancelSlider(){clearTimeout(sliderTimer);sliderTimer=undefined;}
async function api(path,input={}){
  const response=await fetch(`/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'通信エラー');
  render(result);return result;
}
function action(operation){
  queue=queue.then(operation).catch(error=>feedback(error.message,true));return queue;
}
function build(){
  const timeoutSeconds=number('timeout');
  if(tab==='engine'){
    const targetThrust=number('thrust-number');
    return {type:'pylon_actuator_command',actuatorType:'engine',name:name('engine-name'),enabled:targetThrust>0,targetThrust,hasGimbalCommand:false,timeoutSeconds};
  }
  if(tab==='separation')return {type:'pylon_actuator_command',actuatorType:'separation',name:name('separation-name'),separate:true};
  if(tab==='flight')return {type:'pylon_flight_control_command',pitch:number('pitch'),yaw:number('yaw'),roll:number('roll'),landingGear:false,timeoutSeconds};
  if(tab==='rcs')return {type:'pylon_actuator_command',actuatorType:'rcs',name:name('rcs-name'),enabled:$('rcs-enabled').checked,thrustLimit:number('rcs-thrust'),timeoutSeconds};
  return {type:'pylon_body_wrench_command',frame:'base_link',force:['fx','fy','fz'].map(number),torque:['tx','ty','tz'].map(number),timeoutSeconds};
}
function envelope(command){return {...command,...state.session,version:1,controllerId:state.controllerId??'udp-dashboard',leaseId:state.leaseId??'セッション待ち',sequence:state.nextSequence??1};}
function preview(){
  try{$('preview').textContent=JSON.stringify(envelope(build()),null,2);}catch(error){$('preview').textContent=error.message;}
}
function sendCommand(){
  // Snapshot the form at the time of the click, not when a previous fetch finishes.
  let command,repeat;
  try{command=build();repeat=tab!=='separation'&&$('repeat').checked;}catch(error){feedback(error.message,true);return;}
  action(async()=>{await api('send',{command,repeat});feedback(`UDP送信完了 · ${command.type}${command.name?' / '+command.name:''}${repeat?' · 20 Hzで継続':''}`);});
}
$('connect-form').addEventListener('submit',event=>{
  event.preventDefault();cancelSlider();
  action(async()=>{await api('connect',{host:$('host').value.trim(),commandPort:number('command-port'),telemetryPort:number('telemetry-port'),renewLease:$('renew-lease').checked});feedback('UDP接続を開きました。制御権の取得や指令の送信は各ボタンで行います。');});
});
$('disconnect').onclick=()=>{cancelSlider();action(async()=>{await api('disconnect');feedback('UDP接続を閉じました。');});};
for(const button of document.querySelectorAll('[data-authority]'))button.onclick=()=>{
  cancelSlider();
  action(async()=>{
    const command={type:'pylon_control_authority_command',action:button.dataset.authority};
    if(['acquire','renew'].includes(command.action))Object.assign(command,{priority:number('priority'),leaseDurationSeconds:2,suppressSas:$('suppress-sas').checked});
    await api('send',{command});feedback(`UDP送信完了 · ${command.action}。結果はRXのreasonを確認してください。`);
  });
};
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{
  cancelSlider();tab=button.dataset.tab;
  for(const item of document.querySelectorAll('[data-tab]'))item.setAttribute('aria-selected',String(item===button));
  for(const pane of document.querySelectorAll('[data-pane]'))pane.hidden=pane.dataset.pane!==tab;
  $('engine-off').hidden=tab!=='engine';$('repeat').disabled=tab==='separation';preview();
};
$('command-form').onsubmit=event=>{event.preventDefault();cancelSlider();sendCommand();};
$('command-form').oninput=preview;
$('thrust').oninput=()=>{
  $('thrust-number').value=$('thrust').value;$('thrust-value').textContent=`${Number($('thrust').value).toLocaleString()} N`;preview();
  if(!$('live-thrust').checked)return;
  if(sliderTimer)return;
  sliderTimer=setTimeout(()=>{sliderTimer=undefined;sendCommand();},80);
};
$('thrust-number').oninput=()=>{
  const value=Number($('thrust-number').value);$('thrust').value=String(value);$('thrust-value').textContent=`${value.toLocaleString()} N`;preview();
};
$('thrust-max').onchange=()=>{
  try{const value=number('thrust-max');if(value<=0||value>1e8)throw Error('上限は1〜100,000,000 N');$('thrust').max=String(value);$('thrust').step=String(Math.max(1,Math.round(value/1000)));}catch(error){feedback(error.message,true);}
};
for(const axis of ['pitch','yaw','roll'])$(axis).oninput=()=>{$(`${axis}-value`).textContent=$(axis).value;preview();};
$('engine-off').onclick=()=>{
  cancelSlider();
  action(async()=>{
    const command={type:'pylon_actuator_command',actuatorType:'engine',name:name('engine-name'),enabled:false,targetThrust:0,hasGimbalCommand:false,timeoutSeconds:number('timeout')};
    await api('stop-repeat');await api('send',{command});
    $('thrust').value='0';$('thrust-number').value='0';$('thrust-value').textContent='0 N';preview();feedback(`UDP送信完了 · ${command.name} の停止指令`);
  });
};
$('stop-repeat').onclick=()=>{cancelSlider();action(async()=>{await api('stop-repeat');feedback('連続送信を停止しました。新たな飛行指令は送信しません。');});};
$('set-session').onclick=()=>action(async()=>{await api('session',{session:JSON.parse($('session-json').value)});feedback('セッションを設定しました。');});
$('copy-session').onclick=()=>{$('session-json').value=JSON.stringify(state.session??{},null,2);};
$('load-preview').onclick=()=>{try{$('raw-json').value=JSON.stringify(envelope(build()),null,2);}catch(error){feedback(error.message,true);}};
$('send-raw').onclick=()=>{
  const text=$('raw-json').value;
  action(async()=>{await api('raw',{text});feedback('入力したJSONをそのままUDP送信しました。');});
};
function render(next){
  state=next;
  $('connection-state').textContent=state.connected?'UDP 接続中':'未接続';$('connection-state').classList.toggle('connected',state.connected);
  $('counts').textContent=`TX ${state.sent??0} / RX ${state.received??0}`;
  $('session-state').textContent=state.session?`vessel ${String(state.session.vesselId).slice(0,12)}…`:'セッション未受信';
  $('authority-state').textContent=state.authority?`state: ${state.authority.state} · ${state.authority.reason} · owner: ${state.authority.controllerId||'—'}`:'制御権の取得では点火しません。';
  $('repeat-state').textContent=state.repeating?`連続送信中: ${state.repeating.type} / ${state.repeating.name??'—'}（50ms間隔）`:'連続送信なし。1回送信した指令は指定期限で失効します。';
  for(const type of ['engine','separation','rcs']){
    const values=(state.manifest??[]).filter(v=>v.actuatorType===type&&typeof v.name==='string').map(v=>v.name);
    const list=$(`${type}-names`);
    if(list.dataset.names!==JSON.stringify(values)){
      list.dataset.names=JSON.stringify(values);list.replaceChildren(...values.map(value=>{const option=document.createElement('option');option.value=value;return option;}));
    }
  }
  const log=state.log??[];
  if(log.at(-1)?.id!==renderedLog){
    renderedLog=log.at(-1)?.id;
    const list=$('wire-log'),open=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.id));
    list.replaceChildren(...[...log].reverse().map(entry=>{
      const details=document.createElement('details');details.dataset.id=String(entry.id);details.className=entry.direction.toLowerCase();details.open=open.has(String(entry.id));
      const summary=document.createElement('summary'),pre=document.createElement('pre'),packet=entry.packet;
      summary.textContent=`${entry.direction} #${entry.id} · ${typeof packet==='string'?packet:[packet.type,packet.name,packet.reason??packet.action].filter(Boolean).join(' · ')}`;
      pre.textContent=JSON.stringify(packet,null,2);details.append(summary,pre);return details;
    }));
  }
  const select=$('telemetry-type'),previous=select.value;
  const keys=(state.telemetry??[]).map(p=>`${p.type}:${p.name??''}`);
  if(select.dataset.keys!==JSON.stringify(keys)){
    select.dataset.keys=JSON.stringify(keys);
    select.replaceChildren(...keys.map(key=>{const option=document.createElement('option');option.value=key;option.textContent=key;return option;}));
    if(keys.includes(previous))select.value=previous;
  }
  renderTelemetry();preview();
  if(state.error)feedback(state.error,true);
}
function renderTelemetry(){const packet=(state.telemetry??[]).find(p=>`${p.type}:${p.name??''}`===$('telemetry-type').value);$('telemetry-json').textContent=JSON.stringify(packet??{},null,2);}
$('telemetry-type').onchange=renderTelemetry;
async function poll(){
  if(polling)return;polling=true;
  try{
    const response=await fetch('/api/state');if(!response.ok)throw Error('デモサーバーへの接続エラー');render(await response.json());
    if(state.connected)await fetch('/api/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  }catch(error){feedback(error.message,true);}finally{polling=false;}
}
setInterval(poll,750);void poll();preview();
