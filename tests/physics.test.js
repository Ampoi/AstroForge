import test from 'node:test';
import assert from 'node:assert/strict';
import {atmosphere,orbitalElements,gravity,rk4,EARTH,STEP,Simulation} from '../server/physics.ts';
import {starterCraft,massProperties,validateCraft,craftStats,PARTS} from '../shared/craft.ts';
import {norm,dot,mul,sub,rotate,axisAngle} from '../shared/math.ts';

test('standard atmosphere agrees with sea-level and 11 km reference values',()=>{
  assert.ok(Math.abs(atmosphere(0).density-1.225)<.001);
  const a=atmosphere(11000);assert.ok(Math.abs(a.pressure-22700)<150);assert.ok(Math.abs(a.temperature-216.77)<.1);
  let previous=Infinity;for(let h=0;h<=150000;h+=100){const a=atmosphere(h);assert.ok(a.density>=0&&a.density<=previous+1e-12);previous=a.density;}
  assert.equal(atmosphere(150000).density,0);
});
test('circular and eccentric orbit elements reproduce analytic apsides',()=>{
  const rp=EARTH.radius+200000,ra=EARTH.radius+1500000,a=(rp+ra)/2;
  const circular=orbitalElements([rp,0,0],[0,Math.sqrt(EARTH.mu/rp),0]);
  assert.ok(Math.abs(circular.apoapsis-200000)<1e-6);assert.ok(circular.eccentricity<1e-12);
  const eccentric=orbitalElements([rp,0,0],[0,Math.sqrt(EARTH.mu*(2/rp-1/a)),0]);
  assert.ok(Math.abs(eccentric.apoapsis-1500000)<1e-6);assert.ok(Math.abs(eccentric.periapsis-200000)<1e-6);
  assert.ok(Math.abs(eccentric.timeToApoapsis-eccentric.period/2)<1e-6);
  const escape=orbitalElements([rp,0,0],[0,Math.sqrt(3*EARTH.mu/rp),0]);assert.equal(escape.apoapsis,null);
});
test('RK4 vacuum orbit conserves energy and angular momentum for three revolutions',()=>{
  const r=EARTH.radius+200000;let state=[r,0,0,0,Math.sqrt(EARTH.mu/r),0];
  const initial=orbitalElements(state.slice(0,3),state.slice(3));const steps=Math.round(initial.period*3/2);
  for(let i=0;i<steps;i++)state=rk4(state,2,s=>[...s.slice(3),...gravity(s.slice(0,3))]);
  const final=orbitalElements(state.slice(0,3),state.slice(3));
  assert.ok(Math.abs((final.energy-initial.energy)/initial.energy)<1e-9);
  assert.ok(Math.abs((final.angularMomentum-initial.angularMomentum)/initial.angularMomentum)<1e-9);
  assert.ok(Math.abs(norm(state.slice(0,3))-r)<.1);
});
test('symmetry keeps the center of mass on-axis and off-axis additions change inertia',()=>{
  const craft=starterCraft(),p=massProperties(craft);assert.ok(Math.abs(p.com[1])+Math.abs(p.com[2])<1e-12);
  craft.parts.push({id:'test_fin',type:'fin',parent:'tank_1',offset:.2,angle:0});
  const asymmetric=massProperties(craft);assert.ok(asymmetric.com[1]>0);assert.ok(asymmetric.inertia[0]>p.inertia[0]);
  assert.ok(massProperties(craft,0).mass<asymmetric.mass);
});
test('craft rejects duplicate IDs, disconnected radial parts, and engine in the middle',()=>{
  const a=starterCraft();a.parts.push({...a.parts[0]});assert.throws(()=>validateCraft(a));
  const b=starterCraft();b.parts.at(-1).parent='missing';assert.throws(()=>validateCraft(b));
  const c=starterCraft();c.parts.push({id:'extra',type:'tank'});assert.throws(()=>validateCraft(c));
});
test('real-time sized steps launch the rocket and conserve propellant mass flow',()=>{
  const sim=new Simulation(starterCraft());sim.engines.engine_1={enabled:true,targetThrust:60000,expires:100,gimbalPitch:0,gimbalYaw:0};
  const fuel=sim.fuel;for(let i=0;i<1200;i++)sim.step();const s=sim.snapshot();
  assert.equal(s.status,'flying');assert.ok(s.altitude>400&&s.altitude<650);assert.ok(s.verticalSpeed>90);
  assert.ok(Math.abs((fuel-sim.fuel)-60000/(PARTS.engine.isp*9.80665)*10)<2);
  assert.ok(Math.abs(norm(sim.quaternion)-1)<1e-12);
});
test('engine command deadline cuts thrust independently of fuel',()=>{
  const sim=new Simulation(starterCraft());sim.engines.engine_1={enabled:true,targetThrust:60000,expires:.1,gimbalPitch:0,gimbalYaw:0};
  for(let i=0;i<60;i++)sim.step();assert.equal(sim.last.thrust,0);assert.ok(sim.fuel>2300);
});
test('fuel exhaustion never creates mass or thrust',()=>{
  const sim=new Simulation(starterCraft());sim.fuel=.01;sim.engines.engine_1={enabled:true,targetThrust:60000,expires:100,gimbalPitch:0,gimbalYaw:0};
  for(let i=0;i<20;i++)sim.step();assert.equal(sim.fuel,0);assert.equal(sim.last.thrust,0);
});
test('aerodynamics dissipates translation and tail fins oppose a sideslip',()=>{
  const sim=new Simulation(starterCraft()),r=[EARTH.radius+1000,0,0],spinVelocity=[0,EARTH.spin*r[0],0];
  const velocity=[100,spinVelocity[1]+8,0],a=sim.aerodynamic(r,velocity,[0,0,0,1],[0,0,0]);
  assert.ok(dot(a.force,sub(velocity,spinVelocity))<0);assert.ok(a.torque[2]>0);
});
test('RCS consumes monopropellant and generates bounded torque',()=>{
  const sim=new Simulation(starterCraft());sim.wrench={force:[0,0,500],torque:[80,0,0],expires:5};const mono=sim.mono;
  sim.step();assert.ok(sim.mono<mono);assert.ok(sim.lastActuation.force[2]>0);assert.ok(sim.lastActuation.force[2]<=500);assert.ok(sim.lastActuation.torque[0]>0);
});
test('landed and crashed craft stay fixed to the rotating surface with zero surface speed',()=>{
  const sim=new Simulation(starterCraft());sim.status='crashed';
  for(let i=0;i<120;i++)sim.step();assert.ok(sim.snapshot().speed<1e-8);assert.equal(sim.last.thrust,0);
});
