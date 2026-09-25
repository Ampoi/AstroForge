import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RocketScene} from '../src/scene.ts';

function mapScene(){
  const element=new EventTarget();
  element.style={};element.getRootNode=()=>element;element.clientHeight=800;
  const camera=new PerspectiveCamera(34,1.5,.05,4000);camera.up.set(0,0,-1);
  const controls=new OrbitControls(camera,element);controls.minDistance=12;controls.maxDistance=1500;
  const scene=Object.assign(Object.create(RocketScene.prototype),{
    globe:true,element,camera,controls,globeCamera:camera,globeControls:controls,
    environment:{position:new Vector3(.6,.8,.3),uniforms:{sunDirection:{value:new Vector3(1,0,0)}}},
  });
  scene.fit();
  return scene;
}
const near=(actual,expected)=>assert.ok(actual.distanceTo(expected)<1e-9,`${actual.toArray()} != ${expected.toArray()}`);
function centered(scene){
  scene.camera.updateMatrixWorld();
  const marker=scene.environment.position.clone().multiplyScalar(10.002).project(scene.camera);
  assert.ok(Math.hypot(marker.x,marker.y)<1e-9);
  assert.ok(marker.z>-1&&marker.z<1);
}

test('map fit and zoom buttons keep the tracked vehicle centered',()=>{
  const scene=mapScene();centered(scene);
  for(const factor of [.8,.8,1.25]){
    const distance=scene.camera.position.distanceTo(scene.controls.target);
    scene.zoom(factor);centered(scene);
    assert.ok(Math.abs(scene.camera.position.distanceTo(scene.controls.target)-distance*factor)<1e-9);
  }
  scene.controls.dispose();
});

test('map wheel zoom uses the tracked vehicle as its pivot',()=>{
  const scene=mapScene();
  for(const deltaY of [-100,100]){
    const distance=scene.camera.position.distanceTo(scene.controls.target);
    const event=new Event('wheel',{cancelable:true});
    Object.assign(event,{deltaY,deltaMode:0,clientX:0,clientY:0});
    scene.element.dispatchEvent(event);centered(scene);
    const next=scene.camera.position.distanceTo(scene.controls.target);
    assert.ok(deltaY<0?next<distance:next>distance);
  }
  scene.controls.dispose();
});

test('map follows movement and a distant target switch without resetting viewing angle or zoom',()=>{
  const scene=mapScene();scene.zoom(.8);
  const offset=scene.camera.position.clone().sub(scene.controls.target);
  for(const position of [new Vector3(.61,.81,.31),new Vector3(-4,2,-1)]){
    scene.environment.position.copy(position);scene.updateMapTarget();scene.controls.update();
    near(scene.camera.position.clone().sub(scene.controls.target),offset);centered(scene);
  }
  const previous=scene.camera.position.clone(),target=scene.controls.target.clone();
  scene.globe=false;scene.environment.position.set(0,1,0);scene.updateMapTarget();
  near(scene.camera.position,previous);near(scene.controls.target,target);
  scene.controls.dispose();
});
