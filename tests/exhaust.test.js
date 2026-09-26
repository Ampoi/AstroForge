import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3, Quaternion, PerspectiveCamera} from 'three';
import {ExhaustFlow, ExhaustEffect, engineGimbal} from '../src/exhaust.ts';
import {plumeEnvelope} from '../src/exhaust-plume.ts';
import {makePart, RocketScene} from '../src/scene.ts';
import {Simulation} from '../server/physics.ts';
import {starterCraft} from '../shared/craft.ts';

const v=(x=0,y=0,z=0)=>new Vector3(x,y,z);
const frame=(overrides={})=>({origin:v(),airVelocity:v(),up:v(0,1,0),groundHeight:1000,density:1,
  emitters:[{position:v(),direction:v(0,-1,0),velocity:v(),throttle:1}],obstacles:[],...overrides});
function run(velocity,density=1,seconds=1){
  const flow=new ExhaustFlow(),f=frame({density});f.emitters[0].velocity.copy(velocity);flow.step(0,f);
  for(let n=1;n<=seconds*120;n++){f.origin.copy(velocity).multiplyScalar(n/120);flow.step(1/120,f);}
  return flow;
}

test('continuous gas is centered on each nozzle, follows gimbals, and switches off without stale instances',()=>{
  const effect=new ExhaustEffect(),f=frame(),camera=new PerspectiveCamera();
  f.emitters.push({position:v(3,2,1),direction:v(0,-1).applyQuaternion(engineGimbal(1,-1)),velocity:v(),throttle:.3});
  effect.update(1/60,f,camera);
  const plume=effect.mesh.getObjectByName('continuous-engine-plume'),geometry=plume.geometry;
  assert.equal(geometry.instanceCount,2);
  for(let i=0;i<2;i++){
    assert.ok(v().fromBufferAttribute(geometry.getAttribute('origin'),i).distanceTo(f.emitters[i].position)<1e-6);
    assert.ok(v().fromBufferAttribute(geometry.getAttribute('axis'),i).distanceTo(f.emitters[i].direction)<1e-6);
  }
  f.emitters[0].throttle=0;effect.update(0,f,camera);assert.equal(geometry.instanceCount,1);
  f.emitters=[];effect.update(0,f,camera);assert.equal(geometry.instanceCount,0);
  effect.clear();assert.equal(geometry.instanceCount,0);effect.dispose();
});
test('vacuum envelope expands and dilutes without atmospheric smoke or orbital-speed dependence',()=>{
  const air=plumeEnvelope(1,1),vacuum=plumeEnvelope(1,0),low=plumeEnvelope(.1,1);
  assert.equal(air.radius,vacuum.radius);assert.ok(vacuum.spread>air.spread);assert.ok(low.length<air.length);
  const effect=new ExhaustEffect(),f=frame({density:0}),camera=new PerspectiveCamera();
  f.emitters[0].velocity.set(0,0,7800);effect.update(1/60,f,camera);
  assert.equal(effect.mesh.geometry.instanceCount,0);assert.equal(effect.flow.particles.length,0);
  assert.equal(effect.mesh.getObjectByName('continuous-engine-plume').geometry.instanceCount,1);
  effect.update(-1,f,camera);assert.equal(effect.mesh.getObjectByName('continuous-engine-plume').geometry.instanceCount,0);
  effect.dispose();
});

test('nozzle and plume use the actual physics TVC axes and six-degree limit',()=>{
  const sim=new Simulation(starterCraft());
  for(const [pitch,yaw] of [[1,0],[0,1],[-1,0],[0,-1],[.7,-.8]]){
    sim.engines.engine_1={enabled:true,targetThrust:50000,expires:100,hasGimbalCommand:true,gimbalPitch:pitch,gimbalYaw:yaw};
    const act=sim.actuation(0,1/120),force=new Vector3(...act.force).normalize();
    const model=new Vector3(-force.y,force.x,force.z);
    const q=engineGimbal(pitch,yaw);
    assert.ok(v(0,1,0).applyQuaternion(q).distanceTo(model)<1e-12);
    const engine=makePart('engine'),nozzle=engine.getObjectByName('engine-gimbal');nozzle.quaternion.copy(q);
    const exit=nozzle.localToWorld(v(0,-.76,0)),pivot=nozzle.getWorldPosition(v());
    assert.ok(exit.sub(pivot).normalize().distanceTo(model.negate())<1e-12);
    assert.equal(engine.quaternion.angleTo(new Quaternion()),0);
  }
});
test('vacuum exhaust inherits vehicle velocity without an artificial orbital-speed crosswind',()=>{
  const stationary=run(v(),0),orbiting=run(v(0,0,7800),0);
  assert.equal(stationary.particles.length,orbiting.particles.length);
  stationary.particles.forEach((p,i)=>assert.ok(p.position.distanceTo(orbiting.particles[i].position)<1e-8));
});
test('air entrainment bends an old plume behind lateral motion; descent washes gas back up',()=>{
  const sideways=run(v(30,0,0));
  assert.ok(sideways.particles.filter(p=>p.age>.6).every(p=>p.position.x<-7));
  const descending=run(v(0,-22,0));
  assert.ok(descending.particles.some(p=>p.age>.7&&p.position.y>2));
  assert.ok(descending.particles.filter(p=>p.age<.04).every(p=>p.position.y<=.1));
});
test('ground impingement spreads the jet above the surface',()=>{
  const flow=new ExhaustFlow(),f=frame({groundHeight:1});flow.step(0,f);
  for(let n=0;n<120;n++)flow.step(1/120,f);
  assert.ok(flow.particles.every(p=>p.position.y>=-.941));
  assert.ok(flow.particles.some(p=>Math.hypot(p.position.x,p.position.z)>2));
});
test('hull collision keeps recirculating gas outside a capsule',()=>{
  const flow=new ExhaustFlow(),f=frame({obstacles:[{start:v(0,-4,0),end:v(0,-2,0),radius:.6}]});flow.step(0,f);
  for(let n=0;n<120;n++)flow.step(1/120,f);
  for(const p of flow.particles){const center=v(0,Math.max(-4,Math.min(-2,p.position.y)),0);assert.ok(p.position.distanceTo(center)>=.6);}
});
test('multiple engines emit at their own nozzles and cutoff leaves only a fading trail',()=>{
  const flow=new ExhaustFlow(100),f=frame();
  f.emitters.push({...f.emitters[0],position:v(5,0,0)});flow.step(0,f);flow.step(1/120,f);
  assert.ok(flow.particles.some(p=>p.position.x<1));assert.ok(flow.particles.some(p=>p.position.x>4));
  for(let n=0;n<120;n++)flow.step(1/120,f);assert.ok(flow.particles.length<=100);
  f.emitters=[];for(let n=0;n<240;n++)flow.step(1/120,f);assert.equal(flow.particles.length,0);
});
test('pause, time reset and long frame gaps never build up particles or giant streaks',()=>{
  const flow=new ExhaustFlow(),f=frame();flow.step(0,f);flow.step(.1,f);
  const positions=flow.particles.map(p=>p.position.toArray());flow.step(0,f);
  assert.deepEqual(flow.particles.map(p=>p.position.toArray()),positions);
  flow.step(-1,f);assert.equal(flow.particles.length,0);
  flow.step(.1,f);flow.step(10,f);assert.ok(flow.particles.length>0);
  assert.ok(flow.particles.every(p=>p.age<.07&&p.position.length()<10));
  // A 10x simulation at 30 FPS must still show a newly emitted jet.
  for(let i=0;i<10;i++)flow.step(1/3,f);assert.ok(flow.particles.length>0);
});
test('flow is stable across 30 and 120 Hz rendering',()=>{
  const a=new ExhaustFlow(),b=new ExhaustFlow(),f=frame();a.step(0,f);b.step(0,f);
  for(let i=0;i<30;i++)a.step(1/30,f);for(let i=0;i<120;i++)b.step(1/120,f);
  assert.equal(a.particles.length,b.particles.length);
  a.particles.forEach((p,i)=>assert.ok(p.position.distanceTo(b.particles[i].position)<1e-9));
});

test('scene integration transforms each nozzle into inertial space and resets on vessel switch',()=>{
  const sim=new Simulation(starterCraft());sim.engines.engine_1={enabled:true,targetThrust:50000,expires:100,hasGimbalCommand:true,gimbalPitch:1,gimbalYaw:-1};sim.step();
  const f=sim.snapshot(),rocket=makePart('engine'),g=makePart('engine');rocket.clear();rocket.add(g);
  g.position.set(2,3,-1);rocket.position.set(1,-2,4);rocket.quaternion.setFromAxisAngle(v(1,0,0),.4);
  let output,clears=0;
  const target={parts:[{id:'engine_1',type:'engine'}],groups:new Map([['engine_1',g]]),stats:{height:8},camera:{},exhaustTime:null,exhaustVessel:null,
    exhaust:{mesh:makePart('engine'),clear(){clears++},update(dt,frame){output={dt,frame}}}};
  const basis=new Quaternion().setFromAxisAngle(v(0,0,1),.6);
  RocketScene.prototype.updateExhaust.call(target,f,basis);
  assert.equal(output.frame.emitters.length,1);assert.equal(clears,1);
  const emitter=output.frame.emitters[0],nozzle=g.getObjectByName('engine-gimbal');
  const world=emitter.position.clone().applyQuaternion(basis).add(v(0,4,0));
  assert.ok(world.distanceTo(nozzle.localToWorld(v(0,-.76,0)))<1e-10);
  assert.ok(emitter.direction.clone().applyQuaternion(basis).distanceTo(v(0,-1,0).applyQuaternion(nozzle.getWorldQuaternion(new Quaternion())))<1e-10);
  RocketScene.prototype.updateExhaust.call(target,{...f,time:f.time+.01},basis);assert.equal(clears,1);assert.ok(Math.abs(output.dt-.01)<1e-10);
  RocketScene.prototype.updateExhaust.call(target,{...f,id:'another'},basis);assert.equal(clears,2);assert.equal(output.dt,0);
  RocketScene.prototype.updateExhaust.call(target,{...f,status:'destroyed'},basis);assert.equal(output.frame.emitters.length,0);
});
