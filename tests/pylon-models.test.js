import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3, Vector3, Mesh} from 'three';
import {makePart} from '../src/scene.ts';
import {updatePylonJoint} from '../src/pylon-models.ts';
import {PARTS} from '../shared/craft.ts';

const types=['lidar2d','lidar3d','camera','startracker','servo','linear'];
const bounds=part=>{part.updateWorldMatrix(true,true);return new Box3().setFromObject(part);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
test('all six PyLoN visuals have valid indexed geometry, outward normals and bounded draw calls',()=>{
  for(const type of types){
    const part=makePart(type);assert.equal(part.userData.pylonModel,type);
    let triangles=0,meshes=0,aligned=0,nondegenerate=0;
    part.traverse(mesh=>{
      if(!(mesh instanceof Mesh))return;
      meshes++;const {position,normal}=mesh.geometry.attributes,index=mesh.geometry.index;
      assert.equal(position.count,normal.count);triangles+=index.count/3;
      for(let i=0;i<index.count;i+=3){
        const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
        for(const id of ids)assert.ok(id<position.count);
        const [a,b,c]=ids.map(id=>new Vector3().fromBufferAttribute(position,id));
        const face=b.sub(a).cross(c.sub(a));
        if(face.lengthSq()>1e-20){
          nondegenerate++;
          const n=new Vector3().fromBufferAttribute(normal,ids[0]);
          if(face.dot(n)>=-1e-10)aligned++;
        }
      }
    });
    assert.ok(triangles>7000);assert.ok(meshes<=12, `${type}: ${meshes} draw calls`);
    assert.equal(aligned,nondegenerate, `${type}: incorrect winding/normals`);
    const size=bounds(part).getSize(new Vector3());
    assert.ok(size.toArray().every(n=>Number.isFinite(n)&&n>0&&n<(type==='linear'?3:1)));
    if(PARTS[type].radial)near(bounds(part).min.x,0);
  }
  assert.equal(makePart('docking').userData.pylonModel,undefined);
});
test('linear motor preserves native proportions at the 0.4 m flange diameter',()=>{
  const part=makePart('linear'),model=part.children[0],size=bounds(part).getSize(new Vector3());
  near(model.scale.x,model.scale.y);near(model.scale.y,model.scale.z);
  near(size.x,.4);near(size.z,.4);near(size.y,.4*1.6049312/.3125);
  near(PARTS.linear.height,size.y);
});
test('linear visual follows the existing stack interfaces throughout its full 2 m travel',()=>{
  const part=makePart('linear');
  for(const extension of [0,.1,1,2,0]){
    updatePylonJoint(part,extension);
    const box=bounds(part);
    near(box.min.y,-PARTS.linear.height/2);
    near(box.max.y,PARTS.linear.height/2+extension);
    const sleeve=bounds(part.getObjectByName('LinearSleeve'));
    const rod=bounds(part.getObjectByName('LinearRod'));
    assert.ok(rod.min.y<sleeve.max.y,'telescoping stages must overlap');
    assert.ok(sleeve.min.y<bounds(part.getObjectByName('fixed')).max.y);
  }
});
test('servo rotates its imported rotor around the simulator hinge axis and leaves the base fixed',()=>{
  const part=makePart('servo'),base=part.getObjectByName('fixed'),rotor=part.getObjectByName('ServoRotor');
  const original=bounds(base).clone();
  updatePylonJoint(part,Math.PI/2);part.updateMatrixWorld(true);
  near(rotor.rotation.y,Math.PI/2);
  assert.ok(bounds(base).equals(original));
  const axis=new Vector3(0,1,0).transformDirection(rotor.matrixWorld);
  near(axis.z,1);near(axis.x,0);near(axis.y,0);
});
test('ghost material changes, disposal and repeated rotor creation do not corrupt other instances',()=>{
  for(const type of types){
    const first=makePart(type),second=makePart(type),original=bounds(second).clone();
    first.traverse(mesh=>{if(mesh instanceof Mesh){mesh.material.opacity=.28;mesh.geometry.dispose();mesh.material.dispose();}});
    updatePylonJoint(first,1);
    assert.ok(bounds(second).equals(original));
    second.traverse(mesh=>{if(mesh instanceof Mesh)assert.equal(mesh.material.opacity,1);});
    assert.ok(bounds(makePart(type)).equals(original));
  }
});
