import test from 'node:test';
import assert from 'node:assert/strict';
import { controlFields, partCommand, PartController } from '../src/part-controls.ts';
import { Simulation, EARTH } from '../server/physics.ts';
import { PylonProtocol } from '../server/protocol.ts';
import { twoStageCraft } from '../shared/craft.ts';
const linear={id:'slide',type:'linear'},servo={id:'hinge',type:'servo'};
function setup() {
  const craft=twoStageCraft();craft.parts.splice(1,0,servo,linear);
  const sim=new Simulation(craft), protocol=new PylonProtocol(sim,()=>sim.time);
  protocol.available=true;sim.status='flying';sim.position=[EARTH.radius+400000,0,0];sim.velocity=[0,0,0];sim.omega=[0,0,0];
  const client=new PartController('gui-test','lease');
  const transport=async command=>{protocol.receive(Buffer.from(JSON.stringify(command)));return {accepted:protocol.lastCommand.accepted,reason:protocol.lastCommand.reason};};
  const send=command=>client.send(protocol.fields(),command,transport,()=>true);
  return {sim,protocol,send,transport,client};
}
test('GUI motor position commands move the selected joint and expire without automatic renewal',async()=>{
  const {sim,protocol,send}=setup();
  await send(partCommand(linear,'position',{position:.7},true,5));
  for(let i=0;i<480;i++)sim.step();
  assert.ok(Math.abs(sim.joints.slide.position-.7)<.01);
  assert.equal(sim.joints.hinge.position,0,'unselected joint does not move');
  assert.ok(protocol.telemetry().some(p=>p.type==='pylon_motor_state'&&p.name==='slide'&&Math.abs(p.position-.7)<.01));
  await send(partCommand(servo,'position',{position:45},true,.5));
  assert.equal(sim.motors.hinge.position,Math.PI/4);
  for(let i=0;i<70;i++)sim.step();
  const position=sim.joints.hinge.position;
  for(let i=0;i<30;i++)sim.step();
  assert.equal(sim.joints.hinge.position,position);assert.ok(sim.joints.hinge.locked);
  await send(partCommand(linear,'velocity',{velocity:-.2},true,5));
  for(let i=0;i<60;i++)sim.step();
  await send(partCommand(linear,'position',{position:NaN},false,.05));
  sim.step();assert.ok(sim.joints.slide.locked);
  await send({type:'pylon_control_authority_command',action:'release'});
  assert.equal(protocol.owner.state,0);assert.deepEqual(sim.motors,{});
});
test('GUI packets share UDP validation, control ownership and session checks',async()=>{
  const {sim,protocol,send,client,transport}=setup();
  const motor=partCommand(linear,'position',{position:1},true,10);
  const old=protocol.fields();
  protocol.receive(Buffer.from(JSON.stringify({...old,type:'pylon_control_authority_command',controllerId:'ros',leaseId:'ros-lease',sequence:1,action:'acquire',priority:10,suppressSas:false,leaseDurationSeconds:10})));
  await assert.rejects(send(motor),/別のコントローラー/);assert.deepEqual(sim.motors,{});
  protocol.clearOwner('released');await send(motor);
  protocol.newSession();assert.deepEqual(sim.motors,{});
  await assert.rejects(client.send(old,motor,transport,()=>true),/セッション/);
  await assert.rejects(send({...motor,position:null}),/invalid_motor_command/);
  await send(motor);sim.time+=11;protocol.expire();assert.deepEqual(sim.motors,{});
});
test('no actuator packet follows rejected acquisition or a change of selection/connection',async()=>{
  const client=new PartController('gui','lease'),seen=[];
  const motor=partCommand(linear,'position',{position:1},true,1);
  await assert.rejects(client.send({},motor,async c=>{seen.push(c);return {accepted:false,reason:'emergency_stop'};},()=>true),/緊急停止/);
  assert.equal(seen.length,1);seen.length=0;
  await assert.rejects(client.send({},motor,async c=>{seen.push(c);return {accepted:true,reason:''};},()=>seen.length===0),/接続または選択対象/);
  assert.equal(seen.length,1);assert.equal(seen[0].type,'pylon_control_authority_command');
});
test('input limits reject invalid values and convert servo/wheel degrees to protocol radians',()=>{
  for(const position of [NaN,Infinity,-1,2.1,'',null])assert.throws(()=>partCommand(linear,'position',{position},true,10));
  for(const timeout of [NaN,0,11])assert.throws(()=>partCommand(linear,'position',{position:1},true,timeout));
  assert.equal(partCommand(servo,'velocity',{velocity:30},true,1).velocity,Math.PI/6);
  assert.equal(partCommand(linear,'effort',{effort:1200},true,1).hasEffort,true);
  const wheel={id:'wheel',type:'wheel'};
  const fields=Object.fromEntries(controlFields(wheel).map(f=>[f.key,f.initial]));
  assert.equal(partCommand(wheel,'position',{...fields,steeringAngle:30},true,1).steeringAngle,Math.PI/6);
  assert.equal(partCommand({id:'e',type:'vacuum_engine'},'position',{targetThrust:1000,gimbalPitch:.5,gimbalYaw:0,gimbalRoll:0},true,1).actuatorType,'engine');
  assert.equal(partCommand({id:'r',type:'rcs'},'position',{thrustLimit:10},true,1).thrustLimit,10);
});
