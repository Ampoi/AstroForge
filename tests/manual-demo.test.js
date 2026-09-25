import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import {setTimeout as delay} from 'node:timers/promises';
import {ManualController} from '../examples/manual-controller.ts';
import {twoStageCraft} from '../shared/craft.ts';

test('dashboard HTTP controls use real UDP for throttle, separation, stop and disconnect', {timeout:20000},async t=>{
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const telemetry=dgram.createSocket('udp4'),command=dgram.createSocket('udp4');
  telemetry.bind(0,'127.0.0.1');command.bind(0,'127.0.0.1');
  await Promise.all([once(telemetry,'listening'),once(command,'listening')]);
  const telemetryPort=telemetry.address().port,commandPort=command.address().port;
  await new Promise(r=>command.close(r));
  let telemetryOpen=true;
  const data=await mkdtemp(join(tmpdir(),'astroforge-manual-'));
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),UDP_COMMAND_PORT:String(commandPort),UDP_TELEMETRY_PORT:String(telemetryPort),ASTROFORGE_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}if(telemetryOpen)telemetry.close();await rm(data,{recursive:true,force:true});});
  const get=()=>fetch(`http://127.0.0.1:${port}/api/state`).then(r=>r.json());
  let state;
  for(let i=0;i<150;i++){try{state=await get();break;}catch{}if(child.exitCode!==null)throw Error(logs);await delay(20);}
  assert.ok(state,logs);const id=state.activeVehicleId;
  const current=s=>s.vehicles.find(v=>v.id===id);
  async function post(action,extra={},status=200,path='manual-demo'){
    const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId:id,action,...extra})});
    const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
  }
  async function until(predicate){for(let i=0;i<150;i++){const s=await get();if(predicate(current(s),s))return s;await delay(20);}throw Error('Manual demo condition timed out: '+JSON.stringify(current(await get())));}
  await post('start',{},400); // External telemetry listener keeps its socket.
  assert.equal(current(await get()).udp.authority.state,0);
  await new Promise(r=>telemetry.close(r));telemetryOpen=false;
  await post('start');await until(v=>v.udp.demo?.ready);
  const heartbeat=setInterval(()=>{void fetch(`http://127.0.0.1:${port}/api/manual-demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicleId:id,action:'heartbeat'})}).catch(()=>{});},500);
  t.after(()=>clearInterval(heartbeat));
  assert.equal(current(await get()).thrust,0,'Acquiring control must not ignite');
  for(const throttle of [-1,101,null,'50'])await post('throttle',{throttle},400);
  await post('unknown',{},400);
  await post('throttle',{throttle:100});await until(v=>v.thrust>50000&&v.altitude>50);
  assert.equal(current(await get()).udp.authority.controllerId,'astroforge-dashboard');
  const session=current(await get()).udp.session;
  const added=await post(undefined,twoStageCraft(),200,'launch'),secondId=added.activeVehicleId;
  await post('start',{vehicleId:secondId},400);
  await post(undefined,{vehicleId:secondId,enabled:true},200,'control');
  await post('start',{vehicleId:secondId});
  await until((v,s)=>s.vehicles.find(v=>v.id===secondId).udp.demo.ready);
  await post('throttle',{vehicleId:secondId,throttle:20});
  await until((v,s)=>s.vehicles.find(v=>v.id===secondId).thrust>10000);
  assert.equal(current(await get()).udp.demo.throttle,100,'Second vehicle input must not change the first');
  await post(undefined,{vehicleId:secondId,enabled:false},200,'control');
  assert.deepEqual(current(await get()).udp.session,session);
  assert.equal(current(await get()).udp.demo.ready,true);
  await post('throttle',{throttle:25});await until(v=>v.thrust>10000&&v.thrust<20000);
  await post('throttle',{throttle:0});await until(v=>v.thrust===0);
  await post('separate');await until(v=>v.udp.demo.stage===2&&!v.udp.demo.separating);
  let v=current(await get());assert.equal(v.udp.demo.throttle,0);assert.equal(v.thrust,0);
  assert.ok(!v.craft.parts.some(p=>p.id==='separator_1'));
  assert.ok(v.udp.received>0&&v.udp.accepted>0,'Control traverses UDP protocol validation');
  await post('separate',{},400);
  await post('throttle',{throttle:60});await until(v=>v.thrust>30000);
  await post('stop');await until(v=>v.thrust===0&&v.udp.authority.state===0);
  await post('start');await until(v=>v.udp.demo.ready);
  await post('throttle',{throttle:100});await until(v=>v.thrust>50000);
  // No browser heartbeat: the server-side client must stop and release its lease.
  clearInterval(heartbeat);
  await until(v=>!v.udp.demo.running&&v.thrust===0&&v.udp.authority.state===0);
  assert.match(current(await get()).udp.demo.phase,/画面との接続/);
  await post('start');await until(v=>v.udp.demo.ready);
  await post(undefined,{enabled:false},200,'control');
  v=current(await get());assert.equal(v.udp.enabled,false);assert.equal(v.udp.demo.running,false);
  await post('start',{},400);
});

test('manual demo stops on stale telemetry and never stages automatically',()=>{
  const demo=new ManualController();let sent=[];
  demo.send=(type,fields)=>sent.push({type,...fields});
  demo.flight={upBody:[1,0,0],eastBody:[0,1,0],angularVelocityBody:[0,0,0],liquidFuel:0,altitudeAgl:100,apoapsis:100};
  demo.separators=['ring'];demo.throttle=75;
  demo.drive(performance.now()/1000,[{name:'engine',available:true,flameout:true,maxThrust:60000}]);
  assert.ok(!sent.some(p=>p.actuatorType==='separation'));
  assert.equal(sent.find(p=>p.actuatorType==='engine').targetThrust,45000);
  Object.assign(demo,{running:true,session:{},lastHeartbeat:performance.now()/1000-2,lastFlight:performance.now()/1000});
  demo.tick();assert.equal(demo.running,false);assert.equal(demo.throttle,0);assert.match(demo.phase,/テレメトリ/);
});
