// Line-based harness for the independent, upstream Python wire-contract check.
import {createInterface} from 'node:readline';
import {Simulation} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {twoStageCraft} from '../shared/craft.ts';
const sim=new Simulation(twoStageCraft()),protocol=new PylonProtocol(sim,()=>0);
protocol.available=true;
console.log(JSON.stringify(protocol.telemetry()));
for await(const line of createInterface({input:process.stdin})){
  const result=protocol.receive(Buffer.from(line));sim.step(1/120,0);
  console.log(JSON.stringify({result,packets:protocol.telemetry()}));
}
