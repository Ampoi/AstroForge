// Informational CPU benchmark. Rendering/GPU timing lives in tests/performance.html.
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {ExhaustFlow} from '../src/exhaust.ts';
import {WasmExhaustFlow} from '../src/exhaust-kernel.ts';
import {prepareMassModel} from '../shared/mass-model.ts';
import {starterCraft,massProperties} from '../shared/craft.ts';
import {FlightWorld} from '../server/world.ts';
import {Simulation} from '../server/physics.ts';
import {StateStreamEncoder} from '../shared/state-stream.ts';
import type {AppState} from '../shared/api.ts';
const module=new WebAssembly.Module(readFileSync(new URL('../build/exhaust.wasm',import.meta.url)));
const median=(a:number[])=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
function measure(fn:()=>void,iterations:number){
  for(let i=0;i<100;i++)fn();
  const samples=[];
  for(let round=0;round<7;round++){const start=performance.now();for(let i=0;i<iterations;i++)fn();samples.push((performance.now()-start)/iterations);}
  return +median(samples).toFixed(4);
}
const v=(x=0,y=0,z=0)=>new Vector3(x,y,z);
const exhaust=[];
for(const obstacles of [13,80]){
  const frame={origin:v(),airVelocity:v(3,0,0),up:v(0,1,0),groundHeight:2,density:1,
    emitters:[{position:v(),direction:v(0,-1,0),velocity:v(),throttle:1},{position:v(2),direction:v(0,-1,0),velocity:v(),throttle:1}],
    obstacles:Array.from({length:obstacles},(_,i)=>({start:v(0,i*2,0),end:v(0,i*2+1,0),radius:.6}))};
  const js=new ExhaustFlow(),wasm=new WasmExhaustFlow(module);
  const jsMs=measure(()=>js.step(1/60,frame),300),wasmMs=measure(()=>wasm.step(1/60,frame),300);
  exhaust.push({obstacles,particles:wasm.count,jsMs,wasmMs,speedup:+(jsMs/wasmMs).toFixed(2)});
}
const mass=[];
for(const count of [13,80]){
  const craft=starterCraft();while(craft.parts.length<count){const i=craft.parts.length;craft.parts.push({id:`extra_${i}`,type:'fin',parent:'tank_2',offset:0,angle:i});}
  const fuel={tank_1:800,tank_2:500},prepared=prepareMassModel(craft);
  const referenceMs=measure(()=>{massProperties(craft,fuel,.5);},3000),cachedMs=measure(()=>{prepared.update(fuel,.5);},3000);
  mass.push({parts:count,referenceMs,cachedMs,speedup:+(referenceMs/cachedMs).toFixed(2)});
}
const world=new FlightWorld(starterCraft());
for(let i=0;i<11;i++){const s=new Simulation(starterCraft());s.position[1]+=i*1000+1000;s.status='flying';world.vehicles.push(s);}
for(const s of world.vehicles){s.position[0]+=30000;s.status='flying';}
const library=[{id:'starter',craft:starterCraft()}],encoder=new StateStreamEncoder();
function state(){const cache=new Map();return {mode:'flight',craft:world.active.craft,draft:library[0].craft,library,
  activeVehicleId:world.activeId,vehicles:world.snapshots(cache).map(v=>({...v,udp:{}})),timeScale:1,simulationTime:world.time,utc:'now',
  flight:world.active.snapshot(cache),trail:[],connection:{}} as unknown as AppState;}
const current=state(),compact=encoder.encode(current);
const stream={vehicles:12,legacyBytes:Buffer.byteLength(JSON.stringify(current)),compactFrameBytes:Buffer.byteLength(compact.frame),
  configurationBytes:Buffer.byteLength(compact.configuration),snapshotMs:measure(state,1000),
  legacySerializeMs:measure(()=>{JSON.stringify(current);},1000),compactEncodeMs:measure(()=>{encoder.encode(current);},1000),
  worldStepMs:measure(()=>{world.step();},300)};
console.log(JSON.stringify({node:process.version,method:'Median of 7 batches after warmup; milliseconds per call. CPU only, no rendering/network.',exhaust,mass,stream},null,2));
