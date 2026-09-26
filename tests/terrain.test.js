import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Simulation,EARTH} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {starterCraft} from '../shared/craft.ts';
import {cross,mul,add,rotate,axisAngle} from '../shared/math.ts';
import {terrainDirection,terrainSample,terrainHeight,surfaceClearance,surfaceHeight,rayTerrain,terrainColor} from '../shared/terrain.ts';
import {LocalTerrain} from '../src/terrain.ts';
import {earthFixed} from '../src/celestial.ts';
import {FlightMotion} from '../src/flight-motion.ts';
import {makePart} from '../src/scene.ts';
import {planetPixels} from '../src/terrain-map.ts';
const close=(a,b,tolerance=.002)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function descent(craft,lon=0,lat=0){
  const sim=new Simulation(craft),up=terrainDirection(lon,lat);
  const base=mul(up,EARTH.radius),h=surfaceHeight(base,0);
  sim.position=mul(up,EARTH.radius+h+sim.props.com[0]+.01);
  sim.quaternion=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),new THREE.Vector3(...up)).toArray();
  sim.velocity=add(cross([0,0,EARTH.spin],sim.position),mul(up,-.2));
  sim.omega=rotate([-sim.quaternion[0],-sim.quaternion[1],-sim.quaternion[2],sim.quaternion[3]],[0,0,EARTH.spin]);sim.status='flying';
  for(let i=0;i<60&&sim.status==='flying';i++)sim.step();
  return sim;
}
test('seeded planet has reproducible continents, oceans, mountains and no longitude/pole seam',()=>{
  let land=0,ocean=0,mountain=0;
  for(let y=0;y<30;y++)for(let x=0;x<60;x++){
    const n=terrainDirection(x/60*Math.PI*2,Math.asin((y+.5)/15-1)),s=terrainSample(n);
    assert.deepEqual(terrainSample(n),s);assert.ok(s.height<=8000);
    land+=s.land>.5;ocean+=s.land===0;mountain+=s.height>2500;
  }
  assert.ok(land>250&&ocean>500&&mountain>10,{land,ocean,mountain});
  for(const lat of [-1.2,0,1.2])close(terrainHeight(-Math.PI,lat),terrainHeight(Math.PI,lat),1e-8);
  for(const lat of [-Math.PI/2,Math.PI/2])close(terrainHeight(-2,lat),terrainHeight(2,lat),1e-8);
  close(terrainHeight(0,0),-1.12);
});
test('orbit texture uses the same albedo and elevation with north and longitude aligned',()=>{
  const w=64,h=32,pixels=planetPixels(w,h);
  for(const [x,y] of [[0,0],[32,16],[48,21],[63,31]]){
    const s=terrainSample(terrainDirection(((x+.5)/w-.5)*2*Math.PI,((y+.5)/h-.5)*Math.PI));
    assert.deepEqual([...pixels.slice((y*w+x)*4,(y*w+x)*4+3)],terrainColor(s).map(Math.round));
    close(pixels[(y*w+x)*4+3]/255*8000,Math.max(0,s.height),8000/255);
  }
});
test('returning craft touch the rendered ground off the pad, on hills and after Earth rotation',()=>{
  for(const [lon,lat] of [[500/EARTH.radius,0],[9000/EARTH.radius,0],[.31,.42]]){
    const sim=descent(starterCraft(),lon,lat);assert.equal(sim.status,'landed');
    close(surfaceClearance(sim.position,sim.time),sim.props.com[0]);
    assert.ok(sim.snapshot().speed<1e-7,'zero ground-relative velocity on the touchdown frame');
    const mesh=new LocalTerrain(),fixed=earthFixed(sim.position,sim.time);mesh.update(fixed,new THREE.Vector3());mesh.updateMatrixWorld(true);
    const down=fixed.clone().normalize().negate(),ray=new THREE.Raycaster(new THREE.Vector3(),down),hits=ray.intersectObject(mesh);
    assert.ok(hits.length,'terrain is visible under the landed vessel');
    close(hits[0].distance,sim.props.com[0],.015);
    // Compare the actual engine's visible nozzle rim with the contact surface.
    const engine=makePart('engine',false),bounds=new THREE.Box3().setFromObject(engine);
    close(bounds.min.y+.525,0,.01);
    const before=fixed.clone();for(let i=0;i<120;i++)sim.step();
    assert.ok(earthFixed(sim.position,sim.time).distanceTo(before)<1e-6);
    close(surfaceClearance(sim.position,sim.time),sim.props.com[0]);
    mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();
  }
});
test('short separated parts do not float on an artificial minimum radius',()=>{
  const sim=descent({name:'short fragment',parts:[{id:'battery',type:'battery'}]},600/EARTH.radius);
  assert.equal(sim.status,'landed');close(surfaceClearance(sim.position,sim.time),.16);
});
test('fuel depletion changes the centre of mass without leaving a touchdown gap',()=>{
  const sim=new Simulation(starterCraft());sim.fuel=10;sim.step();
  const com=sim.props.com[0],lon=500/EARTH.radius,up=terrainDirection(lon,0);
  sim.position=mul(up,EARTH.radius+surfaceHeight(mul(up,EARTH.radius),sim.time)+com+.01);
  sim.quaternion=axisAngle([0,0,1],lon);sim.velocity=add(cross([0,0,EARTH.spin],sim.position),mul(up,-.2));sim.status='flying';
  for(let i=0;i<60&&sim.status==='flying';i++)sim.step();
  assert.equal(sim.status,'landed');close(surfaceClearance(sim.position,sim.time),sim.props.com[0]);
});
test('UDP AGL and terrain ranging agree at a hillside; ASL remains sea-relative',()=>{
  const sim=descent(starterCraft(),.31,.42),protocol=new PylonProtocol(sim);protocol.available=true;
  const snapshot=protocol.telemetry().find(p=>p.type==='pylon_control_snapshot');
  close(snapshot.flight.altitudeAgl,sim.props.com[0]);
  assert.ok(Math.abs(snapshot.flight.altitudeAsl-snapshot.flight.altitudeAgl)>10);
  const up=sim.position.map(v=>v/Math.hypot(...sim.position));
  close(rayTerrain(sim.position,mul(up,-1),sim.time,2000),sim.props.com[0],.01);
  assert.equal(rayTerrain(sim.position,up,sim.time,2000),Infinity);
});
test('stationary pose interpolation preserves ground clearance under high time warp',()=>{
  const sim=descent(starterCraft(),500/EARTH.radius),a=sim.snapshot(),b=structuredClone(a),dt=200;
  b.time+=dt;b.position=rotate(axisAngle([0,0,1],EARTH.spin*dt),a.position);b.quaternion=new THREE.Quaternion().fromArray(axisAngle([0,0,1],EARTH.spin*dt)).multiply(new THREE.Quaternion(...a.quaternion)).toArray();
  const motion=new FlightMotion();motion.push(a,0);motion.push(b,100);const sample=motion.sample(150);
  close(surfaceClearance(sample.position,sample.time),a.com[0]);
  close(Math.hypot(...sample.position),Math.hypot(...a.position));
});
test('the launch opening, raised deck and surrounding field have distinct contact heights',()=>{
  for(const [east,height] of [[0,-.845],[8,0],[500,-1.12]]){
    const sim=descent(starterCraft(),east/EARTH.radius);
    assert.equal(sim.status,'landed');
    close(surfaceHeight(sim.position,sim.time),height,.03);
    close(surfaceClearance(sim.position,sim.time),sim.props.com[0]);
  }
});
