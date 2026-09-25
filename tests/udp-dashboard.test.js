import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {UdpDashboardClient} from '../examples/udp-dashboard/client.ts';

const identity={runtimeInstance:'unrelated-udp-peer',runtimeGeneration:7,runtimeEpoch:'epoch',runtimeVesselId:'vessel',vesselId:'vessel'};
async function bind(){const socket=dgram.createSocket('udp4');socket.bind(0,'127.0.0.1');await once(socket,'listening');return socket;}
async function until(predicate){for(let i=0;i<150;i++){if(await predicate())return;await delay(10);}throw Error('UDP condition timed out');}
async function peer(t){
  const receiver=await bind(),reserve=await bind(),telemetryPort=reserve.address().port;
  await new Promise(r=>reserve.close(r));
  t.after(()=>receiver.close());
  const packets=[];receiver.on('message',bytes=>packets.push({text:bytes.toString(),json:JSON.parse(bytes.toString())}));
  const send=packet=>new Promise((resolve,reject)=>receiver.send(Buffer.from(JSON.stringify(packet)),telemetryPort,'127.0.0.1',e=>e?reject(e):resolve()));
  return {receiver,packets,send,config:{host:'127.0.0.1',commandPort:receiver.address().port,telemetryPort,renewLease:false}};
}

test('standalone client sends raw JSON without a simulator, session or manifest',async t=>{
  const wire=await peer(t),client=new UdpDashboardClient();t.after(()=>client.disconnect());
  await client.connect(wire.config);
  const raw='{ "type": "custom_probe", "value": 42 }';
  await client.raw(raw);await until(()=>wire.packets.length===1);
  assert.equal(wire.packets[0].text,raw,'Raw bytes must not be rewritten');
  await assert.rejects(client.send({type:'pylon_flight_control_command'}),/セッション/);
  client.setSession(identity);
  await client.command({command:{type:'pylon_actuator_command',actuatorType:'engine',name:'not_in_any_manifest',enabled:true,targetThrust:12345,timeoutSeconds:.4}});
  await until(()=>wire.packets.length===2);
  assert.equal(wire.packets[1].json.name,'not_in_any_manifest');
  assert.equal(wire.packets[1].json.targetThrust,12345);
  assert.equal(wire.packets[1].json.runtimeGeneration,7);
});

test('manifest is suggestions only: arbitrary names and separation are sent without automatic follow-up',async t=>{
  const wire=await peer(t),client=new UdpDashboardClient();t.after(()=>client.disconnect());
  await client.connect(wire.config);
  await wire.send({type:'pylon_session',version:1,...identity,available:true});await until(()=>client.session);
  await wire.send({type:'pylon_actuator_manifest',version:1,...identity,actuators:[{name:'anything_sideways',actuatorType:'engine',available:false}]});
  await until(()=>client.manifest.length===1);
  assert.equal(wire.packets.length,0,'Receiving a session must not send acquisition, ignition or guidance');
  for(const command of [
    {type:'pylon_actuator_command',actuatorType:'engine',name:'arbitrary_upper',enabled:true,targetThrust:9876,timeoutSeconds:.4},
    {type:'pylon_actuator_command',actuatorType:'separation',name:'user_named_latch',separate:true},
    {type:'pylon_flight_control_command',pitch:.2,yaw:-.3,roll:.4,landingGear:false,timeoutSeconds:.4},
    {type:'pylon_body_wrench_command',frame:'base_link',force:[1,2,3],torque:[4,5,6],timeoutSeconds:.4}
  ])await client.command({command});
  await until(()=>wire.packets.length===4);await delay(160);
  assert.equal(wire.packets.length,4,'No staging policy, automatic attitude hold or upper-stage ignition');
  assert.equal(wire.packets[0].json.name,'arbitrary_upper');assert.equal(wire.packets[1].json.name,'user_named_latch');
  assert.deepEqual(wire.packets.map(p=>p.json.sequence),[1,2,3,4]);
  assert.deepEqual(wire.packets[3].json.force,[1,2,3]);
});

test('explicit repeating commands stop on session changes and browser disconnect; lease release is flushed',async t=>{
  const wire=await peer(t),client=new UdpDashboardClient();t.after(()=>client.disconnect());
  await client.connect(wire.config);client.setSession(identity);
  const command={type:'pylon_actuator_command',actuatorType:'engine',name:'free_name',enabled:true,targetThrust:4321,timeoutSeconds:.4};
  await client.command({command,repeat:true});await until(()=>wire.packets.length>=3);
  client.setSession({...identity,runtimeEpoch:'new-epoch'});assert.equal(client.repeat,null);
  const count=wire.packets.length;await delay(120);assert.equal(wire.packets.length,count);
  await assert.rejects(client.command({command:{type:'pylon_actuator_command',actuatorType:'separation',name:'any',separate:true},repeat:true}),/1回/);
  await client.command({command,repeat:true});
  await wire.send({type:'pylon_control_authority_state',version:1,...identity,runtimeEpoch:'new-epoch',state:1,controllerId:client.controllerId,leaseId:client.leaseId,reason:'lease_acquired'});
  await until(()=>client.owns());client.lastBrowser=Date.now()-3100;
  await client.tick();await until(()=>wire.packets.some(p=>p.json.action==='release'));
  assert.equal(client.socket,null);assert.equal(client.repeat,null);
  assert.equal(wire.packets.at(-1).json.action,'release');
});

test('demo HTTP dashboard runs on its own port with only a UDP peer',async t=>{
  const wire=await peer(t),tcp=net.createServer();tcp.listen(0,'127.0.0.1');await once(tcp,'listening');
  const port=tcp.address().port;await new Promise(r=>tcp.close(r));
  const child=spawn(process.execPath,['--import','tsx','examples/udp-dashboard/server.ts'],{env:{...process.env,UDP_DASHBOARD_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}});
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{try{return (await fetch(`${base}/api/state`)).ok;}catch{if(child.exitCode!==null)throw Error(logs);return false;}});
  const html=await (await fetch(base)).text();assert.match(html,/UDP Command Desk/);assert.doesNotMatch(html,/src\/App|api\/manual-demo/);
  assert.equal((await fetch(`${base}/app.js`)).status,200);
  const post=async(path,body)=>{const r=await fetch(`${base}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
  await post('connect',wire.config);
  await post('raw',{text:'{"type":"test_without_astroforge"}'});await until(()=>wire.packets.length===1);
  assert.equal(wire.packets[0].json.type,'test_without_astroforge');
  await post('session',{session:identity});
  await post('send',{command:{type:'pylon_actuator_command',actuatorType:'separation',name:'random_name',separate:true}});
  await until(()=>wire.packets.length===2);assert.equal(wire.packets[1].json.name,'random_name');
  await post('disconnect',{});
  assert.equal((await (await fetch(`${base}/api/state`)).json()).connected,false);
  assert.equal((await fetch(`${base}/server/index.ts`)).status,404);
  assert.equal((await fetch(`${base}/api/state`,{headers:{Origin:'https://example.com'}})).status,403);
});

test('demo dependency boundary excludes application internals and application imports no demo',async()=>{
  for(const file of ['client.ts','server.ts']){
    const source=await readFile(`examples/udp-dashboard/${file}`,'utf8');
    for(const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g))assert.ok(match[1].startsWith('node:')||match[1]==='./client.ts',match[1]);
  }
  for(const dir of ['server','src','shared']){
    for(const entry of await readdir(dir,{recursive:true})){
      if(!/\.(ts|vue)$/.test(entry))continue;
      const source=await readFile(`${dir}/${entry}`,'utf8');
      assert.doesNotMatch(source,/from\s+['"][^'"]*examples\//);
      assert.doesNotMatch(source,/api\/manual-demo|ManualController|ManualDemo/);
    }
  }
  const app=await readFile('examples/udp-dashboard/app.js','utf8');
  assert.doesNotMatch(app,/localhost:3000|\/api\/control|\/api\/launch|\/api\/manual-demo/);
});
