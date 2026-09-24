import test from 'node:test';
import assert from 'node:assert/strict';
import {starterCraft,layoutCraft,validateCraft,craftStats,symmetryAngles,surfaceRadius} from '../shared/craft.ts';
import {resolvePlacement,placementParts} from '../shared/placement.ts';

const craft=starterCraft(),tank=layoutCraft(craft).find(p=>p.id==='tank_1');
const hit=(offset,angle)=>({id:tank.id,point:[tank.position[0]+offset*tank.def.height,Math.cos(angle)*.615,Math.sin(angle)*.615],normal:[0,Math.cos(angle),Math.sin(angle)]});
test('surface placement preserves a free drop position, instead of centering on the parent',()=>{
  const p=resolvePlacement(craft,'fin',hit(.21,.37));
  assert.equal(p.parent,tank.id);assert.ok(Math.abs(p.offset-.21)<1e-12);assert.ok(Math.abs(p.angle-.37)<1e-12);assert.equal(p.snapped,false);
});
test('snap engages only near a point and can be disabled',()=>{
  const h=hit(.018,Math.PI/4+.035),snap=resolvePlacement(craft,'rcs',h),free=resolvePlacement(craft,'rcs',h,{snap:false});
  assert.equal(snap.offset,0);assert.equal(snap.angle,Math.PI/4);assert.equal(snap.snapped,true);
  assert.equal(free.snapped,false);assert.ok(Math.abs(free.offset-.018)<1e-12);
  assert.equal(resolvePlacement(craft,'rcs',hit(.20,Math.PI/4)).snapped,false);
  assert.equal(resolvePlacement(craft,'rcs',hit(.4,Math.PI*2-.02)).angle,0);
});
test('empty-space drops and radial attachment to end faces are rejected',()=>{
  assert.equal(resolvePlacement(craft,'fin',null),null);
  assert.equal(resolvePlacement(craft,'fin',{...hit(.5,0),normal:[1,0,0]}),null);
  assert.equal(resolvePlacement(craft,'fin',{...hit(0,0),id:'engine_1'}),null);
});
test('preview and saved surface layout agree for arbitrary mirrored positions',()=>{
  const placement=resolvePlacement(craft,'solar',hit(-.13,.38)),angles=symmetryAngles(placement.angle,2,true);
  assert.equal(angles[1],Math.PI-angles[0]);
  const preview=placementParts(craft,'solar',placement,angles).filter(p=>p.id.startsWith('preview_'));
  const saved=validateCraft({...craft,parts:[...craft.parts,...preview]});
  assert.deepEqual(layoutCraft(saved).slice(-2).map(p=>p.position),preview.map(p=>p.position));
  assert.ok(Math.abs(preview[0].position[1]+preview[1].position[1])<1e-12);
  assert.ok(Math.abs(Math.hypot(...preview[0].position.slice(1))-surfaceRadius('tank',placement.offset))<1e-12);
});
test('axial drops use the closest mating face and preview the resulting stack gap',()=>{
  const p=resolvePlacement(craft,'decoupler',hit(-.4,0));
  const layout=placementParts(craft,'decoupler',p,[0]);
  assert.equal(p.index,3);assert.equal(p.side,'bottom');
  const ghost=layout.find(p=>p.id==='preview_0'),parent=layout.find(p=>p.id===tank.id);
  assert.ok(Math.abs(parent.position[0]-parent.def.height/2-ghost.position[0]-ghost.def.height/2)<1e-12);
});
test('multiple engines require a separating ring and launch thrust counts only the lowest stage',()=>{
  const staged=starterCraft();staged.parts.splice(3,0,{id:'upper',type:'engine'},{id:'separator',type:'decoupler'});
  assert.doesNotThrow(()=>validateCraft(staged));assert.equal(craftStats(staged).thrust,60000);assert.equal(craftStats(staged).stageCount,2);
  staged.parts=staged.parts.filter(p=>p.id!=='separator');assert.throws(()=>validateCraft(staged));
});
