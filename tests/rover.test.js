import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,EARTH} from '../server/physics.ts';
import {FlightWorld} from '../server/world.ts';
import {javascriptKernel} from '../server/physics-reference.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {roverCraft,validateCraft,launchIssues,layoutCraft,WHEEL} from '../shared/craft.ts';
import {toAssembly,assembledCraft,resolveAssemblyPlacement,placeAssembly} from '../shared/assembly.ts';
import {norm,sub,cross,rotate,qconj} from '../shared/math.ts';

function advance(sim,seconds){for(let i=0;i<Math.round(seconds*120);i++)sim.step();}
function drive(sim,{motor=0,steering=0,brake=0,expires=1000}={}){
  for(const p of sim.craft.parts.filter(p=>p.type==='wheel'))sim.wheels[p.id]={enabled:true,targetAngularVelocity:motor*50,steeringAngle:p.offset>0?steering*.55:0,maxDriveTorque:405,brake,expires};
}
const settled=(kernel)=>{const s=new Simulation(roverCraft(),kernel?{kernel}:{});advance(s,4);return s;};

test('rover parts assemble, round-trip, and launch without rocket engines or fuel',()=>{
  const craft=validateCraft(roverCraft());assert.deepEqual(launchIssues(craft),[]);
  assert.deepEqual(assembledCraft(toAssembly(craft)),craft);
  const assembly=toAssembly(craft),chassis=assembly.parts.find(p=>p.type==='chassis');
  const hit={id:chassis.id,point:[chassis.position[0],.9,0],normal:[0,1,0]};
  const placement=resolveAssemblyPlacement(assembly,'wheel',hit,{snap:false});
  assert.equal(placement.kind,'surface');assert.equal(placement.position[1],.9);
  const placed=placeAssembly(assembly,'wheel',placement,{count:2,mirror:true});
  assert.equal(placed.parts.filter(p=>p.type==='wheel').length,6);
  for(const w of layoutCraft(assembledCraft(placed)).filter(p=>p.type==='wheel'))assert.ok(Math.abs(Math.abs(w.position[1])-.9)<1e-9);
  const paired=placeAssembly(assembly,'wheel',placement,{count:4});
  assert.equal(paired.parts.length,assembly.parts.length+2);assert.doesNotThrow(()=>validateCraft(assembledCraft(paired)));
  const invalid=roverCraft();invalid.parts.at(-1).angle=Math.PI/2;assert.throws(()=>validateCraft(invalid),/タイヤ/);
});

test('spring contacts support vehicle weight and damp a real drop over multiple oscillations',()=>{
  const s=settled(),weight=s.props.mass*(EARTH.mu/norm(s.position)**2-EARTH.spin**2*norm(s.position));
  assert.ok(s.snapshot().speed<.02);assert.ok(s.wheelStates.every(w=>w.grounded&&w.compression>0&&w.compression<WHEEL.travel));
  assert.ok(Math.abs(s.wheelStates.reduce((n,w)=>n+w.normalForce,0)-weight)/weight<.02);
  s.position[0]+=.25;
  const samples=[];for(let i=0;i<720;i++){s.step();samples.push(s.snapshot().verticalSpeed);}
  const crossings=samples.slice(1).filter((v,i)=>v*samples[i]<0&&Math.abs(v-samples[i])>.0001).length;
  assert.ok(Math.min(...samples)<-1);assert.ok(Math.max(...samples)>.2);assert.ok(crossings>=4,`oscillations ${crossings}`);
  assert.ok(Math.max(...samples.slice(-120).map(Math.abs))<.03);assert.equal(s.status,'flying');
});

test('drive, hard braking, suspension load transfer, and reverse remain dynamic',()=>{
  const s=settled(),charge=s.charge;drive(s,{motor:.5});advance(s,8);
  assert.ok(s.snapshot().speed>8);assert.ok(s.charge<charge);
  drive(s,{brake:1});const pitch=[],rear=[];
  for(let i=0;i<600;i++){s.step();pitch.push(s.snapshot().upBody[0]);rear.push(s.wheelStates[0].compression);}
  assert.ok(Math.min(...pitch)<-.12,'hard braking pitches the body');
  assert.equal(Math.min(...rear),0,'rear suspension reaches full extension');
  assert.ok(s.snapshot().speed<.05);assert.equal(s.status,'flying');
  drive(s,{motor:-.3});advance(s,3);assert.ok(s.snapshot().surfaceVelocityBody[0]<-2);
});

test('front-wheel steering creates yaw and different left/right spring loads',()=>{
  const s=settled();drive(s,{motor:.2,steering:.4});advance(s,8);
  assert.ok(Math.abs(s.omega[2])>.15);assert.ok(Math.abs(s.snapshot().upBody[1])>.005);
  assert.ok(Math.abs(s.wheelStates[0].compression-s.wheelStates[1].compression)>.01);
});

test('airborne wheels cannot propel the vehicle; power loss and stale commands brake',()=>{
  const a=settled(),b=settled();a.position[0]+=20;b.position[0]+=20;
  drive(a,{motor:1});drive(b);advance(a,.3);advance(b,.3);
  assert.ok(a.wheelStates.every(w=>!w.grounded&&w.motorForce===0));
  assert.ok(norm(sub(a.velocity,b.velocity))<1e-8);
  for(const powerLoss of [true,false]){
    const s=settled();drive(s,{motor:.4});advance(s,4);
    if(powerLoss)s.charge=0;else for(const c of Object.values(s.wheels))c.expires=s.time;
    advance(s,5);assert.ok(s.snapshot().speed<.05);assert.ok(s.wheelStates.every(w=>w.motorForce===0));
  }
});

test('rover contact agrees across kernels and time warp retains the horizontal spawn attitude',()=>{
  const a=settled(),b=settled(javascriptKernel);drive(a,{motor:.3});drive(b,{motor:.3});advance(a,3);advance(b,3);
  assert.ok(norm(sub(a.position,b.position))<.005);assert.ok(norm(sub(a.omega,b.omega))<.005);
  const world=new FlightWorld(roverCraft());world.time=123;world.vehicles=[];const s=world.add(roverCraft());
  assert.ok(s.snapshot().upBody[2]>.99999);
  world.setTimeScale(10);world.advance(.2,0);assert.ok(Math.abs(s.time-125)<1e-8);assert.ok(s.snapshot().upBody[2]>.99);
});

test('wheel UDP commands are named, validated, sequenced and revoked with their lease',()=>{
  const s=settled();let now=0;const protocol=new PylonProtocol(s,()=>now);protocol.available=true;
  const send=(fields)=>protocol.receive(Buffer.from(JSON.stringify({...protocol.fields(),controllerId:'rover-test',leaseId:'lease',sequence:1,...fields})));
  const command={type:'pylon_actuator_command',actuatorType:'wheel',name:'wheel_front_left',enabled:true,targetAngularVelocity:12,steeringAngle:.2,maxDriveTorque:405,brake:0,timeoutSeconds:.5};
  assert.equal(send(command).reason,'lease_not_owned');
  send({type:'pylon_control_authority_command',action:'acquire',priority:1,leaseDurationSeconds:1,suppressSas:false});
  assert.equal(send({...command,targetAngularVelocity:null}).reason,'invalid_wheel_input');
  assert.equal(send({...command,name:'missing'}).reason,'unknown_actuator');
  assert.equal(send(command).reason,'command_accepted');assert.equal(send(command).reason,'stale_sequence');
  s.step(1/120,now);
  const packets=protocol.telemetry(),manifest=packets.find(p=>p.type==='pylon_actuator_manifest');
  assert.equal(manifest.actuators.filter(p=>p.actuatorType==='wheel').length,4);
  const state=packets.find(p=>p.type==='pylon_actuator_state'&&p.name===command.name);assert.equal(state.enabled,true);assert.ok(state.radius>0);assert.equal(state.wheelCount,4);
  s.charge=0;const powerless=protocol.telemetry().find(p=>p.type==='pylon_actuator_state'&&p.name===command.name);
  assert.equal(powerless.enabled,false);assert.equal(powerless.commandActive,true);
  now=2;protocol.expire();assert.deepEqual(s.wheels,{});
});


test('PyLoN wheel velocity servo tracks radians per second and limits torque',()=>{
  const s=settled();
  for(const p of s.craft.parts.filter(p=>p.type==='wheel'))s.wheels[p.id]={enabled:true,targetAngularVelocity:8,steeringAngle:0,maxDriveTorque:90,brake:0,expires:100};
  let peak=0;
  for(let i=0;i<2400;i++){s.step();peak=Math.max(peak,...s.wheelStates.map(w=>Math.abs(w.driveTorque)));}
  assert.ok(peak<=90+1e-9,`torque ${peak}`);
  assert.ok(Math.abs(s.snapshot().surfaceVelocityBody[0]/WHEEL.radius-8)<2,'tracks wheel speed with rolling resistance');
  for(const c of Object.values(s.wheels)){c.enabled=false;c.brake=0;}
  const speed=s.snapshot().speed;advance(s,.5);
  assert.ok(s.snapshot().speed>speed*.8,'disabled motor with zero brake coasts');
  for(const c of Object.values(s.wheels))c.brake=1;
  advance(s,4);assert.ok(s.snapshot().speed<.05,'disabled motor can still brake');
});

test('wheel protocol rejects legacy controls and malformed SI inputs without consuming sequence',()=>{
  const s=settled(),p=new PylonProtocol(s,()=>0);p.available=true;
  const send=fields=>p.receive(Buffer.from(JSON.stringify({...p.fields(),controllerId:'c',leaseId:'l',sequence:1,...fields})));
  send({type:'pylon_control_authority_command',action:'acquire',priority:1,leaseDurationSeconds:1,suppressSas:false});
  const cmd={type:'pylon_actuator_command',actuatorType:'wheel',name:'wheel_front_left',enabled:true,targetAngularVelocity:8,steeringAngle:.1,maxDriveTorque:90,timeoutSeconds:.5};
  for(const patch of [{targetAngularVelocity:null},{steeringAngle:'0'},{maxDriveTorque:null},{brake:2},{motor:.5},{steering:.5}])assert.equal(send({...cmd,...patch}).reason,'invalid_wheel_input');
  assert.equal(send(cmd).reason,'command_accepted');assert.equal(s.wheels[cmd.name].brake,0);
  s.step(1/120,0);
  const state=p.telemetry().find(v=>v.type==='pylon_actuator_state'&&v.name===cmd.name);
  for(const key of ['angularPosition','angularVelocity','steeringAngle','driveTorque','brakeTorque','slip','maxDriveTorque','radius','rollingSign','steeringSign','maxSteeringAngle'])assert.ok(Number.isFinite(state[key]),key);
  assert.ok(state.bodyMin.every((v,i)=>v<state.bodyMax[i]));assert.equal(state.steeringAngle,.1);
  for(const key of ['motor','steering','rotation','speed','motorForce'])assert.ok(!(key in state),`no legacy ${key}`);
});
