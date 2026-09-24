import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,EARTH} from '../server/physics.js';
import {PylonProtocol} from '../server/protocol.js';
import {imuSample} from '../server/observations.js';
import {starterCraft,PARTS} from '../shared/craft.js';
import {norm,mul,unit,cross,axisAngle,dot} from '../shared/math.js';

test('stationary IMU measures effective gravity and inertial Earth rotation',()=>{
  const sim=new Simulation(starterCraft());
  for(const status of ['pad','landed','crashed']){
    sim.status=status;const imu=imuSample(sim),r=norm(sim.position),expected=EARTH.mu/r**2-EARTH.spin**2*r;
    assert.ok(Math.abs(imu.linearAcceleration[0]-expected)<1e-10);
    assert.ok(Math.abs(imu.angularVelocity[2]-EARTH.spin)<1e-12);
  }
});
test('coasting IMU measures near-zero specific force; burning IMU follows thrust per mass',()=>{
  const sim=new Simulation(starterCraft());sim.status='flying';sim.position=[EARTH.radius+200000,0,0];sim.velocity=[0,0,0];sim.omega=[0,0,0];
  sim.step();assert.ok(norm(imuSample(sim).linearAcceleration)<1e-5);
  sim.engines.engine_1={enabled:true,targetThrust:60000,expires:10};sim.step();
  assert.ok(Math.abs(imuSample(sim).linearAcceleration[0]-60000/sim.props.mass)<1e-5);
});
test('power storage follows solar incidence, shadow and Wh-to-joule conversion',()=>{
  const craft=starterCraft();craft.parts.push({id:'panel',type:'solar',parent:'tank_1',angle:0,offset:0});
  const sim=new Simulation(craft),sun=unit([.3,-.8,.5]),z=[0,0,1];sim.charge=50;
  sim.position=mul(sun,EARTH.radius+200000);sim.quaternion=axisAngle(unit(cross(z,sun)),Math.acos(dot(z,sun)));
  assert.ok(Math.abs(sim.actuation(0,60).watts-PARTS.solar.watts)<1e-10);assert.ok(Math.abs(sim.charge-51.75)<1e-10);
  sim.position=mul(sun,-EARTH.radius-200000);const before=sim.charge;
  assert.equal(sim.actuation(0,60).watts,0);assert.ok(Math.abs(sim.charge-before+.25)<1e-10);
  sim.charge=0;sim.flight={pitch:1,yaw:1,roll:1,expires:10};
  const unpowered=sim.actuation(0,60);assert.equal(sim.charge,0);assert.equal(norm(unpowered.torque),0);
});
test('control snapshot is coherent and power telemetry uses the actual storage',()=>{
  const sim=new Simulation(starterCraft()),protocol=new PylonProtocol(sim,()=>sim.time);protocol.available=true;
  sim.step();const packets=protocol.telemetry(),snapshot=packets.find(p=>p.type==='pylon_control_snapshot');
  assert.ok(snapshot);assert.equal(snapshot.engines.length,1);
  for(const p of [snapshot.flight,...snapshot.engines,...snapshot.separations]){
    assert.equal(p.universalTime,snapshot.universalTime);assert.equal(p.observationSequence,snapshot.observationSequence);
    assert.equal(p.runtimeEpoch,snapshot.runtimeEpoch);
  }
  assert.equal(snapshot.engines[0].operational,true);
  const health=packets.find(p=>p.type==='pylon_vehicle_health');assert.equal(health.electricCharge,sim.charge);assert.equal(health.electricCapacity,880);
  protocol.available=false;assert.deepEqual(protocol.telemetry().map(p=>p.type),['pylon_session']);
});
