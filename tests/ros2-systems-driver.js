// Isolated protocol/physics fixture for the real ROS2 integration test.
import {createInterface} from 'node:readline';
import {Simulation,EARTH} from '../server/physics.ts';
import {roverCraft} from '../shared/craft.ts';
import {VehicleUdp} from '../server/vehicle-udp.ts';
const craft=roverCraft();craft.parts.splice(1,0,{id:'hinge',type:'servo'},{id:'slide',type:'linear'});
craft.parts.push({id:'separator',type:'decoupler'},{id:'tank',type:'tank'},{id:'engine',type:'engine'});
for(const type of ['lidar2d','lidar3d','camera','startracker','docking'])craft.parts.push({id:type,type,parent:'chassis_1',offset:0,angle:0});
const sim=new Simulation(craft);sim.status='flying';sim.position=[EARTH.radius+400000,0,0];sim.quaternion=[0,0,0,1];sim.velocity=[0,0,0];sim.omega=[0,0,0];
const udp=new VehicleUdp({commandPort:0,telemetryPort:Number(process.argv[2]),telemetryHost:'127.0.0.1'});await udp.enable(sim);
console.log(JSON.stringify({commandPort:udp.channels.get(sim.id).socket.address().port}));
const timer=setInterval(()=>{udp.expire();for(let i=0;i<6;i++)sim.step(1/120,performance.now()/1000);udp.telemetry(1);},50);
try{for await(const _ of createInterface({input:process.stdin}))console.log(JSON.stringify({received:udp.snapshot(sim.id).received,motors:sim.joints}));}
finally{clearInterval(timer);await udp.close();}
