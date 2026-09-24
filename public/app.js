import {PARTS,starterCraft,twoStageCraft,validateCraft,craftStats,launchIssues} from '/shared/craft.js';
import {RocketScene} from './scene.js';
import {emptyAssembly,toAssembly,restoreAssembly,connectedIds,movingIds,assembledCraft,assemblyStats,placeAssembly,removeAssembly,resolveAssemblyPlacement} from '/shared/assembly.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const uid=prefix=>`${prefix}_${crypto.randomUUID().slice(0,8)}`;
let craft=twoStageCraft(),selected=null,symmetry=4,mirror=false,mode='flight',connected=false,initial=true,dirty=false,category='all',history=[],latest=null;
let toastTimer,focusId=null,libraryId=null,vehicleKey='';
const pendingUdp=new Set();
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
const shapes={
  pod:'<path d="m17 5-9 30h28L27 5Z" fill="#cedbd9"/><path d="M8 35h28v5H8Z" fill="#667f8a"/><path d="M17 18h10l2 8H15Z" fill="#233e51"/><path d="M19 7h6" stroke="#f4f5ed" stroke-width="2"/>',
  tank:'<rect x="11" y="4" width="24" height="43" rx="3" fill="#cdd6d1"/><path d="M11 7h24M11 44h24" stroke="#8fa39f" stroke-width="3"/><path d="M11 37h24" stroke="#e6956b" stroke-width="4"/><path d="M15 18h16M15 21h12" stroke="#758d93"/>',
  engine:'<path d="M9 9h29v6H9Z" fill="#a0b4b9"/><path d="M18 15h10l-2 11 10 19H10l10-19Z" fill="#788892"/><path d="M10 44h26" stroke="#b9beb0" stroke-width="2"/><path d="M14 17v10M32 17v10" stroke="#d5b38c" stroke-width="3"/>',
  decoupler:'<ellipse cx="23" cy="18" rx="17" ry="6" fill="#86999d"/><path d="M6 18v15q17 12 34 0V18q-17 12-34 0Z" fill="#ddb15b"/><path d="m10 23 5 15m6-12 5 15m6-17 5 13" stroke="#31464f" stroke-width="4"/><ellipse cx="23" cy="18" rx="11" ry="3" fill="#1c2a31"/>',
  fin:'<path d="M9 9 35 36v5H9Z" fill="#bdcdd0"/><path d="M9 9v32" stroke="#769097" stroke-width="4"/><path d="M31 36h4v5h-4Z" fill="#e59b78"/>',
  rcs:'<path d="M14 17h18v19H14Z" fill="#cfdbd8"/><path d="M18 10h10v8H18ZM18 35h10v8H18ZM31 22h9v10h-9ZM5 22h10v10H5Z" fill="#72868e"/><path d="M20 23h7v7h-7Z" fill="#e3ae7c"/>',
  battery:'<ellipse cx="23" cy="17" rx="15" ry="5" fill="#97afb3"/><path d="M8 17v18q15 10 30 0V17q-15 10-30 0Z" fill="#536a76"/><path d="m25 21-7 8h5l-2 8 8-10h-6Z" fill="#e4b680"/>',
  solar:'<path d="M4 21h8v5H4Z" fill="#a0acb2"/><path d="M10 10h31v31H10Z" fill="#97aeb5"/><path d="M12 12h27v27H12Z" fill="#2f6b8b"/><path d="M21 12v27M30 12v27M12 21h27M12 30h27" stroke="#80a9b4" stroke-width="1"/>'
};
function icon(type){return `<svg viewBox="0 0 46 52" aria-hidden="true">${shapes[type]}</svg>`;}
function renderPalette(){
  $('#parts-list').innerHTML=Object.entries(PARTS).filter(([,d])=>category==='all'||d.category===category).map(([type,d])=>
    `<button class="part-card" data-part="${type}" draggable="true" title="${escape(d.description)}"><span class="part-art">${icon(type)}</span><span><strong>${d.name}</strong><small>${d.label}</small><span class="part-meta">${num(d.mass)} kg${d.thrust?` · ${num(d.thrust/1000, d.thrust<1000?2:0)} kN`:d.fuel?` · ${num(d.fuel)} kg fuel`:d.power?` · ${d.power} Wh`:d.watts?` · ${d.watts} W`:''}</span></span><span class="part-add">+</span></button>`).join('');
  $$('#parts-list [data-part]').forEach(button=>{
    button.onclick=()=>beginPart(button.dataset.part);
    button.ondragstart=e=>{if(!canPlace(button.dataset.part)){e.preventDefault();return;}e.dataTransfer.setData('text/part',button.dataset.part);e.dataTransfer.effectAllowed='copy';scene.setPlacement(button.dataset.part,{count:symmetry,mirror});};
    button.ondragend=()=>{scene.setPlacement(null);$('#placement-hint').hidden=true;};
  });
}
function stash(){history.push(structuredClone(craft));if(history.length>50)history.shift();}
function changed(){
  dirty=true;$('#save-state').textContent='未保存';try{localStorage.setItem('astroforge-draft',JSON.stringify(craft));}catch{}
  scene.setCraft(craft);scene.select(selected);renderEditor();
}
function selectPart(id){if(mode!=='editor')return;selected=id;scene.select(id);renderStack();renderInspector();}
function canPlace(type){
  if(mode!=='editor')return false;
  if(!craft.rootId&&PARTS[type].radial){toast('最初にポッドや燃料タンクなどの胴体パーツを配置してください');return false;}
  if(craft.parts.length>=80){toast('パーツは80個まで配置できます');return false;}
  return true;
}
function beginPart(type){
  if(!canPlace(type))return;
  scene.cancelPlacement();scene.setPlacement(type,{count:symmetry,mirror});
}
function placePart(type,placement,movingId){
  if(!placement||(!movingId&&!canPlace(type)))return;
  try{
    const next=placeAssembly(craft,type,placement,{movingId,count:symmetry,mirror,idFactory:uid});
    stash();selected=movingId||next.parts.find(p=>!craft.parts.some(c=>c.id===p.id))?.id;craft=next;
    scene.cancelPlacement();changed();
  }catch(e){toast(e.message);}
}
function groupParts(p){return p?.group?craft.parts.filter(c=>c.group===p.group):p?[p]:[];}
function removeSelected(){
  const p=craft.parts.find(p=>p.id===selected);if(!p)return;
  if(p.id===craft.rootId){toast('ルートは機体の基準です。新しく組む場合は「空にする」を使ってください');return;}
  stash();scene.cancelPlacement();craft=removeAssembly(craft,p.id);selected=null;changed();
}
function renderStack(){
  const rows=[],seen=new Set(),connected=connectedIds(craft),selectedGroup=craft.parts.find(p=>p.id===selected)?.group;
  function visit(p,depth){
    if(seen.has(p.id))return;seen.add(p.id);
    if(p.group)for(const c of groupParts(p))seen.add(c.id);
    rows.push({p,depth,count:groupParts(p).length});
    for(const c of craft.parts.filter(c=>c.parent===p.id))visit(c,depth+1);
  }
  const root=craft.parts.find(p=>p.id===craft.rootId);if(root)visit(root,0);
  for(const p of craft.parts.filter(p=>!p.parent&&p.id!==craft.rootId))visit(p,0);
  $('#stack-list').innerHTML=rows.length?rows.map(({p,depth,count})=>`<button class="stack-row ${depth?'radial':''} ${connected.has(p.id)?'':'detached'} ${p.id===selected||p.group&&p.group===selectedGroup?'selected':''}" data-select="${p.id}" title="${p.id===craft.rootId?'ルート':connected.has(p.id)?'接続済み':'未接続 · 機体には含まれません'}"><span class="stack-symbol">${p.id===craft.rootId?'◆':!p.parent?'◇':'↳'}</span>${PARTS[p.type].name}<span>${count>1?`×${count}`:connected.has(p.id)?num(PARTS[p.type].mass)+' kg':'未接続'}</span></button>`).join(''):'<p class="empty-assembly">パーツを選んで作業場に配置すると、最初のルートになります。</p>';
  $$('#stack-list [data-select]').forEach(b=>b.onclick=()=>selectPart(b.dataset.select));
}
function renderInspector(){
  const p=craft.parts.find(p=>p.id===selected),el=$('#selection-inspector');
  if(!p){el.innerHTML='<span class="eyebrow">PART INSPECTOR</span><p>機体のパーツを選択すると<br>取り付け位置を調整できます。</p>';return;}
  const def=PARTS[p.type],group=groupParts(p),connected=connectedIds(craft).has(p.id),children=movingIds(craft,p.id).size-1;
  el.innerHTML=`<span class="eyebrow">${escape(def.label)}</span><div class="selected-part-name">${def.name}${group.length>1?` ×${group.length}`:''}</div><p class="part-description">${p.id===craft.rootId?'◆ ルートパーツ':connected?'接続済み':'◇ 未接続 · 機体の集計・保存・発射から除外'}${children?` · 子パーツ ${children} 個と一緒に移動`:''}</p>${def.radial&&p.parent?`<label class="position-control">上下位置<input type="range" id="part-offset" min="-0.5" max="0.5" step="0.001" value="${p.offset}" aria-label="取り付け高さ"></label><label class="position-control">回転角度<input type="range" id="part-angle" min="0" max="360" step="1" value="${Math.round((p.angle+Math.PI*2)%(Math.PI*2)*180/Math.PI)}" aria-label="側面パーツの回転角度"></label>`:''}<div class="selection-actions"><button id="part-duplicate">同じパーツを追加</button>${p.id!==craft.rootId?'<button id="part-delete" class="delete">子パーツごと削除</button>':''}</div>`;
  $('#part-delete')?.addEventListener('click',removeSelected);
  $('#part-duplicate')?.addEventListener('click',()=>beginPart(p.type));
  function adjust(offset,angle){
    const parent=craft.parts.find(c=>c.id===p.parent),radius=1;
    const hit={id:parent.id,point:[parent.position[0]+offset*PARTS[parent.type].height,parent.position[1]+Math.cos(angle)*radius,parent.position[2]+Math.sin(angle)*radius],normal:[0,Math.cos(angle),Math.sin(angle)]};
    const placement=resolveAssemblyPlacement(craft,p.type,hit,{movingId:p.id,snap:false});
    stash();craft=placeAssembly(craft,p.type,placement,{movingId:p.id});changed();
  }
  $('#part-offset')?.addEventListener('change',e=>adjust(Number(e.target.value),p.angle));
  $('#part-angle')?.addEventListener('change',e=>adjust(p.offset,Number(e.target.value)*Math.PI/180));
}
function renderSummary(draft=craft){
  const active=assembledCraft(draft),s=assemblyStats(draft),loose=draft.parts.length-active.parts.length;
  $('#part-count').textContent=String(active.parts.length).padStart(2,'0');
  $('#part-count').title=`接続 ${active.parts.length} 個 / 未接続 ${loose} 個`;
  $('#craft-mass').innerHTML=`${num(s.mass)}<small>kg</small>`;$('#craft-twr').textContent=num(s.twr,2);$('#craft-twr').style.color=s.twr>1?'var(--cyan)':'var(--accent)';
  $('#craft-dv').textContent=`${num(s.deltaV)} m/s`;$('#craft-height').textContent=`${num(s.height,2)} m`;
  if(mode==='editor')$('#craft-subtitle').textContent=draft.rootId?`接続 ${active.parts.length} 個 · 未接続 ${loose} 個 · 子パーツごとドラッグ`:'最初のパーツを配置してルートを作成';
  const issues=active.parts.length?launchIssues(active):['最初のルートパーツを配置してください'],v=$('#validation');v.classList.toggle('warning',!!issues.length||s.stability<0);
  v.textContent=issues.length?'△ '+issues[0]:s.stability<0?'△ 空力中心が重心より前方です。翼を下方に追加すると安定します。':`✓ 発射準備OK · 静安定余裕 ${num(s.stability,1)} 口径（概算）`;
  $('#launch-button').disabled=!connected||issues.length>0;$('#save-button').disabled=!connected||!active.parts.length;
}
function renderEditor(){
  $('#craft-name').value=craft.name;renderSummary();$('#undo-button').disabled=!history.length;
  renderStack();renderInspector();
}
async function api(path,data){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw Error(result.error);return result;}
function currentUdp(){return latest?.vehicles.find(v=>v.id===(mode==='flight'?focusId:latest.activeVehicleId))?.udp;}
function demoCommand(c=currentUdp()){
  if(!c?.enabled)return null;
  const args=[];if(c.commandPort!==49011)args.push(`--command-port ${c.commandPort}`);if(c.telemetryPort!==49010)args.push(`--telemetry-port ${c.telemetryPort}`);
  return 'npm run demo'+(args.length?' -- '+args.join(' '):'');
}
function commitName(){const name=$('#craft-name').value.trim();if(!name){$('#craft-name').value=craft.name;return;}if(name!==craft.name){stash();craft.name=name;changed();}}
async function launch(){try{commitName();const active=validateCraft(assembledCraft(craft));$('#launch-button').disabled=true;scene.cancelPlacement();const result=await api('/api/launch',active);focusId=result.activeVehicleId;applyState(result);window.scrollTo({top:0,behavior:'smooth'});toast('発射台に配置しました。機体一覧でUDPをONにすると接続できます');}catch(e){toast(e.message);renderEditor();}}
async function openEditor(id=null){
  try{const result=await api('/api/editor',id?{libraryId:id}:{});libraryId=id&&!['starter','two-stage'].includes(id)?id:null;history=[];dirty=false;scene.cancelPlacement();applyState(result);craft=toAssembly(result.draft);selected=null;try{localStorage.setItem('astroforge-draft',JSON.stringify(craft));}catch{}scene.setCraft(craft);renderEditor();scene.fit();$('#craft-dialog').close();}catch(e){toast(e.message);}
}
async function backToFlight(){try{applyState(await api('/api/flight',{}));}catch(e){toast(e.message);}}
function setMode(next){
  mode=next;const flying=next==='flight';document.body.classList.toggle('flight-mode',flying);
  for(const id of ['parts-panel','editor-inspector','build-toolbar','back-to-flight'])$('#'+id).hidden=flying;
  for(const id of ['flight-actions','flight-hud','flight-toolbar'])$('#'+id).hidden=!flying;
  $('#view-follow').classList.add('active');$('#view-earth').classList.remove('active');$('#orbit-legend').hidden=true;
  $('#craft-name').disabled=flying;$('#markers-button').hidden=flying;
  $('#view-site').hidden=!flying;$('#grid-button').hidden=flying;
  selected=null;scene.setMode(mode);scene.resize();
  $('#view-instructions').innerHTML=flying?'カメラ操作のみ <b>·</b> 飛行制御はUDPから':'パーツをドラッグして子ごと移動 <b>·</b> 空白をドラッグで回転';
}
const phase={pad:'発射待機',flying:'飛行中',landed:'着地',crashed:'停止',destroyed:'破損・消失'};
function focusVehicle(id){focusId=id;vehicleKey='';if(latest)renderFlight();scene.fit();}
function renderFlight(){
  const vehicles=latest.vehicles||[],visible=vehicles.filter(v=>v.status!=='destroyed');
  let f=visible.find(v=>v.id===focusId);
  if(!f){f=visible.find(v=>v.id.startsWith(`${focusId}/`))||visible.find(v=>v.id===latest.activeVehicleId)||visible[0]||vehicles.find(v=>v.id===latest.activeVehicleId);focusId=f?.id;}
  if(!f)return;
  const signature=JSON.stringify(f.craft);
  if(scene.craftSignature!==signature){scene.setCraft(f.craft);scene.craftSignature=signature;}
  $('#focus-name').textContent=f.craft.name;$('#focus-name').title=f.craft.name;
  $('#hud-altitude').innerHTML=f.status==='destroyed'?'—':f.altitude>=10000?`${num(f.altitude/1000,2)}<span>km</span>`:`${num(f.altitude)}<span>m</span>`;
  const key=JSON.stringify(vehicles.map(v=>[v.id,v.status,v.craft.name,v.udp.enabled,v.udp.commandPort,v.udp.telemetryPort,pendingUdp.has(v.id)]))+focusId;
  if(key!==vehicleKey){vehicleKey=key;
    $('#vehicle-list').innerHTML=vehicles.map(v=>`<div class="vehicle-row ${v.id===focusId?'focused':''}"><div><strong title="${escape(v.craft.name)}">${escape(v.craft.name)}</strong><small>${phase[v.status]}${v.passive?' · 分離物':''}</small></div><button data-focus="${escape(v.id)}" ${v.status==='destroyed'?'disabled':''} aria-pressed="${v.id===focusId}">${v.id===focusId?'追尾中':'追尾'}</button>${!v.passive?`<button class="udp-toggle" role="switch" aria-checked="${v.udp.enabled}" aria-label="${escape(v.craft.name)} のUDP制御" data-control="${escape(v.id)}" ${pendingUdp.has(v.id)||!v.controllable&&!v.udp.enabled?'disabled':''}><span aria-hidden="true"></span>UDP ${v.udp.enabled?'ON':'OFF'}</button><div class="vehicle-udp ${v.udp.enabled?'enabled':''}">${v.udp.enabled?`<code>受信 :${v.udp.commandPort} · 送信 :${v.udp.telemetryPort}</code><button data-copy-udp="${escape(v.id)}" title="この機体のデモ起動コマンドをコピー">接続コマンド ↗</button>`:`<small>${v.controllable?'ONにすると専用ポートを割り当てます':'UDP制御できない機体です'}</small>`}</div>`:''}</div>`).join('');
    $$('[data-focus]').forEach(b=>b.onclick=()=>focusVehicle(b.dataset.focus));
    $$('[data-control]').forEach(b=>b.onclick=async()=>{
      const id=b.dataset.control,enabled=!latest.vehicles.find(v=>v.id===id).udp.enabled;
      if(pendingUdp.has(id))return;pendingUdp.add(id);renderFlight();
      try{const result=await api('/api/control',{vehicleId:id,enabled});applyState(result);const c=result.vehicles.find(v=>v.id===id).udp;toast(enabled?`UDP ON · コマンド :${c.commandPort} / テレメトリ :${c.telemetryPort}`:'UDP OFF · この機体の指令と制御権を解除しました');}
      catch(e){toast(e.message);}finally{pendingUdp.delete(id);if(mode==='flight')renderFlight();}
    });
    $$('[data-copy-udp]').forEach(b=>b.onclick=()=>copyDemo(latest.vehicles.find(v=>v.id===b.dataset.copyUdp)?.udp));
  }
  $('#time-scale').value=String(latest.timeScale);
  scene.updateFlight({...f,debris:vehicles.filter(v=>v.id!==f.id&&v.status!=='destroyed')},f.trail||[]);
  renderUdp();
}
function renderUdp(){
  const c=currentUdp(),a=c?.authority;
  $('#rx-port').textContent=c?.enabled?`:${c.commandPort}`:'—';$('#tx-port').textContent=c?.enabled?`:${c.telemetryPort}`:'—';
  $('#packet-count').textContent=`${num(c?.received??0)} RX · ${num(c?.sent??0)} TX`;
  $('#udp-state').textContent=!c?.enabled?'OFF':a?.state===2?'緊急停止':a?.state===1?'制御中':'待機中';$('#udp-dot').classList.toggle('off',!c?.enabled||a?.state===2);
  for(const code of $$('[data-demo-command]'))code.textContent=demoCommand()||'機体一覧でUDPをONにしてください';
  $('#copy-demo').disabled=!c?.enabled;
  $('#help-rx').textContent=c?.enabled?`RX :${c.commandPort}`:'RX —';$('#help-tx').textContent=c?.enabled?`TX :${c.telemetryPort}`:'TX —';
}
async function copyDemo(c=currentUdp()){
  const command=demoCommand(c);if(!command)return;
  try{await navigator.clipboard.writeText(command);toast('この機体のデモ起動コマンドをコピーしました');}catch{toast(command);}
}
function renderLibrary(){
  $('#craft-library').innerHTML=(latest?.library||[]).map(entry=>{const stats=craftStats(entry.craft);return `<div class="library-entry"><div><span class="eyebrow">${['starter','two-stage'].includes(entry.id)?'PRESET':'SAVED VEHICLE'}</span><strong>${escape(entry.craft.name)}</strong><p>${entry.craft.parts.length} パーツ · ${stats.stageCount} 段 · ${num(stats.mass)} kg</p></div><div><button data-edit-craft="${escape(entry.id)}">VABで編集</button><button class="library-launch" data-launch-craft="${escape(entry.id)}">発射台へ ↗</button></div></div>`;}).join('');
  $$('[data-edit-craft]').forEach(b=>b.onclick=()=>openEditor(b.dataset.editCraft));
  $$('[data-launch-craft]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const entry=latest.library.find(v=>v.id===b.dataset.launchCraft);const result=await api('/api/launch',entry.craft);focusId=result.activeVehicleId;applyState(result);scene.fit();$('#craft-dialog').close();toast('発射台に配置しました。機体一覧でUDPをONにすると接続できます');}catch(e){toast(e.message);}finally{b.disabled=false;}});
}
function applyState(s){
  latest=s;
  if(initial){
    craft=s.craft;
    if(s.mode==='editor'){craft=toAssembly(s.draft);}
    if(s.mode==='editor')try{const draft=localStorage.getItem('astroforge-draft');if(draft){craft=restoreAssembly(JSON.parse(draft));dirty=JSON.stringify(craft)!==JSON.stringify(s.craft);}}catch{}
    $('#save-state').textContent=dirty?'未保存':'保存済み';
    scene.setCraft(craft);scene.fit();initial=false;setMode(s.mode);renderEditor();
  }else if(mode!==s.mode){scene.cancelPlacement();craft=s.mode==='editor'?toAssembly(s.draft):s.craft;scene.setCraft(craft);scene.craftSignature=null;setMode(s.mode);renderEditor();}
  $('#performance-label').textContent=`PHYSICS 120 Hz · ${num(s.connection.physicsMs,2)} ms`;
  if(mode==='flight')renderFlight();else renderUdp();
}
function setConnection(on){connected=on;$('#connection-dot').classList.toggle('off',!on);$('#connection-label').textContent=on?'ローカル接続':'再接続中';if(mode==='editor')renderEditor();}

let scene;
try{scene=new RocketScene($('#scene'),selectPart,placePart,(placement,draft)=>{if(mode==='editor')renderSummary(draft||craft);const hint=$('#placement-hint');hint.hidden=placement===false;hint.classList.toggle('snapped',!!placement?.snapped);hint.textContent=placement?.kind==='root'?'◆ ルートを配置 · 子パーツも一緒に移動':placement?.kind==='free'?'未接続 · 半透明のパーツは機体に含まれません · Escで取消':placement?.snapped?'⌖ 接続点にスナップ · 離して接続':placement?.kind==='surface'?'側面に取り付け · 離して確定':placement===null?'この位置には配置できません':'パーツを配置 · 接続点へ近づけてスナップ · Escで取消';});}catch(e){$('#scene').innerHTML='<p style="padding:220px 30px;color:#efb192">3D表示にはWebGLが必要です。ブラウザのハードウェアアクセラレーションを有効にして再読み込みしてください。</p>';throw e;}
renderPalette();
const stream=new EventSource('/api/events');stream.onopen=()=>setConnection(true);stream.onerror=()=>setConnection(false);stream.onmessage=e=>{try{applyState(JSON.parse(e.data));}catch(error){console.error(error);}};
$$('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;$$('[data-category]').forEach(c=>c.classList.toggle('active',c===b));renderPalette();});
$$('[data-symmetry]').forEach(b=>b.onclick=()=>{symmetry=Number(b.dataset.symmetry);mirror=false;$('#mirror-button').classList.remove('active');$$('[data-symmetry]').forEach(c=>c.classList.toggle('active',c===b));scene.setPlacement(scene.placing,{count:symmetry,mirror});});
$('#snap-button').onclick=()=>{scene.placementOptions.snap=!scene.placementOptions.snap;$('#snap-button').textContent=scene.placementOptions.snap?'⌖ スナップ ON':'⌖ スナップ OFF';$('#snap-button').setAttribute('aria-pressed',String(scene.placementOptions.snap));scene.setPlacement(scene.placing);};
$('#mirror-button').onclick=()=>{mirror=!mirror;$('#mirror-button').classList.toggle('active',mirror);$$('[data-symmetry]').forEach(c=>c.classList.toggle('active',!mirror&&Number(c.dataset.symmetry)===symmetry));scene.setPlacement(scene.placing,{count:symmetry,mirror});};
$('#craft-name').onchange=commitName;
$('#save-button').onclick=async()=>{try{commitName();const active=validateCraft(assembledCraft(craft));scene.cancelPlacement();const saved=await api('/api/craft',{...active,libraryId});libraryId=saved.libraryId;latest.library=saved.library;dirty=false;$('#save-state').textContent='保存済み';toast('機体をローカルに保存しました');}catch(e){toast(e.message);}};
function undo(){if(!history.length||mode!=='editor')return;scene.cancelPlacement();craft=history.pop();selected=null;changed();}
$('#undo-button').onclick=undo;$('#reset-button').onclick=()=>{stash();libraryId=null;scene.cancelPlacement();craft=toAssembly(starterCraft());selected=null;changed();scene.fit();toast('初期機体を読み込みました。「戻す」で取り消せます');};
$('#two-stage-button').onclick=()=>{stash();libraryId=null;scene.cancelPlacement();craft=toAssembly(twoStageCraft());selected='separator_1';changed();scene.fit();toast('2段機体を読み込みました。UDPデモで自動分離を試せます');};
$('#empty-button').onclick=()=>{stash();scene.cancelPlacement();libraryId=null;craft=emptyAssembly();selected=null;changed();scene.fit();};
$('#launch-button').onclick=launch;$('#new-craft-button').onclick=()=>openEditor();$('#back-to-flight').onclick=backToFlight;
$('#choose-craft-button').onclick=()=>{renderLibrary();$('#vehicle-menu').open=false;$('#craft-dialog').showModal();};$('#close-craft-dialog').onclick=()=>$('#craft-dialog').close();
$('#time-scale').onchange=async e=>{try{applyState(await api('/api/time-scale',{scale:Number(e.target.value)}));}catch(error){toast(error.message);e.target.value=String(latest.timeScale);}};
function updateClock(){const now=new Date();$('#gmt-clock').textContent=now.toISOString().slice(11,19);$('#gmt-clock').dateTime=now.toISOString();}
updateClock();setInterval(updateClock,1000);
document.addEventListener('keydown',e=>{if(e.code==='Tab'&&mode==='flight'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.matches('input,select,button,a,summary')&&!document.querySelector('dialog[open]')){const available=latest?.vehicles.filter(v=>v.status!=='destroyed')||[];if(available.length>1){e.preventDefault();focusVehicle(available[(available.findIndex(v=>v.id===focusId)+1)%available.length].id);}}});
for(const [id,globe] of [['view-follow',false],['view-earth',true]])$('#'+id).onclick=()=>{scene.setView(globe);$('#orbit-legend').hidden=!globe;$('#view-site').hidden=globe;$('#view-follow').classList.toggle('active',!globe);$('#view-earth').classList.toggle('active',globe);$('#view-instructions').innerHTML=globe?'ドラッグで地球を回転 <b>·</b> スクロールで拡大・縮小':'カメラ操作のみ <b>·</b> 飛行制御はUDPから';};
$('#view-iso').onclick=()=>{scene.fit();$('#view-iso').classList.add('active');$('#view-front').classList.remove('active');};
$('#view-front').onclick=()=>{scene.fit(true);$('#view-front').classList.add('active');$('#view-iso').classList.remove('active');};
$('#view-fit').onclick=()=>scene.fit();$('#view-site').onclick=()=>scene.fitSite();$('#zoom-in').onclick=()=>scene.zoom(.8);$('#zoom-out').onclick=()=>scene.zoom(1.25);
$('#grid-button').onclick=()=>{scene.grid.visible=!scene.grid.visible;$('#grid-button').classList.toggle('active',scene.grid.visible);};
$('#markers-button').onclick=()=>{scene.showMarkers=!scene.showMarkers;scene.markers.visible=scene.showMarkers;$('#markers-button').classList.toggle('active',scene.showMarkers);if(scene.showMarkers)toast('オレンジ：重心 / グリーン：空力中心の概算');};
for(const id of ['help-button','connect-button'])$('#'+id).onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();
$('#help-dialog').addEventListener('click',e=>{if(e.target===$('#help-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#copy-demo').onclick=()=>copyDemo();
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea')||$('#help-dialog').open||mode!=='editor')return;if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();undo();}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}if(e.key==='Escape'){selectPart(null);scene.setPlacement(null);}});
