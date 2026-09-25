import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentFace,facesOverlap,matchingFaces,SLIM_DIAMETER} from '../shared/attachment.ts';
import {resolveAssemblyPlacement,placeAssembly,connectedIds} from '../shared/assembly.ts';
import {starterCraft,validateCraft,launchIssues,surfaceRadius} from '../shared/craft.ts';
import {Box3,Vector3} from 'three';
import {makePart} from '../src/scene.ts';
import {makeFaceGuide} from '../src/attachment-guides.ts';

const craft=(type='tank')=>({name:'Faces',assemblyVersion:1,rootId:'root',parts:[{id:'root',type,parent:null,position:[4,0,0]}]});
test('the pod small face and motor use the same slim standard; radial parts have no stack face',()=>{
  assert.equal(attachmentFace('linear',1).diameter,SLIM_DIAMETER);
  assert.ok(matchingFaces(attachmentFace('pod',1),attachmentFace('linear',-1)));
  assert.ok(!matchingFaces(attachmentFace('pod',-1),attachmentFace('linear',1)));
  assert.equal(attachmentFace('rcs',1),null);
});
test('overlapping end faces snap without a ray hit or close centers',()=>{
  const draft=craft(),placement=resolveAssemblyPlacement(draft,'battery',null,{point:[5.41,1.05,0]});
  assert.equal(placement.kind,'stack');assert.equal(placement.parent,'root');assert.equal(placement.side,1);
  assert.deepEqual(placement.position,[5.36,0,0]);
  assert.equal(connectedIds(placeAssembly(draft,'battery',placement)).size,2);
  assert.equal(resolveAssemblyPlacement(draft,'battery',null,{point:[5.41,1.05,0],snap:false}).kind,'free');
});
test('proximity requires both approaching face planes and cross-section overlap',()=>{
  assert.equal(resolveAssemblyPlacement(craft(),'battery',null,{point:[5.7,1.05,0]}).kind,'free');
  assert.equal(resolveAssemblyPlacement(craft(),'battery',null,{point:[5.36,1.5,0]}).kind,'free');
});
test('different standards still connect, and an unrelated ray hit does not mask face overlap',()=>{
  const draft=craft('pod');draft.parts.push({id:'parked',type:'tank',parent:null,position:[9,5,0]});
  const placement=resolveAssemblyPlacement(draft,'battery',{id:'parked',point:[9,5.62,0],normal:[0,1,0]},{point:[4.8,.7,0]});
  assert.equal(placement.kind,'stack');assert.equal(placement.parent,'root');assert.equal(placement.side,1);
});
test('occupied faces and moving descendants cannot capture overlapping faces',()=>{
  let draft=craft();draft=placeAssembly(draft,'battery',resolveAssemblyPlacement(draft,'battery',null,{point:[5.36,0,0]}));
  assert.equal(resolveAssemblyPlacement(draft,'tank',null,{point:[6.4,1.1,0]}).kind,'free');
  const battery=draft.parts.at(-1);draft.parts.push({id:'child',type:'tank',parent:battery.id,position:[8,0,0]});
  assert.equal(resolveAssemblyPlacement(draft,'battery',null,{movingId:battery.id,point:[9.36,1,0]}).kind,'free');
});
test('profile intersections handle rectangle corners without circular bounding-box false positives',()=>{
  const rectangle={shape:'rectangle',width:1.8,depth:.45},circle={shape:'circle',diameter:.5};
  assert.equal(facesOverlap(rectangle,circle,1.1,.4),false);
  assert.equal(facesOverlap(rectangle,circle,1.05,.35),true);
  assert.equal(facesOverlap(circle,rectangle,1.05,.35),true);
  assert.equal(facesOverlap(rectangle,rectangle,1.7,.44),true);
  assert.equal(facesOverlap(rectangle,rectangle,0,.6),false);
});
test('parts above the pod retain a valid saveable and launchable craft',()=>{
  const draft=starterCraft();draft.parts.unshift({id:'nose_motor',type:'linear'});draft.rootId='pod_1';
  assert.deepEqual(validateCraft(draft),draft);assert.deepEqual(launchIssues(draft),[]);
  draft.parts.push({id:'second_pod',type:'pod'});assert.throws(()=>validateCraft(draft));
});
test('slim flange geometry and pod tip match the advertised interface',()=>{
  const motor=makePart('linear'),bounds=new Box3().setFromObject(motor).getSize(new Vector3());
  assert.ok(Math.abs(bounds.x-SLIM_DIAMETER)<1e-7);assert.ok(Math.abs(bounds.z-SLIM_DIAMETER)<1e-7);
  assert.ok(Math.abs(surfaceRadius('pod',.5)*2-SLIM_DIAMETER)<1e-7);
  const pod=makePart('pod',false),top=pod.children.find(mesh=>Math.abs(mesh.position.y-.565)<1e-9);
  assert.equal(top.geometry.parameters.radiusTop,SLIM_DIAMETER/2);
  assert.ok(Math.abs(top.position.y+top.geometry.parameters.height/2-.625)<1e-7);
});
test('guides follow circular and rectangular profiles and retain their standard color',()=>{
  for(const type of ['linear','tank','chassis']){
    const profile=attachmentFace(type,1),guide=makeFaceGuide(profile),size=new Box3().setFromObject(guide).getSize(new Vector3());
    const width=profile.shape==='circle'?profile.diameter:profile.width,depth=profile.shape==='circle'?profile.diameter:profile.depth;
    assert.ok(Math.abs(size.x-width)<.03);assert.ok(Math.abs(size.z-depth)<.03);
    assert.equal(guide.material.toneMapped,false);assert.equal(guide.material.depthWrite,false);
  }
});
