import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3, PerspectiveCamera, Mesh, Box3} from 'three';
import {starterCraft, twoStageCraft, roverCraft, massProperties} from '../shared/craft.ts';
import {prepareMassModel} from '../shared/mass-model.ts';
import {WasmExhaustFlow} from '../src/exhaust-kernel.ts';
import {ExhaustFlow, ExhaustEffect} from '../src/exhaust.ts';
import {makePart} from '../src/scene.ts';
import {FlightWorld} from '../server/world.ts';
import {StateStreamEncoder, StateStreamDecoder} from '../shared/state-stream.ts';
const module=new WebAssembly.Module(readFileSync(new URL('../build/exhaust.wasm',import.meta.url)));
const v=(x=0,y=0,z=0)=>new Vector3(x,y,z);
function frame(){return {origin:v(),airVelocity:v(3,0,0),up:v(0,1,0),groundHeight:2,density:1,
  emitters:[{position:v(),direction:v(0,-1,0),velocity:v(),throttle:1}],
  obstacles:[{start:v(0,-1,0),end:v(0,-.5,0),radius:.3,velocity:v(1,0,0)}]};}
function near(a,b,tolerance=1e-8){assert.ok(Math.abs(a-b)<=tolerance+Math.abs(b)*1e-11,`${a} != ${b}`);}

test('prepared mass moments match direct summation with asymmetric fuel and mono depletion',()=>{
  for(const craft of [starterCraft(),twoStageCraft(),roverCraft()]){
    while(craft.parts.length<80)craft.parts.push({id:`extra_${craft.parts.length}`,type:'rcs',parent:craft.parts[0].id,angle:craft.parts.length*.7,offset:.3});
    const model=prepareMassModel(craft);let parts;
    for(let i=0;i<30;i++){
      const fuel=Object.fromEntries(craft.parts.filter(p=>p.type==='tank').map((p,j)=>[p.id,(i*31+j*101)%1201]));
      const actual=model.update(fuel,i/30),expected=massProperties(craft,fuel,i/30);
      near(actual.mass,expected.mass);
      for(const key of ['com','inertia','inverseInertia'])actual[key].forEach((n,j)=>near(n,expected[key][j]));
      actual.parts.forEach((p,j)=>near(p.mass,expected.parts[j].mass));
      if(parts)assert.equal(parts,actual.parts);parts=actual.parts;
    }
  }
});
test('Wasm exhaust matches the reference for ground/hull contacts, moving origins, vacuum, pause and warp',()=>{
  for(const density of [0,.2,1])for(const dt of [1/120,1/30]){
    const js=new ExhaustFlow(300),wasm=new WasmExhaustFlow(module,300),f=frame();f.density=density;
    f.emitters.push({...f.emitters[0],position:v(3,0,0),throttle:.4});
    for(let i=0;i<150;i++){
      f.origin.x+=dt*3;
      if(i===90)f.emitters=[];
      const delta=i===50?0:i===70?1:i===80?-1:dt;
      js.step(delta,f);wasm.step(delta,f);
      const a=wasm.particles;assert.equal(a.length,js.particles.length);
      a.forEach((p,j)=>{
        for(const key of ['age','life','size','seed'])near(p[key],js.particles[j][key]);
        for(const key of ['position','velocity'])for(const axis of ['x','y','z'])near(p[key][axis],js.particles[j][key][axis],2e-7);
      });
    }
  }
});
test('Wasm exhaust bounds inputs and owns independent particle arenas',()=>{
  const a=new WasmExhaustFlow(module),b=new WasmExhaustFlow(module),f=frame();a.step(.1,f);
  const saved=a.data.slice();b.step(.2,f);b.clear();assert.deepEqual(a.data,saved);
  a.step(NaN,f);assert.equal(a.count,0);
  assert.throws(()=>new WasmExhaustFlow(module,2401),RangeError);
  assert.throws(()=>a.step(.1,{...f,obstacles:Array(81).fill(f.obstacles[0])}),RangeError);
  const raw=new WebAssembly.Instance(module).exports;
  assert.equal(raw.step(81,0,2400),0);assert.equal(raw.step(0,81,2400),0);
});
test('render sorting preserves simulation order and uploads only live particles for both backends',()=>{
  for(const flow of [new ExhaustFlow(),new WasmExhaustFlow(module)]){
    const effect=new ExhaustEffect();effect.flow=flow;const f=frame(),camera=new PerspectiveCamera();
    flow.step(.1,f);const saved=flow.particles.map(p=>p.position.toArray());
    effect.update(0,f,camera);assert.deepEqual(flow.particles.map(p=>p.position.toArray()),saved);
    assert.equal(effect.mesh.geometry.instanceCount,saved.length);
    const offsets=effect.mesh.geometry.getAttribute('offset');
    assert.deepEqual(offsets.updateRanges,[{start:0,count:saved.length*3}]);
    for(let i=1;i<saved.length;i++)assert.ok(offsets.getZ(i)>=offsets.getZ(i-1));
    effect.clear();assert.equal(effect.mesh.geometry.instanceCount,0);effect.dispose();
  }
});
function app(world,library){
  const cache=new Map(),sim=world.active;
  return {mode:'flight',craft:sim.craft,draft:library[0].craft,library,activeVehicleId:sim.id,
    vehicles:world.snapshots(cache).map(v=>({...v,udp:{}})),timeScale:1,simulationTime:world.time,utc:'now',
    flight:sim.snapshot(cache),trail:[],connection:{}};
}
const parse = event=>JSON.parse(event.split('data: ')[1].trim());
test('compact stream round trips separation/removal and configuration changes, including reconnect',()=>{
  const world=new FlightWorld(twoStageCraft()),library=[{id:'design',craft:starterCraft()}];
  const encoder=new StateStreamEncoder(),decoder=new StateStreamDecoder();let revision;
  for(let i=0;i<5;i++){
    if(i===2){world.active.status='flying';world.active.separate('separator_1');}
    if(i===3)world.active.debris=[];
    if(i===4)library.push({id:'new',craft:roverCraft()});
    const state=app(world,library.slice()),message=encoder.encode(state);
    decoder.configuration=parse(message.configuration);
    assert.deepEqual(decoder.decode(parse(message.frame)),JSON.parse(JSON.stringify(state)));
    if(i===1)assert.equal(message.revision,revision);
    if(i>1)assert.ok(message.revision>revision);
    revision=message.revision;
    const reconnect=new StateStreamDecoder();reconnect.configuration=parse(message.configuration);
    assert.deepEqual(reconnect.decode(parse(message.frame)),decoder.decode(parse(message.frame)));
  }
  assert.throws(()=>new StateStreamDecoder().decode(parse(encoder.encode(app(world,library)).frame)),/configuration mismatch/);
});
test('one state collection computes each body snapshot only once and does not retain stale snapshots',()=>{
  const world=new FlightWorld(twoStageCraft());world.active.status='flying';world.active.separate('separator_1');
  const cache=new Map();const snapshots=world.snapshots(cache);
  assert.equal(cache.size,2);assert.equal(world.active.snapshot(cache).debris[0],world.active.debris[0].snapshot(cache));
  const old=world.active.snapshot(cache);world.step();assert.notEqual(world.active.snapshot(new Map()),old);
  assert.equal(snapshots.length,2);
});
test('static mesh merging reduces draw submissions and preserves animated pivots and bounds',()=>{
  const battery=makePart('battery');let count=0;battery.traverse(o=>{if(o instanceof Mesh)count++;});
  assert.equal(count,4); // shell, rings, two indicator materials (formerly 15).
  const engine=makePart('engine');assert.ok(engine.getObjectByName('engine-gimbal'));
  const wheel=makePart('wheel');for(const name of ['suspension','steering','tire','spring'])assert.ok(wheel.getObjectByName(name));
  const bounds=new Box3().setFromObject(battery);near(bounds.min.y,-.16);near(bounds.max.y,.16);
});

test('merged geometry retains bounds and triangle counts for every animated or fixed part',()=>{
  for(const type of ['pod','battery','engine','decoupler','fin','rcs','chassis','wheel']){
    const before=makePart(type,false),after=makePart(type);
    function triangles(root){let count=0;root.traverse(o=>{if(o instanceof Mesh)count+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;});return count;}
    assert.equal(triangles(after),triangles(before));
    const a=new Box3().setFromObject(after),b=new Box3().setFromObject(before);
    for(const edge of ['min','max'])for(const axis of ['x','y','z'])near(a[edge][axis],b[edge][axis],2e-7);
  }
});
test('Wasm plume is invariant to orbital velocity in vacuum and rendering cadence',()=>{
  const rest=new WasmExhaustFlow(module),orbit=new WasmExhaustFlow(module),f=frame();f.density=0;f.obstacles=[];f.groundHeight=1000;
  const moving=frame();moving.density=0;moving.obstacles=[];moving.groundHeight=1000;moving.emitters[0].velocity.set(0,0,7800);
  rest.step(0,f);orbit.step(0,moving);
  for(let i=1;i<=120;i++){moving.origin.z=7800*i/120;rest.step(1/120,f);orbit.step(1/120,moving);}
  const positions=rest.particles;orbit.particles.forEach((p,i)=>assert.ok(p.position.distanceTo(positions[i].position)<1e-8));
  const coarse=new WasmExhaustFlow(module);for(let i=0;i<30;i++)coarse.step(1/30,f);
  coarse.particles.forEach((p,i)=>assert.ok(p.position.distanceTo(positions[i].position)<1e-9));
});
