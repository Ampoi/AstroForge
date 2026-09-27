const $ = s => document.querySelector(s);
const labels = {queued:'待機中',running:'実行中',review:'レビュー待ち',blocked:'要対応',done:'完了',cancelled:'キャンセル'};
let tasks = [], settings = {}, selected = null, authenticated = false;
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
  for(const state of ['running','queued','review']) $('#'+state+'-count').textContent=tasks.filter(t=>t.state===state).length;
  $('#total-count').textContent=tasks.length;
  if(document.activeElement!==$('#workers')) $('#workers').value=settings.max_workers;
  $('#pause').textContent=settings.paused?'自動実行を再開':'キューを一時停止';
  $('#queue-status').textContent=settings.paused?'一時停止中 · 実行中の作業は継続します':`自動実行中 · 最大 ${settings.max_workers} 件を並列開発`;
  const board=$('#board'); board.replaceChildren();
  for(const states of [['queued'],['running'],['review'],['blocked','done','cancelled']]) {
    const column=el('div',undefined,'column'); const list=tasks.filter(t=>states.includes(t.state));
    const title=el('div',undefined,'column-title'); title.append(el('span',states.length===1?labels[states[0]]:'履歴・要対応'),el('span',list.length,'count')); column.append(title);
    if(!list.length) column.append(el('div',states[0]==='queued'?'次のアイデアを待っています':'タスクはありません','empty'));
    for(const task of list) {
      const card=el('button',undefined,'card'); card.onclick=()=>openDetail(task.id).catch(error);
      const top=el('div',undefined,'card-top'); top.append(el('span',labels[task.state],'badge '+task.state),el('span',task.priority>0?'優先度 高':task.priority<0?'優先度 低':'通常','priority'));
      card.append(top,el('h3',task.title),el('p',task.prompt.slice(0,95)),el('div',task.branch || (task.dependencies.length?'依存タスクの統合を待機':'専用 worktree を作成予定'),'branch'));
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
async function openDetail(id) { selected=id; await updateDetail(); $('#detail-dialog').showModal(); }
async function updateDetail() {
  const [task,log]=await Promise.all([api('/tasks/'+selected),api('/tasks/'+selected+'/log')]);
  $('#detail-title').textContent=task.title; $('#detail-meta').textContent=`${labels[task.state]} · 試行 ${task.attempt} · ${task.branch||'未開始'}\n${task.worktree||''}`;
  $('#detail-prompt').textContent=task.prompt; $('#detail-result').replaceChildren();
  if(task.error) $('#detail-result').append(el('pre',task.error,'failure'));
  if(task.result) $('#detail-result').append(el('h3','実行結果'),el('pre',task.result.summary+'\n\n'+task.result.checks.join('\n')));
  $('#detail-log').textContent=log.log||'まだログはありません';
  const actions=$('#detail-actions'); actions.replaceChildren();
  const act=async action=>{await api('/tasks/'+task.id+'/'+action,'POST',{}); await refresh();};
  if(['queued','running','blocked'].includes(task.state)) actions.append(button('作業を停止',()=>act('cancel')));
  if(['blocked','cancelled'].includes(task.state)) actions.append(button('保持した worktree で再試行',()=>act('retry')));
  if(task.state==='review') { actions.append(el('p','ブランチをレビューして main へ通常の merge で統合後、完了にできます。'),button('統合済みを確認して完了',()=>act('done'))); }
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
