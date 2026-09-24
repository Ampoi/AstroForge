import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createWasmKernel} from '../server/physics-kernel.js';
import {javascriptKernel,atmosphere,orbitalElements,EARTH} from '../server/physics-reference.js';
import {Simulation,STEP} from '../server/physics.js';
import {starterCraft,twoStageCraft,massProperties} from '../shared/craft.js';
import {axisAngle,norm} from '../shared/math.js';

const wasm=createWasmKernel();
function near(actual,expected,absolute=1e-8,relative=1e-10){
  if(Array.isArray(expected)){assert.equal(actual.length,expected.length);expected.forEach((v,i)=>near(actual[i],v,absolute,relative));return;}
  if(expected&&typeof expected==='object'){for(const key of Object.keys(expected))near(actual[key],expected[key],absolute,relative);return;}
  assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=absolute+Math.abs(expected)*relative,`${actual} != ${expected}`);
}
function packed(sim){return [...sim.position,...sim.velocity,...sim.quaternion,...sim.omega];}

test('Zig atmosphere matches every layer boundary, taper and vacuum',()=>{
  const heights=[-100,0,11000,20000,32000,47000,51000,71000,84852].map(h=>EARTH.radius*h/(EARTH.radius-h));
  for(const h of [...heights,120000,149999,150000,400000])for(const delta of [-.001,0,.001])near(wasm.atmosphere(h+delta),atmosphere(h+delta));
});

test('Zig RK4 and aerodynamic forces match JS across attitudes, airspeeds and 80-part craft',()=>{
  let seed=0x128493;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(const count of [13,80]){
    const craft=starterCraft();
    while(craft.parts.length<count){const i=craft.parts.length;craft.parts.push({id:`fin_${i}`,type:'fin',parent:'tank_2',offset:random()-.5,angle:random()*Math.PI*2});}
    const sim=new Simulation(craft);
    for(let i=0;i<160;i++){
      sim.fuel=random()*2400;sim.mono=random()*32;sim.props=massProperties(craft,sim.tankFuel,sim.mono/sim.stats.mono);
      sim.position=[EARTH.radius+(i===0?400000:random()*150000),random()*1000,random()*1000];
      sim.velocity=i===1?[0,EARTH.spin*sim.position[0],0]:[random()*3000-500,random()*2000-500,random()*500-250];
      sim.quaternion=axisAngle([random(),random(),random()],random()*Math.PI*2);
      sim.omega=[random()-.5,random()-.5,random()-.5];
      const args=[sim,sim.position,sim.velocity,sim.quaternion,sim.omega];
      near(wasm.aerodynamic(...args),javascriptKernel.aerodynamic(...args),2e-6,2e-10);
      const a={force:[random()*60000,300,-200],torque:[40,-30,60]},state=packed(sim);
      near(wasm.integrate(sim,state,STEP,a),javascriptKernel.integrate(sim,state,STEP,a),1e-8,2e-11);
    }
  }
});

test('Zig launch, resource depletion, separation and debris track the JS trajectory',()=>{
  const bodies=[wasm,javascriptKernel].map(kernel=>new Simulation(twoStageCraft(),{kernel}));
  function compare(a,b){
    assert.equal(a.status,b.status);near(a.position,b.position,2e-4,0);near(a.velocity,b.velocity,2e-5,0);
    near(a.quaternion,b.quaternion,2e-7,0);near(a.omega,b.omega,2e-7,0);near(a.tankFuel,b.tankFuel);near(a.mono,b.mono);near(a.charge,b.charge);
    assert.equal(a.debris.length,b.debris.length);a.debris.forEach((d,i)=>compare(d,b.debris[i]));
  }
  for(let i=0;i<120*150;i++){
    for(const sim of bodies){
      if(i===0)sim.engines.engine_1={enabled:true,targetThrust:60000,expires:1000};
      if(i===120*65){sim.separate('separator_1');sim.engines.upper_engine={enabled:true,targetThrust:60000,expires:1000};}
      sim.step();
    }
    if(i%120===0)compare(...bodies);
  }
  compare(...bodies);assert.ok(bodies[0].maxAltitude>30000);assert.equal(bodies[0].fuel,0);
  assert.equal(bodies[0].debris[0].kernel,wasm);
});

test('production Zig integrator conserves vacuum orbital invariants for three revolutions',()=>{
  const sim=new Simulation(starterCraft(),{kernel:wasm}),r=EARTH.radius+400000;
  let state=[r,0,0,0,Math.sqrt(EARTH.mu/r),0,0,0,0,1,0,0,0];
  const initial=orbitalElements(state.slice(0,3),state.slice(3,6));
  for(let i=0;i<Math.round(initial.period*3/2);i++)state=wasm.integrate(sim,state,2,{force:[0,0,0],torque:[0,0,0]});
  const final=orbitalElements(state.slice(0,3),state.slice(3,6));
  near(final.energy,initial.energy,0,1e-9);near(final.angularMomentum,initial.angularMomentum,0,1e-9);
  assert.ok(Math.abs(norm(state.slice(0,3))-r)<.1);
});

test('Wasm scratch memory never leaks between vessels, reset or retained outputs',()=>{
  const a=new Simulation(starterCraft(),{kernel:wasm}),b=new Simulation(twoStageCraft(),{kernel:wasm});
  const first=wasm.integrate(a,packed(a),STEP,{force:[60000,0,0],torque:[0,0,0]}),saved=[...first];
  b.position[0]+=100000;b.step();b.reset(starterCraft());b.step();
  const aero=wasm.aerodynamic(a,a.position,a.velocity,a.quaternion,a.omega),copy=structuredClone(aero);
  wasm.atmosphere(30000);
  assert.deepEqual(first,saved);assert.deepEqual(aero,copy);
  assert.deepEqual(wasm.integrate(a,packed(a),STEP,{force:[60000,0,0],torque:[0,0,0]}),saved);
  a.status='flying';a.impactDamage(20);assert.ok(a.debris.length>0);assert.ok(a.debris.every(d=>d.kernel===wasm));
});

test('Wasm rejects oversized and invalid inputs; Simulation stops without committing a bad state',()=>{
  const bytes=readFileSync(new URL('../build/physics.wasm',import.meta.url)),module=new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  const raw=new WebAssembly.Instance(module).exports;
  assert.equal(raw.integrate(81),0);assert.equal(raw.evaluate_aero(0xffffffff),0);assert.equal(raw.evaluate_atmosphere(NaN),0);
  const sim=new Simulation(starterCraft(),{kernel:wasm});sim.status='flying';sim.velocity[0]=NaN;
  sim.engines.engine_1={enabled:true,targetThrust:60000,expires:1};const position=[...sim.position];
  sim.step();assert.equal(sim.status,'crashed');assert.deepEqual(sim.position,position);assert.deepEqual(sim.engines,{});
  assert.match(sim.events[0].text,/数値計算/);
  const state=packed(new Simulation(starterCraft()));state[3]=Number.MAX_VALUE;
  assert.ok(wasm.integrate(sim,state,STEP,{force:[0,0,0],torque:[0,0,0]}).every(Number.isNaN));
});

test('backend selection is explicit and defaults to Zig',()=>{
  for(const [selected,expected] of [['','zig-wasm'],['js','js'],['zig','zig-wasm']]){
    const child=spawnSync(process.execPath,['--input-type=module','-e',"import {physicsKernel} from './server/physics-kernel.js'; console.log(physicsKernel.name)"],{encoding:'utf8',env:{...process.env,ASTROFORGE_PHYSICS:selected}});
    assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),expected);
  }
  const invalid=spawnSync(process.execPath,['--input-type=module','-e',"import './server/physics-kernel.js'"],{encoding:'utf8',env:{...process.env,ASTROFORGE_PHYSICS:'typo'}});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/must be zig or js/);
});
