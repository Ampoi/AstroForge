import type {Simulation} from './physics.ts';
import type {Packet} from './types.ts';
import {EARTH,gravity} from './physics.ts';
import {sub,cross,rotate,qconj} from '../shared/math.ts';

// PyLoN's default IMU is specific force in body axes, not coordinate acceleration.
// Its gyroscope includes Earth rotation; the ground-truth stream removes it.
export function imuSample(sim: Simulation){
  const grounded=['pad','landed','crashed'].includes(sim.status);
  const spin=[0,0,EARTH.spin];
  const acceleration=grounded?cross(spin,cross(spin,sim.position)):sim.acceleration;
  return {angularVelocity:[...sim.omega],linearAcceleration:rotate(qconj(sim.quaternion),sub(acceleration,gravity(sim.position)))};
}

export function appendObservations(packets: Packet[],sim: Simulation,packet: (type:string,fields:Record<string,unknown>)=>Packet){
  packets.push(packet('pylon_imu',imuSample(sim)));
  packets.push(packet('pylon_vehicle_health',{electricCharge:sim.charge,electricCapacity:sim.stats.power}));
  const snapshot=packet('pylon_control_snapshot',{
    flight:packets.find(p=>p.type==='pylon_flight_state'),
    engines:packets.filter(p=>p.type==='pylon_actuator_state'&&p.actuatorType==='engine'),
    separations:packets.filter(p=>p.type==='pylon_actuator_state'&&p.actuatorType==='separation')
  });
  // Match upstream's atomic snapshot size rule; never publish a partial view.
  if(Buffer.byteLength(JSON.stringify(snapshot))<=60000)packets.push(snapshot);
}
