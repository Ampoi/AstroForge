import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {EarthEnvironment} from '../src/environment.ts';
import {SolarMap,mapVector,MAP_SCALE} from '../src/solar-map.ts';
import {earthFixed,SunBody,EARTH_RADIUS} from '../src/celestial.ts';

const near=(a,b,tolerance=1e-8)=>assert.ok(a.distanceTo(b)<tolerance,`${a.toArray()} != ${b.toArray()}`);

test('map rays and projected depth match the Earth-fixed flight frame after time and focus changes',()=>{
  const map=new SolarMap({renderMap(){}},false);
  map.updateVehicles([{id:'orbit',position:[EARTH_RADIUS+400000,0,0],velocity:[0,7800,0],status:'flying',craft:{name:'Orbit'}}],'orbit');
  const camera=new THREE.PerspectiveCamera(34,1.6,.01,3000000);
  const sun=new SunBody(),environment={mapCamera:new THREE.PerspectiveCamera(),sun,uniforms:{sunDirection:{value:new THREE.Vector3()}},render(renderer,local,globe,center,overlay){
    assert.equal(globe,true);assert.equal(overlay,false);
    local.updateMatrixWorld();
  }};
  for(const time of [0,21600,86400,86400*91])for(const focus of ['earth','moon','sun','vehicle:orbit']){
    map.updateTime(time);map.setFocus(focus);
    const position=[EARTH_RADIUS*1.7,EARTH_RADIUS*2.2,EARTH_RADIUS*.5],target=[0,0,0];
    camera.position.copy(mapVector(position)).sub(map.origin);
    camera.up.set(0,0,-1);camera.lookAt(mapVector(target).sub(map.origin));camera.updateMatrixWorld();
    EarthEnvironment.prototype.renderMap.call(environment,{},camera,map.bodies.get('earth').position,time);
    const local=environment.mapCamera;
    near(local.position,earthFixed(position,time).multiplyScalar(MAP_SCALE));
    const direction=camera.getWorldDirection(new THREE.Vector3());
    near(local.getWorldDirection(new THREE.Vector3()),earthFixed([direction.y,direction.x,-direction.z],time));
    near(environment.uniforms.sunDirection.value,sun.position.clone().normalize());
    // Verify full projected coordinates including depth, used to hide far-side
    // tracks and retain near-side craft after the shared Earth pass.
    for(const point of [[EARTH_RADIUS,0,0],[0,EARTH_RADIUS+400000,0],[0,0,-EARTH_RADIUS]]){
      near(mapVector(point).sub(map.origin).project(camera),earthFixed(point,time).multiplyScalar(MAP_SCALE).project(local));
    }
  }
  map.dispose();
});

test('production solar map draws the shared Earth pass before overlays and restores renderer state',()=>{
  const calls=[],environment={renderMap(renderer,camera,position,time){calls.push('earth');assert.equal(renderer.autoClear,false);assert.equal(time,21600);near(position,map.bodies.get('earth').position);}};
  const map=new SolarMap(environment,false),camera=new THREE.PerspectiveCamera(34,1.6,.01,3000000);
  map.updateTime(21600);map.setFocus('moon');camera.position.set(0,40,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const renderer={autoClear:true,getSize(out){return out.set(1280,720);},clear(){calls.push('clear');},render(scene){calls.push('overlays');assert.equal(scene,map.scene);assert.equal(scene.background,null);assert.equal(map.bodies.get('earth').visible,false);assert.equal(map.bodies.get('moon').visible,true);}};
  map.render(renderer,camera);assert.deepEqual(calls,['clear','earth','overlays']);assert.equal(renderer.autoClear,true);
  environment.renderMap=()=>{throw Error('GPU failure');};
  assert.throws(()=>map.render(renderer,camera),/GPU failure/);assert.equal(renderer.autoClear,true);
  map.dispose();
});
