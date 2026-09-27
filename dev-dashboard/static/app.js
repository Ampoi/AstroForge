const $ = s => document.querySelector(s);
const labels = {queued:'待機中',running:'実行中',review:'開発完了',blocked:'要対応',done:'完了',cancelled:'キャンセル'};
const descriptions = {queued:'順番・依存タスクの完了待ち',running:'専用 worktree で開発中',review:'検証成功 · レビューと手動統合待ち',blocked:'理由と必要な対応を確認してください',done:'レビュー・main への統合を確認済み',cancelled:'停止済み · 自動では再開しません'};
let tasks = [], settings = {}, selected = null, authenticated = false;
let boardSignature = '', detailSignature = '';
function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function error(e) { const dialog = document.querySelector('dialog[open]'); if(dialog) { let box=dialog.querySelector('.dialog-error'); if(!box) { box=el('p',undefined,'dialog-error failure'); box.setAttribute('role','alert'); dialog.prepend(box); } box.textContent=e.message; } else { $('#error').textContent = e.message; $('#error').hidden = false; } }
async function api(path, method='GET', body) {
  const r = await fetch('/api'+path, {method, headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
  const data = await r.json();
  if (!r.ok) { if(r.status === 401) showLogin(); throw new Error(data.error || '接続に失敗しました'); }
  return data;
}
function showLogin() { authenticated=false; $('#login').hidden=false; $('#workspace').hidden=true; $('#logout').hidden=true; $('#connection').textContent='未接続'; }
function button(text, fn, cls='quiet') { const b=el('button',text,cls); b.onclick=()=>Promise.resolve().then(fn).catch(error); return b; }
function render() {
  for(const state of ['running','queued','review','done']) $('#'+state+'-count').textContent=tasks.filter(t=>t.state===state).length;
  $('#total-count').textContent=tasks.length;
  if(document.activeElement!==$('#workers')) $('#workers').value=settings.max_workers;
  $('#pause').textContent=settings.paused?'自動実行を再開':'キューを一時停止';
  $('#queue-status').textContent=settings.paused?'一時停止中 · 実行中の作業は継続します':`自動実行中 · 最大 ${settings.max_workers} 件を並列開発`;
  const signature=JSON.stringify(tasks);
  if(signature===boardSignature) return;
  boardSignature=signature;
  const board=$('#board'); board.replaceChildren();
  for(const state of ['queued','running','review','blocked','done','cancelled']) {
    const column=el('section',undefined,'column '+state); column.setAttribute('aria-label',labels[state]); const list=tasks.filter(t=>t.state===state);
    const title=el('div',undefined,'column-title'); title.append(el('h3',labels[state]),el('span',list.length,'count')); column.append(title,el('p',descriptions[state],'column-description'));
    if(!list.length) column.append(el('div',state==='queued'?'次のアイデアを待っています':state==='done'?'統合を確認したタスクがここに並びます':'タスクはありません','empty'));
    for(const task of list) {
      const card=el('button',undefined,'card'); card.onclick=()=>openDetail(task.id).catch(error);
      const top=el('div',undefined,'card-top'); top.append(el('span',labels[task.state],'badge '+task.state),el('span',task.priority>0?'優先度 高':task.priority<0?'優先度 低':'通常','priority'));
      card.append(top,el('h3',task.title));
      if(task.attention) {
        const note=el('div',undefined,'card-attention');
        note.append(el('strong','止まっている理由'),el('p',task.attention.reason),el('strong','次に必要な対応'),el('p',task.attention.steps[0]),el('span','詳細と対応手順を開く →','attention-link'));
        card.append(note);
      } else {
        card.append(el('p',task.result?.summary || task.prompt.slice(0,95),'card-summary'));
        if(state==='review'||state==='done') card.append(el('div',descriptions[state],'completion-note'));
      }
      card.append(el('div',task.branch || (task.dependencies.length?'依存タスクの統合を待機':'専用 worktree を作成予定'),'branch'));
      const bottom=el('div',undefined,'card-bottom'); bottom.append(el('span','#'+task.id.slice(0,6)),el('span',new Date(task.updated*1000).toLocaleString('ja-JP',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))); card.append(bottom); column.append(card);
    }
    board.append(column);
  }
}
async function refresh() {
  const [a,b,c]=await Promise.all([api('/tasks'),api('/settings'),api('/worktrees')]);
  tasks=a.tasks; settings=b; authenticated=true; $('#login').hidden=true; $('#workspace').hidden=false; $('#logout').hidden=false; $('#connection').textContent='● 接続済み'; render();
  const list=$('#worktree-list'); list.replaceChildren();
  for(const w of c.worktrees) {const row=el('div',undefined,'worktree');row.append(el('span','⑂'),el('strong',(w.branch||'detached').replace('refs/heads/','')),el('code',w.worktree),el('small',(w.HEAD||'').slice(0,8)));list.append(row);}
  if(selected && $('#detail-dialog').open) await updateDetail();
}
async function openDetail(id) { selected=id; detailSignature=''; $('#detail-dialog').querySelector('.dialog-error')?.remove(); await updateDetail(); $('#detail-dialog').showModal(); }
async function updateDetail() {
  const [task,log]=await Promise.all([api('/tasks/'+selected),api('/tasks/'+selected+'/log')]);
  const logText=log.log||'まだログはありません';
  if($('#detail-log').textContent!==logText) $('#detail-log').textContent=logText;
  const signature=JSON.stringify([task,settings.paused]);
  if(signature===detailSignature) return;
  detailSignature=signature;
  $('#detail-title').textContent=task.title; $('#detail-meta').textContent=`${labels[task.state]} · 試行 ${task.attempt} · ${task.branch||'未開始'}\n${task.worktree||''}`;
  const attention=$('#detail-attention'); attention.replaceChildren(); attention.hidden=!task.attention;
  if(task.attention) {
    attention.append(el('h3','止まっている理由'),el('p',task.attention.reason),el('h3','次に必要な対応'));
    const steps=el('ol'); for(const step of task.attention.steps) steps.append(el('li',step)); attention.append(steps);
    if(task.attention.evidence.length) {const evidence=el('ul');for(const check of task.attention.evidence) evidence.append(el('li',check));attention.append(el('h3','未完了の検証'),evidence);}
    if(task.attention.source==='inferred') attention.append(el('p','過去の実行結果から整理した案内です。詳しいエラーは下の検証結果・ログで確認できます。','hint'));
    if(settings.paused) attention.append(el('p','キューは一時停止中です。対応後に再試行を登録し、キューを再開してください。','hint'));
  }
  $('#detail-prompt').textContent=task.prompt; $('#detail-result').replaceChildren();
  if(task.result) $('#detail-result').append(el('h3','今回できたこと・実行結果'),el('pre',task.result.summary),el('h3','検証結果'),el('pre',task.result.checks.join('\n')));
  if(task.error) {const details=el('details');details.append(el('summary','エラー詳細（原文）'),el('pre',task.error,'failure'));$('#detail-result').append(details);}
  const actions=$('#detail-actions'); actions.replaceChildren();
  const act=async action=>{await api('/tasks/'+task.id+'/'+action,'POST',{}); await refresh();};
  if(task.state==='blocked') actions.append(button('対応後に再試行',()=>act('retry')),el('p','変更は保持されます。原因が残ったままでは、再び要対応になる場合があります。','hint'));
  if(['queued','running','blocked'].includes(task.state)) actions.append(button(task.state==='blocked'?'このタスクをキャンセル':'作業を停止',()=>act('cancel')));
  if(task.state==='cancelled') actions.append(button('保持した worktree で再開',()=>act('retry')));
  if(task.state==='review') { actions.append(el('p','開発と検証は完了しました。ブランチをレビューして main へ通常の merge で統合後、「完了」に移動できます。'),button('統合済みを確認して完了',()=>act('done'))); }
  if(task.state==='done') actions.append(el('p','完了しました。main への統合を確認済みです。追加の対応はありません。','completion-note'));
}
$('#login-form').onsubmit=async e=>{e.preventDefault();try{await api('/login','POST',{token:$('#token').value});$('#token').value='';$('#error').hidden=true;await refresh();}catch(e){error(e);}};
$('#logout').onclick=async()=>{try{await api('/logout','POST',{});showLogin();}catch(e){error(e);}};
$('#pause').onclick=async()=>{try{await api('/settings','PATCH',{paused:!settings.paused});await refresh();}catch(e){error(e);}};
$('#save-workers').onclick=async()=>{try{await api('/settings','PATCH',{max_workers:Number($('#workers').value)});await refresh();}catch(e){error(e);}};
$('#new-task').onclick=()=>{const deps=$('#dependency');deps.replaceChildren(el('option','なし'));deps.firstChild.value='';for(const t of tasks.filter(t=>t.state!=='cancelled')){const o=el('option',t.title);o.value=t.id;deps.append(o);}$('#create-dialog').showModal();};
for(const b of document.querySelectorAll('.close-dialog')) b.onclick=()=>b.closest('dialog').close();
$('#task-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const f=new FormData(e.target);await api('/tasks','POST',{title:f.get('title'),prompt:f.get('prompt'),priority:Number(f.get('priority')),dependencies:f.get('dependency')?[f.get('dependency')]:[]});$('#create-dialog').close();e.target.reset();await refresh();}catch(e){error(e);}finally{b.disabled=false;}};
refresh().catch(e=>{if(!$('#login').hidden) return; $('#connection').textContent='接続エラー'; error(e);});
setInterval(()=>{if(authenticated)refresh().catch(e=>{$('#connection').textContent='接続エラー';error(e);});},3000);
