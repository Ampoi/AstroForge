import test from 'node:test';
import assert from 'node:assert/strict';
import {PylonProtocol} from '../server/protocol.js';
import {Simulation} from '../server/physics.js';
import {starterCraft} from '../shared/craft.js';

function setup(){let now=0;const sim=new Simulation(starterCraft()),p=new PylonProtocol(sim,()=>now);p.available=true;
  const command=(type,fields={})=>({type,...p.fields(),controllerId:'test',leaseId:'lease',sequence:1,...fields});
  const send=packet=>p.receive(Buffer.from(JSON.stringify(packet)));
  const acquire=(fields={})=>send(command('pylon_control_authority_command',{action:'acquire',priority:10,leaseDurationSeconds:1,suppressSas:true,...fields}));
  const engine=(fields={})=>command('pylon_actuator_command',{actuatorType:'engine',name:'engine_1',enabled:true,targetThrust:60000,timeoutSeconds:.3,...fields});
  return {sim,p,command,send,acquire,engine,advance:v=>now=v};
}
test('telemetry heartbeat opens a versioned session and every packet carries it',()=>{
  const {p}=setup();const packets=p.telemetry();assert.equal(packets[0].type,'pylon_session');
  for(const packet of packets){for(const [k,v]of Object.entries(p.fields()))assert.equal(packet[k],v);assert.doesNotThrow(()=>JSON.stringify(packet));}
});
test('commands require the exact live session and control lease',()=>{
  const {send,engine,acquire,p,sim}=setup();assert.equal(send(engine()).reason,'lease_not_owned');acquire();
  assert.equal(send(engine({runtimeEpoch:'old'})).reason,'runtime_session_mismatch');assert.equal(sim.engines.engine_1,undefined);
  assert.equal(send(engine()).reason,'command_accepted');assert.equal(p.accepted,2);
});
test('sequence ordering is per operation stream, duplicates rejected',()=>{
  const {send,engine,acquire,command}=setup();acquire();assert.equal(send(engine()).reason,'command_accepted');
  assert.equal(send(engine()).reason,'stale_sequence');
  assert.equal(send(command('pylon_flight_control_command',{pitch:.1,yaw:0,roll:0,landingGear:false,timeoutSeconds:.3})).reason,'command_accepted');
});
test('expired lease and priority preemption clear commands',()=>{
  const {send,engine,acquire,p,sim,advance}=setup();acquire();send(engine());advance(1.01);p.expire();assert.equal(p.owner.state,0);assert.deepEqual(sim.engines,{});
  acquire({sequence:2});send(engine({sequence:2}));assert.equal(acquire({controllerId:'other',leaseId:'other'}).reason,'authority_held_by_higher_or_equal_priority');
  assert.equal(acquire({controllerId:'other',leaseId:'other',priority:11}).reason,'lease_acquired');assert.deepEqual(sim.engines,{});
});
test('emergency stop is latched, cleared only by its owner',()=>{
  const {send,command,acquire,engine,p,sim}=setup();acquire();send(engine());
  send(command('pylon_control_authority_command',{action:'emergency_stop',sequence:2}));assert.equal(p.owner.state,2);assert.deepEqual(sim.engines,{});
  assert.equal(acquire({sequence:3}).reason,'emergency_stop');
  assert.equal(send(command('pylon_control_authority_command',{action:'clear_emergency_stop',sequence:3,leaseId:'other'})).reason,'emergency_stop_owner_mismatch');
  send(command('pylon_control_authority_command',{action:'clear_emergency_stop',sequence:3}));assert.equal(p.owner.state,0);
});
test('batch is atomic and accepts the upstream JSON-string members',()=>{
  const {send,command,acquire,engine,sim}=setup();acquire();
  const batch=command('pylon_control_batch',{hasFlight:false,hasSeparation:false,renewLease:true,leaseDurationSeconds:2,suppressSas:true,engineJson:[JSON.stringify(engine()),JSON.stringify(engine({name:'invalid'}))]});
  assert.equal(send(batch).reason,'unknown_actuator');assert.deepEqual(sim.engines,{});
  batch.engineJson.pop();assert.equal(send(batch).reason,'command_accepted');assert.equal(sim.engines.engine_1.targetThrust,60000);
});
test('invalid JSON, numbers, ranges and unknown capabilities never mutate actuators',()=>{
  const {send,acquire,engine,p,sim}=setup();acquire();
  assert.equal(send(engine({targetThrust:-1})).reason,'invalid_thrust');assert.equal(send(engine({targetThrust:null})).reason,'invalid_thrust');
  assert.equal(send(engine({timeoutSeconds:0})).reason,'invalid_timeout');assert.equal(send(engine({sequence:1.5})).reason,'invalid_sequence');
  p.receive(Buffer.from('{broken'));assert.deepEqual(sim.engines,{});assert.equal(p.rejected,5);
});
test('lifecycle generation changes invalidate previous commands and leases',()=>{
  const {send,acquire,engine,p}=setup();acquire();const old=engine();p.newSession();assert.equal(send(old).reason,'runtime_session_mismatch');assert.equal(p.owner.state,0);
});
test('wrench-controlled engine state agrees with physical thrust and enabled status',()=>{
  const {send,command,acquire,p,sim}=setup();acquire();
  send(command('pylon_body_wrench_command',{frame:'base_link',force:[60000,0,0],torque:[0,0,0],timeoutSeconds:.5}));
  sim.step(1/120,0);const state=p.telemetry().find(p=>p.type==='pylon_actuator_state'&&p.name==='engine_1');
  assert.equal(state.enabled,true);assert.equal(state.commandActive,true);assert.ok(state.thrust>59000);
});
test('stationary launch pad has zero ground-truth acceleration in the rotating ENU frame',()=>{
  const {p,sim}=setup();sim.step();const truth=p.telemetry().find(p=>p.type==='pylon_ground_truth');
  assert.ok(Math.hypot(...truth.linearAcceleration)<1e-8);assert.ok(Math.hypot(...truth.angularVelocityBody)<1e-8);
});
