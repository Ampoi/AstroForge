import test from 'node:test';
import assert from 'node:assert/strict';
import {starterCraft,massProperties,layoutCraft,validateCraft,PARTS} from '../shared/craft.ts';
import {Simulation,EARTH} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {add,sub,mul,norm,cross,rotate,axisAngle,matVec} from '../shared/math.ts';

function twoStage(){const craft=starterCraft();craft.parts.splice(3,0,{id:'upper_engine',type:'engine'},{id:'separator',type:'decoupler'});return validateCraft(craft);}
function setup(){
  const sim=new Simulation(twoStage());sim.status='flying';sim.position=[EARTH.radius+10000,0,0];
  const protocol=new PylonProtocol(sim,()=>0);protocol.available=true;
  const packet=(type,fields={})=>({type,...protocol.fields(),controllerId:'test',leaseId:'lease',sequence:1,...fields});
  const send=p=>protocol.receive(Buffer.from(JSON.stringify(p)));
  const acquire=()=>send(packet('pylon_control_authority_command',{action:'acquire',priority:1,leaseDurationSeconds:2,suppressSas:true}));
  const separation=(fields={})=>packet('pylon_actuator_command',{actuatorType:'separation',name:'separator',separate:true,...fields});
  return {sim,protocol,packet,send,acquire,separation};
}
const near=(a,b,tolerance=1e-6)=>assert.ok(norm(sub(a,b))<tolerance,`${a} != ${b}`);
test('only the exposed engine burns, using its own stage fuel',()=>{
  const {sim}=setup();
  for(const id of ['upper_engine','engine_1'])sim.engines[id]={enabled:true,targetThrust:60000,expires:100};
  sim.step();assert.equal(sim.tankFuel.tank_1,PARTS.tank.fuel);assert.ok(sim.tankFuel.tank_2<PARTS.tank.fuel);
  assert.equal(sim.lastActuation.engineResults.find(e=>e.id==='upper_engine').thrust,0);
  sim.tankFuel.tank_2=0;sim.step();assert.equal(sim.last.thrust,0);assert.equal(sim.fuel,1200);
  sim.separate('separator');sim.engines.upper_engine={enabled:true,targetThrust:60000,expires:100};sim.step();assert.ok(sim.last.thrust>59000);assert.ok(sim.tankFuel.tank_1<1200);
});
test('separation conserves mass, resources, world-space geometry, linear and angular momentum',()=>{
  const {sim}=setup();sim.tankFuel.tank_2=417;sim.mono=13;sim.charge=600;
  sim.quaternion=axisAngle([0,0,1],.8);sim.omega=[.12,.2,-.15];sim.velocity=[300,250,9];
  const oldProps=massProperties(sim.craft,sim.tankFuel,sim.mono/sim.stats.mono),oldPosition=[...sim.position],oldVelocity=[...sim.velocity],q=[...sim.quaternion],omega=[...sim.omega];
  const geometry=new Map(layoutCraft(sim.craft).map(p=>[p.id,add(oldPosition,rotate(q,sub(p.position,oldProps.com)))]));
  sim.separate('separator');const debris=sim.debris[0];
  assert.equal(sim.props.mass+debris.props.mass,oldProps.mass);assert.equal(sim.fuel+debris.fuel,1617);assert.equal(sim.mono+debris.mono,13);assert.equal(sim.charge+debris.charge,600);
  near(add(mul(sim.velocity,sim.props.mass),mul(debris.velocity,debris.props.mass)),mul(oldVelocity,oldProps.mass));
  let angular=[0,0,0];
  for(const body of [sim,debris]){
    angular=add(angular,add(rotate(q,matVec(body.props.inertia,body.omega)),cross(sub(body.position,oldPosition),mul(sub(body.velocity,oldVelocity),body.props.mass))));
    for(const p of layoutCraft(body.craft))near(add(body.position,rotate(q,sub(p.position,body.props.com))),geometry.get(p.id));
  }
  near(angular,rotate(q,matVec(oldProps.inertia,omega)),1e-5);
  assert.ok(!sim.craft.parts.some(p=>p.id==='tank_2'||p.parent==='tank_2'));assert.ok(debris.craft.parts.some(p=>p.type==='fin'));
  for(let i=0;i<120;i++)sim.step();assert.ok(norm(sub(sim.position,debris.position))>1);assert.ok(sim.snapshot().debris.length===1);
});
test('pad separation is rejected and reset restores the original vehicle',()=>{
  const craft=twoStage(),sim=new Simulation(craft);assert.throws(()=>sim.separate('separator'),/requires_flight/);
  sim.status='flying';sim.separate('separator');assert.throws(()=>sim.separate('separator'),/unavailable/);sim.reset(craft);
  assert.equal(sim.debris.length,0);assert.equal(sim.separations.length,0);assert.equal(sim.craft.parts.length,craft.parts.length);assert.equal(sim.fuel,2400);
});
test('separation requires authority and is advertised through the upstream actuator schema',()=>{
  const {sim,protocol,send,acquire,separation}=setup();
  assert.equal(send(separation()).reason,'lease_not_owned');assert.equal(sim.debris.length,0);
  acquire();assert.ok(protocol.telemetry().find(p=>p.actuatorType==='separation'&&p.available));
  assert.equal(send(separation({separate:'yes'})).reason,'invalid_separation');
  assert.equal(send(separation()).reason,'command_accepted');assert.equal(sim.debris.length,1);
  assert.equal(send(separation({sequence:2})).reason,'unknown_actuator');assert.equal(sim.debris.length,1);
  const packets=protocol.telemetry();assert.ok(packets.find(p=>p.actuatorType==='separation'&&p.separated&&!p.available));
  assert.ok(!packets.find(p=>p.type==='pylon_actuator_manifest').actuators.some(p=>p.name==='engine_1'));
});
test('atomic batch rejects an invalid member before separation and supports upper-stage ignition',()=>{
  const {sim,send,acquire,packet,separation}=setup();acquire();
  const engine=name=>packet('pylon_actuator_command',{actuatorType:'engine',name,enabled:true,targetThrust:60000,timeoutSeconds:.4});
  const batch=packet('pylon_control_batch',{hasFlight:false,hasSeparation:true,renewLease:false,separationJson:JSON.stringify(separation()),engineJson:[JSON.stringify(engine('engine_1'))]});
  assert.equal(send(batch).reason,'batch_targets_detached_part');assert.equal(sim.debris.length,0);
  batch.engineJson=[JSON.stringify({...engine('upper_engine'),targetThrust:-1})];assert.equal(send(batch).reason,'invalid_thrust');assert.equal(sim.debris.length,0);
  batch.engineJson=[JSON.stringify(engine('upper_engine'))];assert.equal(send(batch).reason,'command_accepted');assert.equal(sim.debris.length,1);
  sim.step();assert.ok(sim.last.thrust>59000);
});
