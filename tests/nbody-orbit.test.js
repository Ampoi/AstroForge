import test from 'node:test';
import assert from 'node:assert/strict';
import {predictNBodyOrbit,nbodyGravity,thirdBodyGravity,EARTH_MU,MOON_MU} from '../shared/nbody-orbit.ts';
import {EARTH_RADIUS,MOON_RADIUS,MOON_DISTANCE,moonRelativePosition,MOON_MONTH} from '../shared/solar-system.ts';
import {add,sub,mul,norm,unit,cross} from '../shared/math.ts';
const distance=(a,b)=>norm(sub(a,b));
const end=result=>result.samples.at(-1).position;

test('third-body forces cancel at Earth and include simultaneous lunar/solar tides',()=>{
  assert.deepEqual(thirdBodyGravity([0,0,0],0),[0,0,0]);
  const moon=moonRelativePosition(0),position=add(moon,mul(unit(moon),-MOON_RADIUS-100000));
  const acceleration=nbodyGravity(position,0);
  assert.ok(norm(acceleration)>1,'strong lunar attraction outside its surface');
  assert.ok(norm(thirdBodyGravity([EARTH_RADIUS+400000,0,0],0))>1e-8);
  assert.ok(distance(nbodyGravity(position,0),nbodyGravity(position,MOON_MONTH/4))>.5,'moving Moon changes gravity');
});

test('numerical integrator converges to the analytic circular two-body orbit',()=>{
  const radius=EARTH_RADIUS+400000,period=2*Math.PI*Math.sqrt(radius**3/EARTH_MU),p=[radius,0,0],v=[0,Math.sqrt(EARTH_MU/radius),0];
  const coarse=predictNBodyOrbit(p,v,0,{duration:period,tolerance:2,thirdBodies:false});
  const fine=predictNBodyOrbit(p,v,0,{duration:period,tolerance:.0001,thirdBodies:false});
  assert.equal(coarse.end,'duration');assert.equal(fine.end,'duration');
  assert.ok(distance(end(fine),p)<1);
  assert.ok(distance(end(fine),p)<distance(end(coarse),p));
  assert.ok(coarse.steps<1000);
});

test('lunar flyby is continuous and converges against a fine-step three-body reference',()=>{
  const moon=moonRelativePosition(0),radial=unit(moon),tangent=unit(cross([0,0,1],radial));
  const p=add(moon,mul(radial,MOON_RADIUS+300000));
  const moonVelocity=mul(sub(moonRelativePosition(1),moonRelativePosition(-1)),.5);
  const v=add(moonVelocity,mul(tangent,Math.sqrt(MOON_MU/(MOON_RADIUS+300000))));
  const options={duration:1800,tolerance:.05};
  const result=predictNBodyOrbit(p,v,0,options);
  const reference=predictNBodyOrbit(p,v,0,{...options,tolerance:.00001,maxStep:1,maxSteps:10000});
  const earthOnly=predictNBodyOrbit(p,v,0,{...options,thirdBodies:false});
  assert.equal(result.end,'duration');assert.equal(reference.end,'duration');
  assert.ok(distance(end(result),end(reference))<5);
  assert.ok(distance(end(result),end(earthOnly))>100000,'Moon bends the path without a sphere-of-influence switch');
});

test('predictions stop on Earth and Moon surfaces and expose truncation/invalid input',()=>{
  const earth=predictNBodyOrbit([EARTH_RADIUS+10000,0,0],[-1000,0,0],0);
  assert.equal(earth.end,'impact');assert.equal(earth.impact,'earth');assert.ok(Math.abs(norm(end(earth))-EARTH_RADIUS)<1);
  const moon=moonRelativePosition(0),p=mul(unit(moon),MOON_DISTANCE-MOON_RADIUS-10000),v=mul(unit(moon),1000);
  const lunar=predictNBodyOrbit(p,v,0,{duration:300});
  assert.equal(lunar.end,'impact');assert.equal(lunar.impact,'moon');
  assert.ok(Math.abs(distance(end(lunar),moonRelativePosition(lunar.samples.at(-1).time))-MOON_RADIUS)<10);
  assert.equal(predictNBodyOrbit([NaN,0,0],[0,0,0],0).end,'invalid');
  assert.equal(predictNBodyOrbit([EARTH_RADIUS+400000,0,0],[0,7800,0],0,{maxSteps:1}).end,'budget');
});

test('live fixed-step flight and map prediction agree near the Moon',async()=>{
  const {Simulation,STEP}=await import('../server/physics.ts');
  const {starterCraft}=await import('../shared/craft.ts');
  const sim=new Simulation(starterCraft()),moon=moonRelativePosition(0),radial=unit(moon);
  sim.status='flying';sim.position=add(moon,mul(radial,MOON_RADIUS+300000));
  sim.velocity=add(mul(sub(moonRelativePosition(1),moonRelativePosition(-1)),.5),mul(unit(cross([0,0,1],radial)),1500));
  const expected=predictNBodyOrbit(sim.position,sim.velocity,0,{duration:60,tolerance:.0001,maxStep:1});
  for(let i=0;i<Math.round(60/STEP);i++)sim.step(STEP,i*STEP);
  assert.equal(sim.status,'flying');assert.ok(distance(sim.position,end(expected))<.1);
});
