import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3,Raycaster} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const bytes=await readFile(new URL('../public/assets/launch-complex/launch-complex.glb',import.meta.url));
const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
scene.updateMatrixWorld(true);
const meshes=[];
scene.traverse(o=>{if(o.isMesh)meshes.push(o);});
function surfaceY(x,z,objects=meshes,originY=110){
  const ray=new Raycaster(new Vector3(x,originY,z),new Vector3(0,-1,0));
  return ray.intersectObjects(objects,false)[0]?.point.y;
}

test('Blender launch complex ships bounded, finite PBR geometry without external resources',()=>{
  let triangles=0;
  assert.ok(bytes.length<8*1024*1024);
  assert.ok(meshes.length<=90,'static batching must bound runtime draw calls');
  for(const mesh of meshes){
    const position=mesh.geometry.attributes.position;
    assert.ok(position&&mesh.geometry.attributes.normal);
    assert.ok(position.array.every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite));
    triangles+=(mesh.geometry.index?.count??position.count)/3;
    assert.ok(mesh.material.isMeshStandardMaterial);
    assert.equal(mesh.material.map,null,'no separate textures may be required');
  }
  assert.ok(triangles>50000&&triangles<180000);
  const bounds=new Box3().setFromObject(scene);
  assert.ok(bounds.max.y>=90&&bounds.max.y<100);
  assert.ok(bounds.min.y>=-1.3);
  assert.ok(bounds.max.z>300&&bounds.min.z<-140);
});

test('vehicle contact deck and apron retain the physics heights and the launch axis stays open',()=>{
  for(const [x,z] of [[4,0],[-4,0],[8,4],[-8,-4],[0,4]]){
    assert.ok(Math.abs(surfaceY(x,z,meshes,.15))<1e-5,`deck ${x},${z}`);
  }
  for(const [x,z] of [[24,27],[39,-15],[-40,33]]){
    assert.ok(Math.abs(surfaceY(x,z)+.845)<.01,`apron ${x},${z}`);
  }
  // No crane, umbilical arm or service deck crosses the ascent axis.
  assert.ok(surfaceY(0,0)<0);
  assert.ok(surfaceY(.4,-.4)<0);
});

test('the broad transport causeway continuously reaches the recessed VAB bay from the launch deck',()=>{
  const corridor=meshes.filter(o=>o.name.startsWith('03_VAB_transport_corridor'));
  assert.ok(corridor.length>0);
  for(const x of [-10,-3,0,3,10]){
    let previous=surfaceY(x,7,corridor);
    for(let z=7;z<=220;z+=.5){
      const y=surfaceY(x,z,corridor);
      assert.ok(Number.isFinite(y),`gap at ${x},${z}`);
      assert.ok(y>=-.85&&y<=.03,`surface at ${x},${z}: ${y}`);
      assert.ok(Math.abs(y-previous)<.06,`step at ${x},${z}`);
      previous=y;
    }
  }
  // A transport vehicle has a clear entrance through the actual modeled door.
  for(const x of [-10,0,10])for(const y of [2,10,20,35]){
    const ray=new Raycaster(new Vector3(x,y,180),new Vector3(0,0,1),0,15);
    assert.equal(ray.intersectObjects(meshes,false).length,0,`blocked VAB gate ${x},${y}`);
  }
});

test('apron, causeway, VAB floor and road junctions do not stack coplanar top faces',()=>{
  for(const [x,z] of [[2.3,30.7],[-3.4,40.2],[2.3,204.7],[-203.1,-139.3],[173.1,95.8],[-83.1,285.8]]){
    const hits=new Raycaster(new Vector3(x,1,z),new Vector3(0,-1,0)).intersectObjects(meshes,false);
    assert.ok(hits.length>0);
    const top=hits.filter(h=>Math.abs(h.distance-hits[0].distance)<.001);
    assert.equal(top.length,1,`coplanar floor overlap at ${x},${z}`);
  }
});
