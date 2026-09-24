// Independent processes keep JIT warmup and backend selection comparable.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url)),runs={js:[],zig:[]};
for(let round=0;round<5;round++)for(const backend of (round%2?['zig','js']:['js','zig'])){
  const result=spawnSync(process.execPath,['tests/benchmark.js'],{cwd,env:{...process.env,ASTROFORGE_PHYSICS:backend},encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||'Benchmark failed');
  runs[backend].push(JSON.parse(result.stdout));
}
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const results=[13,80].map(parts=>{
  const measurements={};
  for(const backend of ['js','zig']){
    const samples=runs[backend].map(run=>run.results.find(row=>row.parts===parts));
    measurements[backend]={wallMilliseconds:median(samples.map(s=>s.wallMilliseconds)),physicsStepP95Milliseconds:median(samples.map(s=>s.physicsStepP95Milliseconds))};
  }
  return {parts,...measurements,speedup:+(measurements.js.wallMilliseconds/measurements.zig.wallMilliseconds).toFixed(2)};
});
console.log(JSON.stringify({node:process.version,platform:process.platform,runsPerBackend:5,simulatedSecondsPerRun:10,results,
  note:'Median of five separate processes per backend, alternating order. Includes physics and 20 Hz telemetry serialization; excludes rendering and network I/O. Informational, not a pass/fail gate.'},null,2));
