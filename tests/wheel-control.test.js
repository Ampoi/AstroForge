import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {options,run} from '../examples/wheel-control.ts';

test('wheel client requires explicit names and bounded user inputs',()=>{
  assert.throws(()=>options([]),/wheel/);
  assert.throws(()=>options(['--wheel','custom,2,0,-1,0']),/wheel/);
  assert.throws(()=>options(['--wheel','custom,.4,,405,0']),/wheel/);
  assert.throws(()=>options(['--wheel','custom,.4,0,405,0','--seconds','NaN']),/seconds/);
  assert.deepEqual(options(['--wheel','custom,.4,-.2,405,0']).wheels,[{name:'custom',targetAngularVelocity:.4,steeringAngle:-.2,maxDriveTorque:405,brake:0}]);
});
test('standalone wheel client sends only explicit targets over UDP without AstroForge',async t=>{
  const peer=dgram.createSocket('udp4');peer.bind(0,'127.0.0.1');await once(peer,'listening');
  const reserved=dgram.createSocket('udp4');reserved.bind(0,'127.0.0.1');await once(reserved,'listening');const port=reserved.address().port;await new Promise(r=>reserved.close(r));
  const session={version:1,runtimeInstance:'fake',runtimeGeneration:1,runtimeEpoch:'epoch',runtimeVesselId:'rv',vesselId:'v'};
  const received=[];let owner=null;
  const send=p=>peer.send(Buffer.from(JSON.stringify({...session,...p})),port,'127.0.0.1');
  peer.on('message',buffer=>{
    const p=JSON.parse(buffer);received.push(p);
    if(p.type==='pylon_control_authority_command'&&p.action==='acquire')owner=p;
    if(owner)send({type:'pylon_control_authority_state',state:1,controllerId:owner.controllerId,leaseId:owner.leaseId});
  });
  const timer=setInterval(()=>{send({type:'pylon_session',available:true});send({type:'pylon_actuator_manifest',actuators:[{name:'do_not_select',actuatorType:'wheel'}]});},30);
  t.after(()=>{clearInterval(timer);peer.close();});
  await run({host:'127.0.0.1',commandPort:peer.address().port,telemetryPort:port,seconds:.2,wheels:[{name:'arbitrary_right',targetAngularVelocity:.25,steeringAngle:-.3,maxDriveTorque:405,brake:0},{name:'arbitrary_left',targetAngularVelocity:.2,steeringAngle:0,maxDriveTorque:405,brake:.1}]});
  await new Promise(r=>setTimeout(r,30));
  const commands=received.filter(p=>p.type==='pylon_actuator_command');
  assert.ok(commands.length>=6);assert.deepEqual([...new Set(commands.map(p=>p.name))],['arbitrary_right','arbitrary_left']);
  assert.equal(commands[0].targetAngularVelocity,.25);assert.equal(commands[0].steeringAngle,-.3);
  assert.ok(commands.slice(-2).every(p=>p.brake===1&&p.targetAngularVelocity===0));
  assert.equal(received.at(-1).action,'release');
  for(const path of ['../examples/wheel-control.ts','../examples/udp-dashboard/client.ts']){
    const source=await readFile(new URL(path,import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"][^'"]*(?:server|shared)\//);
    assert.doesNotMatch(source,/fetch\(|\/api\/|craft\.json/);
  }
});
