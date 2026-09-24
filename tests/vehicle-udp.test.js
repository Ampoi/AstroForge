import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {VehicleUdp} from '../server/vehicle-udp.ts';
import {Simulation} from '../server/physics.ts';
import {starterCraft} from '../shared/craft.ts';

async function bind(port=0){
  const socket=dgram.createSocket('udp4');
  try{socket.bind(port,'127.0.0.1');await once(socket,'listening');return socket;}
  catch(error){socket.close();throw error;}
}
async function setup(t){
  // Keep the telemetry client bound; its port is a destination, not a server listener.
  let client,probe;
  for(;;){
    client=await bind();const port=client.address().port;
    if(port>65000){client.close();continue;}
    try{probe=await bind(port+1);break;}catch{client.close();}
  }
  const commandPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const udp=new VehicleUdp({commandPort,telemetryPort:client.address().port,telemetryHost:'127.0.0.1'});
  const sockets=[client];t.after(async()=>{await udp.close();for(const s of sockets)s.close();});
  return {udp,client,sockets,commandPort};
}
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await delay(5);}throw Error('UDP condition timed out');}
const acquire={type:'pylon_control_authority_command',action:'acquire',priority:10,leaseDurationSeconds:10,suppressSas:true};
const engine={type:'pylon_actuator_command',actuatorType:'engine',name:'engine_1',enabled:true,targetThrust:60000,timeoutSeconds:10};
const packet=(session,fields)=>({...session,controllerId:'test',leaseId:'lease',sequence:1,...fields});
const send=(client,port,session,fields)=>new Promise((resolve,reject)=>client.send(Buffer.from(JSON.stringify(packet(session,fields))),port,'127.0.0.1',error=>error?reject(error):resolve()));

test('real UDP channels isolate commands, telemetry, OFF and renewed sessions',async t=>{
  const {udp,client,sockets}=await setup(t),a=new Simulation(starterCraft()),b=new Simulation(starterCraft());
  await udp.enable(a);await udp.enable(b);
  const first=udp.snapshot(a.id),second=udp.snapshot(b.id);
  assert.equal(new Set([first.commandPort,first.telemetryPort,second.commandPort,second.telemetryPort]).size,4);
  assert.notEqual(first.session.vesselId,second.session.vesselId);
  const clientB=await bind(second.telemetryPort);sockets.push(clientB);
  const packetsA=[],packetsB=[];client.on('message',p=>packetsA.push(JSON.parse(p)));clientB.on('message',p=>packetsB.push(JSON.parse(p)));
  await send(client,first.commandPort,first.session,acquire);
  await send(clientB,second.commandPort,second.session,acquire);
  await waitFor(()=>udp.snapshot(a.id).accepted===1&&udp.snapshot(b.id).accepted===1);
  await send(client,first.commandPort,first.session,engine);
  await send(clientB,second.commandPort,second.session,{...engine,targetThrust:30000});
  await waitFor(()=>a.engines.engine_1&&b.engines.engine_1);
  a.step();b.step();assert.equal(a.last.thrust,60000);assert.equal(b.last.thrust,30000);
  udp.telemetry(5);
  await waitFor(()=>packetsA.some(p=>p.type==='pylon_session')&&packetsB.some(p=>p.type==='pylon_session'));
  assert.ok(packetsA.every(p=>p.vesselId===first.session.vesselId));assert.ok(packetsB.every(p=>p.vesselId===second.session.vesselId));
  assert.ok(packetsB.some(p=>p.type==='pylon_session'&&p.warpRate===5&&p.physicsWarp));
  await send(client,second.commandPort,first.session,{...engine,sequence:2});
  await waitFor(()=>udp.snapshot(b.id).rejected===1);assert.equal(b.engines.engine_1.targetThrust,30000);
  await udp.enable(a);assert.deepEqual(udp.snapshot(a.id).session,first.session);
  await udp.disable(a.id);a.step();assert.equal(a.last.thrust,0);assert.deepEqual(a.engines,{});
  assert.equal(udp.snapshot(a.id).enabled,false);assert.equal(udp.snapshot(a.id).authority.state,0);
  assert.deepEqual(udp.snapshot(b.id).session,second.session);assert.equal(b.engines.engine_1.targetThrust,30000);
  const freed=await bind(first.commandPort);await new Promise(resolve=>freed.close(resolve));
  // Drain already queued telemetry, then verify OFF stops this stream only.
  await delay(30);const countA=packetsA.length,countB=packetsB.length;udp.telemetry(5);
  await waitFor(()=>packetsB.length>countB);await delay(20);assert.equal(packetsA.length,countA);
  await udp.enable(a);const restarted=udp.snapshot(a.id);
  assert.equal(restarted.commandPort,first.commandPort);assert.equal(restarted.telemetryPort,first.telemetryPort);
  assert.notDeepEqual(restarted.session,first.session);
  await send(client,restarted.commandPort,first.session,acquire);
  await waitFor(()=>udp.snapshot(a.id).rejected===1);assert.equal(udp.snapshot(a.id).lastCommand.reason,'runtime_session_mismatch');
  await send(client,restarted.commandPort,restarted.session,acquire);
  await waitFor(()=>udp.snapshot(a.id).authority.state===1);
  await udp.retain([b]);assert.equal(udp.snapshot(a.id).commandPort,null);assert.equal(udp.snapshot(b.id).enabled,true);
});

test('occupied ports are skipped, OFF reservations are unique, failed re-enable stays OFF',async t=>{
  const {udp,sockets,commandPort}=await setup(t),a=new Simulation(starterCraft()),b=new Simulation(starterCraft());
  const blocker=await bind(commandPort);sockets.push(blocker);
  await udp.enable(a);const first=udp.snapshot(a.id);assert.ok(first.commandPort>commandPort);
  await udp.disable(a.id);await udp.enable(b);const second=udp.snapshot(b.id);
  assert.notEqual(second.commandPort,first.commandPort);assert.notEqual(second.telemetryPort,first.telemetryPort);
  const blockerA=await bind(first.commandPort);sockets.push(blockerA);
  await assert.rejects(udp.enable(a),/利用できません/);assert.equal(udp.snapshot(a.id).enabled,false);assert.equal(udp.snapshot(a.id).session,null);
  assert.equal(udp.snapshot(b.id).enabled,true);
});

test('port exhaustion fails without enabling a vehicle',async t=>{
  const blocker=await bind(65535);t.after(()=>blocker.close());
  const udp=new VehicleUdp({commandPort:65535,telemetryPort:65534,telemetryHost:'127.0.0.1'});t.after(()=>udp.close());
  const sim=new Simulation(starterCraft());await assert.rejects(udp.enable(sim),/割り当て可能/);assert.equal(udp.snapshot(sim.id).enabled,false);
  assert.throws(()=>new VehicleUdp({commandPort:49011,telemetryPort:49011}),/異なる値/);
});
