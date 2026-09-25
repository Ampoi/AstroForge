// Line-based harness for the independent, upstream Python wire-contract check.
import {createInterface} from 'node:readline';
import {Simulation} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {twoStageCraft,roverCraft} from '../shared/craft.ts';
const craft=process.argv.includes('--rover')?roverCraft():twoStageCraft();
if(process.argv.includes('--systems')){craft.parts.splice(1,0,{id:'hinge',type:'servo'},{id:'slide',type:'linear'});for(const type of ['lidar2d','lidar3d','camera','startracker','docking'])craft.parts.push({id:type,type,parent:'tank_1',angle:0,offset:0});}
const sim=new Simulation(craft),protocol=new PylonProtocol(sim,()=>0);
protocol.available=true;
console.log(JSON.stringify(protocol.telemetry()));
for await(const line of createInterface({input:process.stdin})){
  const result=protocol.receive(Buffer.from(line));sim.step(1/120,0);
  console.log(JSON.stringify({result,packets:protocol.telemetry()}));
}
