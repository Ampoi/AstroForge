// Informational benchmark, not a hardware-dependent pass/fail gate.
import {performance} from 'node:perf_hooks';
import {stat,readdir} from 'node:fs/promises';
import {Simulation,STEP} from '../server/physics.ts';
import {physicsKernel} from '../server/physics-kernel.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {starterCraft} from '../shared/craft.ts';

const results=[];
for(const count of [13,80]){
  const craft=starterCraft();
  while(craft.parts.length<count){const i=craft.parts.length;craft.parts.push({id:`bench_fin_${i}`,type:'fin',parent:'tank_2',angle:i*Math.PI/4,offset:0});}
  const sim=new Simulation(craft),protocol=new PylonProtocol(sim,()=>sim.time);protocol.available=true;
  sim.engines.engine_1={enabled:true,targetThrust:60000,expires:100};
  for(let i=0;i<240;i++)sim.step();
  const samples=[];let wireBytes=0;
  const start=performance.now();
  for(let i=0;i<1200;i++){
    const before=performance.now();sim.step(STEP);samples.push(performance.now()-before);
    if(i%6===0)for(const packet of protocol.telemetry())wireBytes+=Buffer.byteLength(JSON.stringify(packet));
  }
  const elapsed=performance.now()-start;samples.sort((a,b)=>a-b);
  results.push({parts:count,simulatedSeconds:10,wallMilliseconds:+elapsed.toFixed(1),
    physicsStepP95Milliseconds:+samples[Math.floor(samples.length*.95)].toFixed(3),
    realtimeCorePercent:+(elapsed/100).toFixed(2),udpKiBPerSecond:+(wireBytes/10/1024).toFixed(1)});
}
async function bytes(dir){let total=0;for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;total+=e.isDirectory()?await bytes(p):(await stat(p)).size;}return total;}
let assets;try{assets=await bytes('dist');}catch{assets=await bytes('public')+await bytes('src')+await bytes('shared');}
console.log(JSON.stringify({node:process.version,platform:process.platform,backend:physicsKernel.name,results,
  browserAssetsMiB:+(assets/1024/1024).toFixed(2),benchmarkProcessRssMiB:+(process.memoryUsage().rss/1024/1024).toFixed(1),
  note:'CPU simulation + 20 Hz telemetry serialization. Excludes WebGL rendering and network I/O; browserAssetsMiB is the uncompressed local payload.'},null,2));
