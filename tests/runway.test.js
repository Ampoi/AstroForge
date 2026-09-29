import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3, Raycaster} from 'three';
import {makeRunway} from '../src/runway.ts';
import {RUNWAY} from '../shared/launch-sites.ts';
import {surfaceHeight,fixedPosition} from '../shared/terrain.ts';
import {FlightWorld} from '../server/world.ts';
import {Simulation,EARTH} from '../server/physics.ts';
import {starterCraft,roverCraft} from '../shared/craft.ts';
import {rotate,axisAngle,sub,norm,cross} from '../shared/math.ts';

const close=(a,b,eps=.02)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const ids=preview=>preview.occupants.map(v=>v.id);
test('runway rendered deck matches the rotating physical surface along its full length',()=>{
  const runway=makeRunway();runway.updateMatrixWorld(true);
  assert.ok(runway.children.length<=6);
  for(const east of [-290,-220,600,1490])for(const north of [-475,-450,-425]){
    const ray=new Raycaster(new Vector3(east,10,-north),new Vector3(0,-1,0));
    const hit=ray.intersectObject(runway)[0];assert.ok(hit);close(hit.point.y,RUNWAY.height,.03);
    for(const time of [0,10000]){
      const position=rotate(axisAngle([0,0,1],EARTH.spin*time),[EARTH.radius,east,north]);
      const radius=norm(position);
      close(surfaceHeight(position,time),(EARTH.radius+RUNWAY.height)/(EARTH.radius/radius)-EARTH.radius);
    }
  }
  for(const mesh of runway.children){mesh.geometry.dispose();mesh.material.dispose();}
});
test('runway wheel craft stays supported, then drives east without moving the pad craft',()=>{
  const world=new FlightWorld(starterCraft()),pad=world.active;
  world.time=10000;
  const rover=world.add(roverCraft(),{site:'runway'});
  close(fixedPosition(rover.position,world.time)[1],RUNWAY.spawnEast);
  close(fixedPosition(rover.position,world.time)[2],RUNWAY.north);
  assert.ok(rover.snapshot().upBody[2]>.99);
  for(let i=0;i<360;i++)world.step();
  assert.equal(rover.status,'flying');assert.ok(rover.wheelStates.every(w=>w.grounded));
  const start=fixedPosition(rover.position,world.time)[1];
  for(const part of rover.craft.parts.filter(p=>p.type==='wheel'))rover.wheels[part.id]={enabled:true,targetAngularVelocity:12,maxDriveTorque:1000,steeringAngle:0,brake:0,expires:20000};
  for(let i=0;i<480;i++)world.step();
  assert.ok(fixedPosition(rover.position,world.time)[1]>start+2);
  assert.equal(pad.status,'pad');assert.equal(world.vehicles.length,2);
});
test('pad and runway occupancy require explicit recovery, including vehicles far along the runway',()=>{
  const world=new FlightWorld(starterCraft()),pad=world.active;
  assert.throws(()=>world.add(starterCraft()),/回収/);assert.equal(world.active,pad);
  const runway=world.add(roverCraft(),{site:'runway'});
  runway.position[1]=1000;runway.velocity=cross([0,0,EARTH.spin],runway.position);
  assert.deepEqual(ids(world.launchPreview(roverCraft(),'runway')),[runway.id]);
  assert.throws(()=>world.add(roverCraft(),{site:'runway'}),/回収/);
  const replacement=world.add(roverCraft(),{site:'runway',recoverVehicleIds:[runway.id]});
  assert.deepEqual(world.vehicles,[pad,replacement]);
  world.add(starterCraft(),{recoverVehicleIds:[pad.id]});assert.ok(world.vehicles.includes(replacement));
});
test('recovery rechecks moving, airborne and stale targets without changing the world',()=>{
  const world=new FlightWorld(starterCraft()),pad=world.active;
  const preview=world.launchPreview(starterCraft());assert.equal(preview.occupants[0].recoverable,true);
  pad.velocity[1]+=3;
  assert.throws(()=>world.add(starterCraft(),{recoverVehicleIds:[pad.id]}),/回収対象/);
  pad.position[0]+=15;pad.velocity=cross([0,0,EARTH.spin],pad.position);
  assert.equal(world.launchPreview(starterCraft()).occupants[0].recoverable,false);
  assert.throws(()=>world.add(starterCraft(),{recoverVehicleIds:[pad.id]}),/回収対象/);
  assert.throws(()=>world.add(starterCraft(),{recoverVehicleIds:['missing']}),/回収対象/);
  assert.throws(()=>world.add(starterCraft(),{recoverVehicleIds:[pad.id,pad.id]}),/指定が不正/);
  assert.deepEqual(world.vehicles,[pad]);assert.equal(world.active,pad);
});
test('recovering a detached ground stage preserves its flying parent, and the inverse preserves the stage',()=>{
  const world=new FlightWorld(starterCraft()),parent=world.active;
  parent.position[0]+=1000;parent.status='flying';
  const stage=new Simulation(starterCraft());stage.status='landed';stage.id='detached';parent.debris.push(stage);
  assert.deepEqual(ids(world.launchPreview(starterCraft())),[stage.id]);
  const next=world.add(starterCraft(),{recoverVehicleIds:[stage.id]});
  assert.ok(world.vehicles.includes(parent));assert.deepEqual(parent.debris,[]);
  const distant=new Simulation(starterCraft());distant.position[0]+=2000;distant.status='flying';next.debris.push(distant);
  world.add(starterCraft(),{recoverVehicleIds:[next.id]});assert.ok(world.vehicles.includes(distant));
});
test('horizontal rocket can wait on the runway and receive thrust without a pad liftoff threshold',()=>{
  const world=new FlightWorld(starterCraft()),rocket=world.add(starterCraft(),{site:'runway'});
  for(let i=0;i<600;i++)world.step();
  assert.equal(rocket.status,'flying');assert.ok(norm(sub(rocket.velocity,cross([0,0,EARTH.spin],rocket.position)))<2);
  const start=fixedPosition(rocket.position,world.time)[1];
  rocket.engines.engine_1={enabled:true,targetThrust:60000,expires:world.time+3};
  for(let i=0;i<120;i++)world.step();
  assert.ok(fixedPosition(rocket.position,world.time)[1]>start+1);
});
