import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Box3, Mesh, Vector3, Raycaster} from 'three';
import {makePart, disposeGroup} from '../src/scene.ts';
import {engineGimbal} from '../src/exhaust.ts';
import {PARTS, WHEEL} from '../shared/craft.ts';

const manifest=JSON.parse(readFileSync(new URL('../src/assets/blender/manifest.json',import.meta.url)));
const types=Object.keys(manifest.models);
const bounds=part=>{part.updateWorldMatrix(true,true);return new Box3().setFromObject(part);};
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const hash=data=>createHash('sha256').update(data).digest('hex');

test('Blender assets match their recorded source and exports',()=>{
  assert.equal(types.length,12); // Ten part families, including three engines.
  assert.equal(hash(readFileSync(new URL('../scripts/build-blender-parts.py',import.meta.url))),manifest.generatorSha256);
  for(const type of types){
    assert.equal(hash(readFileSync(new URL(`../src/assets/blender/${type}.json`,import.meta.url))),manifest.models[type].sha256,type);
  }
});

test('Blender meshes have valid indices, finite unit normals, outward winding and bounded draw calls',()=>{
  for(const type of types){
    const part=makePart(type);assert.equal(part.userData.blenderModel,type);
    let triangles=0,meshes=0;
    part.traverse(mesh=>{
      if(!(mesh instanceof Mesh))return;
      meshes++;
      const {position,normal}=mesh.geometry.attributes,index=mesh.geometry.index;
      assert.equal(position.count,normal.count);
      for(let i=0;i<position.count;i++){
        const p=new Vector3().fromBufferAttribute(position,i),n=new Vector3().fromBufferAttribute(normal,i);
        assert.ok(p.toArray().every(Number.isFinite));near(n.length(),1,6e-5);
      }
      triangles+=index.count/3;
      for(let i=0;i<index.count;i+=3){
        const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
        for(const id of ids)assert.ok(id<position.count);
        const [a,b,c]=ids.map(id=>new Vector3().fromBufferAttribute(position,id));
        const face=b.sub(a).cross(c.sub(a));
        assert.ok(face.lengthSq()>1e-20,`${type}: collapsed triangle`);
        assert.ok(face.dot(new Vector3().fromBufferAttribute(normal,ids[0]))>=-1e-10,`${type}: flipped normal`);
      }
    });
    assert.equal(triangles,manifest.models[type].triangles);
    assert.ok(triangles<60000,`${type}: triangle budget`);
    assert.ok(meshes<=(type==='wheel'?18:11),`${type}: draw-call budget`);
  }
});

test('models retain stack datums and the original radial silhouette envelopes',()=>{
  for(const type of ['pod','battery','chassis']){
    const box=bounds(makePart(type));
    near(box.min.y,-PARTS[type].height/2);near(box.max.y,PARTS[type].height/2);
  }
  for(const type of ['engine','booster_engine','vacuum_engine']){
    const box=bounds(makePart(type));
    near(box.min.y,-.525,.01);near(box.max.y,.525,.001);
    near(box.getSize(new Vector3()).x,1.2);
  }
  const envelopes={docking:[0,.3,.27,.27],fin:[-.04,.95,1,.13],rcs:[-.04,.33,.48,.48],solar:[-.03,1.34,.73,.19]};
  for(const [type,[minX,maxX,height,depth]] of Object.entries(envelopes)){
    const box=bounds(makePart(type)),size=box.getSize(new Vector3());
    assert.ok(box.min.x>=minX&&box.max.x<=maxX,`${type}: radial mount`);
    assert.ok(size.y<=height&&size.z<=depth,`${type}: silhouette`);
  }
  const tire=makePart('wheel').getObjectByName('tire');
  const box=bounds(tire),center=box.getCenter(new Vector3());
  near(center.x,WHEEL.trackOffset);near(center.z,-WHEEL.extension);
  near(box.getSize(new Vector3()).z,WHEEL.radius*2,.015);
});

test('engine exit and separator remain open instead of containing solid cylinder caps',()=>{
  for(const type of ['engine','booster_engine','vacuum_engine']){
    const part=makePart(type);part.updateWorldMatrix(true,true);
    const ray=new Raycaster(new Vector3(0,-1,0),new Vector3(0,1,0));
    const hits=ray.intersectObject(part,true);
    assert.ok(hits.length);assert.ok(hits[0].point.y>-.2,`${type}: nozzle mouth is capped`);
  }
  const separator=makePart('decoupler');separator.updateWorldMatrix(true,true);
  assert.equal(new Raycaster(new Vector3(0,1,0),new Vector3(0,-1,0)).intersectObject(separator,true).length,0);
});

test('gimbal and wheel pivots preserve runtime animation and independent instances',()=>{
  for(const type of ['engine','booster_engine','vacuum_engine']){
    const first=makePart(type),second=makePart(type),fixed=first.getObjectByName('fixed');
    const nozzle=first.getObjectByName('engine-gimbal');near(nozzle.position.y,.24);
    const fixedMesh=fixed.children.find(child=>child instanceof Mesh),base=bounds(fixedMesh).clone();
    const original=bounds(second).clone();
    nozzle.quaternion.copy(engineGimbal(.1,-.05));
    assert.ok(bounds(fixedMesh).equals(base));assert.ok(bounds(second).equals(original));
    assert.ok(!bounds(first).equals(original));
    disposeGroup(first);assert.ok(bounds(second).equals(original));
  }
  const part=makePart('wheel'),other=makePart('wheel'),original=bounds(other).clone();
  const suspension=part.getObjectByName('suspension'),steering=part.getObjectByName('steering'),tire=part.getObjectByName('tire'),spring=part.getObjectByName('spring');
  assert.equal(tire.parent,steering);assert.equal(steering.parent,suspension);
  near(suspension.position.x,WHEEL.trackOffset);near(spring.rotation.x,Math.PI/2);
  for(const compression of [0,.2,.4,0]){
    const length=WHEEL.extension-compression;
    suspension.position.z=-length;spring.position.z=-length/2;spring.scale.y=length;
    steering.rotation.z=.4;tire.rotation.x=1.2;
    part.updateWorldMatrix(true,true);
    near(tire.getWorldPosition(new Vector3()).z,-length);
    assert.ok(bounds(part).getSize(new Vector3()).toArray().every(n=>Number.isFinite(n)&&n>0));
    assert.ok(bounds(other).equals(original));
  }
});
