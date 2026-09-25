// Test-only peer: production UDP adapter, ephemeral ports, no HTTP/UI process.
import {createInterface} from 'node:readline';
import {Simulation} from '../server/physics.ts';
import {starterCraft} from '../shared/craft.ts';
import {VehicleUdp} from '../server/vehicle-udp.ts';

const sim=new Simulation(starterCraft());
const udp=new VehicleUdp({commandPort:0,telemetryPort:Number(process.argv[2]),telemetryHost:'127.0.0.1'});
await udp.enable(sim);
const channel=udp.channels.get(sim.id);
console.log(JSON.stringify({commandPort:channel.socket.address().port}));
const timer=setInterval(()=>{sim.step();udp.telemetry(1);},50);
try{
  for await(const action of createInterface({input:process.stdin})){
    if(['landed','crashed','destroyed'].includes(action))sim.status=action;
    else if(action==='off')await udp.disable(sim.id);
    else throw Error(`Unknown test action: ${action}`);
    console.log(JSON.stringify({action}));
  }
}finally{clearInterval(timer);await udp.close();}
