import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import {starterCraft,twoStageCraft} from '../shared/craft.ts';

async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('HTTP lifecycle, library persistence, independent UDP toggles, SSE, and time warp', {timeout:20000},async t=>{
  const data=await mkdtemp(join(tmpdir(),'astroforge-api-')),port=await freePort();
  const telemetry=dgram.createSocket('udp4');telemetry.bind(0,'127.0.0.1');await once(telemetry,'listening');
  const reserved=dgram.createSocket('udp4');reserved.bind(0,'127.0.0.1');await once(reserved,'listening');const commandPort=reserved.address().port;reserved.close();
  const packets=[];telemetry.on('message',p=>{packets.push(JSON.parse(p));if(packets.length>1000)packets.shift();});
  let child;
  const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}child=null;};
  t.after(async()=>{await stop();telemetry.close();await rm(data,{recursive:true,force:true});});
  async function start(){
    child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),UDP_COMMAND_PORT:String(commandPort),UDP_TELEMETRY_PORT:String(telemetry.address().port),ASTROFORGE_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
    let output='';child.stderr.on('data',d=>output+=d);child.stdout.on('data',d=>output+=d);
    for(let i=0;i<150;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/state`);if(r.ok)return;}catch{}if(child.exitCode!==null)throw Error(output);await delay(20);}throw Error('Server did not start: '+output);
  }
  const get=()=>fetch(`http://127.0.0.1:${port}/api/state`).then(r=>r.json());
  async function post(path,input,code=200){const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await r.json();assert.equal(r.status,code,JSON.stringify(value));return value;}
  await start();let s=await get();assert.equal(s.mode,'flight');assert.equal(s.vehicles.length,1);assert.equal(s.timeScale,1);
  assert.deepEqual(s.craft,twoStageCraft());assert.equal(s.library.length,2,'Default presets must not become saved duplicates');
  assert.equal(s.connection.physicsBackend,process.env.ASTROFORGE_PHYSICS==='js'?'js':'zig-wasm');
  // Production serves Vite output and public assets; application source is not a static endpoint.
  const homepage=await fetch(`http://127.0.0.1:${port}/`);assert.equal(homepage.status,200);
  const html=await homepage.text();assert.match(html,/<div id="app"><\/div>/);assert.doesNotMatch(html,/importmap|\/src\//);
  const bundle=html.match(/src="([^"]+\.js)"/);assert.ok(bundle);
  const asset=await fetch(`http://127.0.0.1:${port}${bundle[1]}`);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  const head=await fetch(`http://127.0.0.1:${port}${bundle[1]}`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/shared/craft.ts','/server/index.ts','/vendor/three.module.js','/src/App.vue'])assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/assets/land.json`)).status,200);
  const firstId=s.activeVehicleId,session=s.connection.session;
  assert.equal(s.vehicles[0].udp.enabled,true);assert.deepEqual(s.vehicles[0].udp.session,session);
  s=await post('editor',{});assert.equal(s.mode,'editor');assert.equal(s.activeVehicleId,firstId);assert.deepEqual(s.connection.session,session);
  assert.equal(s.draft.rootId,null);assert.deepEqual(s.draft.parts,[]);
  const saved1=await post('craft',{...starterCraft(),name:'Saved one',rootId:'tank_1'});const saved2=await post('craft',{...twoStageCraft(),name:'Saved two'});
  s=await post('editor',{libraryId:saved1.libraryId});assert.equal(s.draft.rootId,'tank_1');
  await post('craft',{...starterCraft(),rootId:'missing'},400);
  await post('craft',{...starterCraft(),name:'Updated one',libraryId:saved1.libraryId});
  s=await post('editor',{libraryId:saved2.libraryId});assert.equal(s.draft.name,'Saved two');
  assert.equal(s.library.filter(e=>!['starter','two-stage'].includes(e.id)).length,2);
  s=await post('flight',{});assert.equal(s.activeVehicleId,firstId);
  await post('time-scale',{scale:3},400);await post('control',{vehicleId:'missing'},400);
  for(const enabled of [null,'false',0,{},[]])await post('control',{vehicleId:firstId,enabled},400);
  await post('launch',{name:'Invalid',parts:[]},400);
  s=await post('time-scale',{scale:10});assert.equal(s.timeScale,10);
  const identity=s.connection.session;
  const send=fields=>telemetry.send(Buffer.from(JSON.stringify({...identity,controllerId:'integration',leaseId:'test',sequence:1,...fields})),commandPort,'127.0.0.1');
  send({type:'pylon_control_authority_command',action:'acquire',priority:10,leaseDurationSeconds:10,suppressSas:true});await delay(30);
  send({type:'pylon_actuator_command',actuatorType:'engine',name:'engine_1',enabled:true,targetThrust:60000,timeoutSeconds:10});
  for(let i=0;i<100;i++){s=await get();if(s.flight.altitude>50)break;await delay(20);}
  assert.ok(s.flight.altitude>50);assert.equal(s.flight.status,'flying');
  assert.ok(packets.some(p=>p.type==='pylon_session'&&p.warpRate===10&&p.physicsWarp));
  const before=s.simulationTime;await delay(100);s=await get();assert.ok(s.simulationTime-before>.5);
  s=await post('launch',twoStageCraft());const secondId=s.activeVehicleId;assert.notEqual(secondId,firstId);assert.equal(s.vehicles.length,2);
  assert.equal(s.vehicles.find(v=>v.id===firstId).status,'flying');
  assert.equal(s.vehicles.find(v=>v.id===secondId).udp.enabled,false);assert.equal(s.connection.commandPort,null);
  assert.deepEqual(s.vehicles.find(v=>v.id===firstId).udp.session,session);
  assert.equal(s.vehicles.find(v=>v.id===firstId).udp.authority.controllerId,'integration');
  const concurrent=await Promise.all([post('control',{vehicleId:secondId,enabled:true}),post('control',{vehicleId:secondId,enabled:true})]);
  assert.deepEqual(concurrent[0].connection.session,concurrent[1].connection.session);
  s=await get();const second=s.vehicles.find(v=>v.id===secondId).udp;
  assert.equal(second.enabled,true);assert.notEqual(second.commandPort,commandPort);assert.notEqual(second.telemetryPort,telemetry.address().port);
  assert.deepEqual(s.vehicles.find(v=>v.id===firstId).udp.session,session);
  s=await post('control',{vehicleId:firstId});assert.equal(s.activeVehicleId,firstId);assert.deepEqual(s.connection.session,session);
  assert.equal(s.connection.authority.state,1);
  s=await post('control',{vehicleId:firstId,enabled:false});assert.equal(s.connection.enabled,false);assert.equal(s.connection.session,null);assert.equal(s.connection.authority.state,0);
  assert.deepEqual(s.vehicles.find(v=>v.id===secondId).udp.session,second.session);
  s=await post('control',{vehicleId:firstId,enabled:true});assert.ok(s.connection.session.runtimeGeneration>session.runtimeGeneration);
  assert.equal(s.connection.commandPort,commandPort);assert.equal(s.connection.authority.state,0);
  send({type:'pylon_control_authority_command',action:'acquire',priority:10,leaseDurationSeconds:10,suppressSas:true});await delay(60);
  assert.ok(packets.some(p=>p.reason==='runtime_session_mismatch'));
  const response=await fetch(`http://127.0.0.1:${port}/api/events`);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader(),first=await reader.read();assert.match(new TextDecoder().decode(first.value),/data:.*"vehicles"/);await reader.cancel();
  // Replacing the pad craft closes its UDP endpoint without touching the flight.
  s=await post('launch',starterCraft());assert.ok(!s.vehicles.some(v=>v.id===secondId));
  assert.equal(s.vehicles.find(v=>v.id===firstId).udp.enabled,true);
  const freed=dgram.createSocket('udp4');freed.bind(second.commandPort,'127.0.0.1');await once(freed,'listening');freed.close();
  s=await post('revert',{});assert.equal(s.vehicles.length,1);assert.equal(s.connection.enabled,false);
  await stop();await start();s=await get();assert.equal(s.library.find(e=>e.id===saved1.libraryId).craft.name,'Updated one');assert.equal(s.library.find(e=>e.id===saved2.libraryId).craft.name,'Saved two');assert.equal(s.craft.name,'Updated one');
});
