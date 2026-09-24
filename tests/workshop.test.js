import test from 'node:test';
import assert from 'node:assert/strict';
import {starterCraft,craftStats,validateCraft,PARTS} from '../shared/craft.ts';
import {emptyAssembly,toAssembly,restoreAssembly,assembledCraft,assemblyStats,assemblyLayout,connectedIds,movingIds,placeAssembly,resolveAssemblyPlacement,removeAssembly} from '../shared/assembly.ts';

const point=(craft,id)=>craft.parts.find(p=>p.id===id).position;
const shift=(v,d)=>v.map((n,i)=>n+d[i]);
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} != ${b}`));
const free=(position)=>({kind:'free',position,snapped:false});
test('an empty workshop has zero stats; its first placed part becomes the root',()=>{
  const empty=emptyAssembly();assert.equal(assemblyStats(empty).mass,0);assert.equal(assemblyStats(empty).twr,0);
  const placed=placeAssembly(empty,'tank',resolveAssemblyPlacement(empty,'tank',null,{point:[5,2,0]}));
  assert.equal(placed.rootId,placed.parts[0].id);assert.deepEqual([...connectedIds(placed)],[placed.rootId]);
  assert.equal(assemblyStats(placed).mass,1290);assert.equal(empty.parts.length,0);
});
test('legacy craft conversion preserves flight layout and physics',()=>{
  const original=starterCraft(),draft=toAssembly(original);
  assert.equal(draft.rootId,'pod_1');assert.equal(draft.parts.find(p=>p.id==='tank_2').parent,'tank_1');
  assert.deepEqual(assembledCraft(draft),original);assert.deepEqual(assemblyStats(draft),craftStats(original));
});
test('detaching a middle part moves every descendant and excludes the whole branch from the vehicle',()=>{
  const original=toAssembly(starterCraft()),ids=movingIds(original,'tank_1'),delta=[1,4,2];
  assert.equal(ids.size,11);
  const moved=placeAssembly(original,'tank',free(shift(point(original,'tank_1'),delta)),{movingId:'tank_1'});
  for(const p of moved.parts)near(p.position,ids.has(p.id)?shift(point(original,p.id),delta):point(original,p.id));
  assert.equal(moved.parts.find(p=>p.id==='tank_1').parent,null);
  assert.equal(moved.parts.find(p=>p.id==='tank_2').parent,'tank_1');
  assert.equal(assemblyLayout(moved).filter(p=>!p.connected).length,11);
  assert.equal(assembledCraft(moved).parts.length,2);assert.equal(assemblyStats(moved).mass,255);
  assert.equal(assemblyStats(moved).fuel,0);assert.equal(assemblyStats(moved).thrust,0);assert.equal(assemblyStats(moved).deltaV,0);
  assert.doesNotThrow(()=>validateCraft(assembledCraft(moved)));
  // Taking another subtree from the loose branch must keep all its children loose.
  const split=placeAssembly(moved,'tank',free([2,8,0]),{movingId:'tank_2'});
  assert.equal(assemblyLayout(split).filter(p=>!p.connected).length,11);
  assert.equal(assemblyStats(split).mass,255);
});
test('a detached branch reconnects with all descendants and restores the original stats',()=>{
  const initial=toAssembly(starterCraft()),detached=placeAssembly(initial,'tank',free([6,4,0]),{movingId:'tank_1'});
  const placement=resolveAssemblyPlacement(detached,'tank',null,{point:point(initial,'tank_1'),movingId:'tank_1'});
  assert.equal(placement.parent,'battery_1');assert.equal(placement.kind,'stack');
  const joined=placeAssembly(detached,'tank',placement,{movingId:'tank_1'});
  assert.equal(connectedIds(joined).size,13);assert.deepEqual(assemblyStats(joined),assemblyStats(initial));
  for(const p of joined.parts)near(p.position,point(initial,p.id));
});
test('moving the root translates only its connected tree, leaving parked parts alone',()=>{
  const initial=toAssembly(starterCraft()),loose=placeAssembly(initial,'tank',free([3,5,0]),{movingId:'tank_2'});
  const delta=[4,-2,1],position=shift(point(loose,'pod_1'),delta);
  const placement=resolveAssemblyPlacement(loose,'pod',null,{point:position,movingId:'pod_1'});
  const moved=placeAssembly(loose,'pod',placement,{movingId:'pod_1'}),ids=connectedIds(loose);
  assert.equal(moved.rootId,'pod_1');assert.equal(connectedIds(moved).size,ids.size);
  for(const p of moved.parts)near(p.position,ids.has(p.id)?shift(point(loose,p.id),delta):point(loose,p.id));
});
test('occupied mating faces and descendants are not snap targets; Alt leaves the branch free',()=>{
  const draft=toAssembly(starterCraft()),tank=draft.parts.find(p=>p.id==='tank_1');
  const hit={id:tank.id,point:[tank.position[0]-PARTS.tank.height/2,0,0]};
  assert.equal(resolveAssemblyPlacement(draft,'battery',hit).kind,'free');
  assert.equal(resolveAssemblyPlacement(draft,'tank',hit,{movingId:'battery_1',point:[6,8,0]}).kind,'free');
  const loose=placeAssembly(draft,'tank',free([6,4,0]),{movingId:'tank_1'});
  assert.equal(resolveAssemblyPlacement(loose,'tank',null,{point:tank.position,movingId:tank.id,snap:false}).kind,'free');
  const parked=placeAssembly(loose,'tank',free(tank.position),{movingId:tank.id});
  assert.equal(resolveAssemblyPlacement(parked,'tank',null,{point:tank.position,movingId:tank.id}).parent,'battery_1');
});
test('parts attached to a loose parent remain excluded until that parent reconnects',()=>{
  const initial=toAssembly(starterCraft()),loose=placeAssembly(initial,'tank',free([6,4,2]),{movingId:'tank_1'});
  const hit={id:'tank_1',point:[6,4.615,2],normal:[0,1,0]};
  const placement=resolveAssemblyPlacement(loose,'solar',hit);
  const added=placeAssembly(loose,'solar',placement,{count:2,mirror:true});
  const panels=added.parts.filter(p=>p.type==='solar');assert.equal(panels.length,2);
  assert.equal(connectedIds(added).size,2);assert.equal(assemblyStats(added).mass,255);
  near(panels[0].position,[6,4.615,2]);near(panels[1].position,[6,3.385,2]);
  const joined=placeAssembly(added,'tank',resolveAssemblyPlacement(added,'tank',null,{point:point(initial,'tank_1'),movingId:'tank_1'}),{movingId:'tank_1'});
  assert.equal(connectedIds(joined).size,15);assert.equal(assemblyStats(joined).mass,assemblyStats(initial).mass+16);
});
test('symmetry groups detach together and keep spacing while moving through empty space',()=>{
  const initial=toAssembly(starterCraft()),delta=[1,4,2];
  const loose=placeAssembly(initial,'fin',free(shift(point(initial,'fin_2'),delta)),{movingId:'fin_2'});
  for(const p of loose.parts.filter(p=>p.type==='fin')){assert.equal(p.parent,null);near(p.position,shift(point(initial,p.id),delta));}
  assert.equal(connectedIds(loose).size,9);
  const placement=resolveAssemblyPlacement(loose,'fin',{id:'tank_1',point:[point(loose,'tank_1')[0],.615,0],normal:[0,1,0]},{movingId:'fin_2'});
  const joined=placeAssembly(loose,'fin',placement,{movingId:'fin_2'});
  assert.equal(connectedIds(joined).size,13);
  assert.ok(joined.parts.filter(p=>p.type==='fin').every(p=>p.parent==='tank_1'));
});
test('root can begin at a tank and accept a pod above it without changing its identity',()=>{
  let draft=placeAssembly(emptyAssembly(),'tank',{kind:'root',position:[4,0,0]});
  const root=draft.rootId;
  draft=placeAssembly(draft,'pod',resolveAssemblyPlacement(draft,'pod',null,{point:[5.825,0,0]}));
  assert.equal(draft.rootId,root);assert.equal(connectedIds(draft).size,2);
  assert.equal(assembledCraft(draft).parts[0].type,'pod');assert.doesNotThrow(()=>validateCraft(assembledCraft(draft)));
  const reopened=toAssembly(validateCraft(assembledCraft(draft)));
  assert.equal(reopened.rootId,root);assert.equal(reopened.parts.find(p=>p.type==='pod').parent,root);
});
test('adding below the floor lifts the connected vehicle without moving a parked branch',()=>{
  const initial=toAssembly(starterCraft()),loose=placeAssembly(initial,'fin',free([2,4,0]),{movingId:'fin_1'});
  const placement=resolveAssemblyPlacement(loose,'decoupler',null,{point:[-.11,0,0]});
  assert.equal(placement.parent,'engine_1');
  const added=placeAssembly(loose,'decoupler',placement);
  assert.equal(added.parts.at(-1).position[0],.11);
  near(point(added,'pod_1'),shift(point(initial,'pod_1'),[.22,0,0]));
  near(point(added,'fin_1'),point(loose,'fin_1'));
});
test('draft round trips preserve parked branches, and subtree deletion leaves other roots intact',()=>{
  const initial=toAssembly(starterCraft()),loose=placeAssembly(initial,'tank',free([5,4,0]),{movingId:'tank_2'});
  assert.deepEqual(restoreAssembly(JSON.parse(JSON.stringify(loose))),loose);
  const deleted=removeAssembly(loose,'tank_1');
  assert.equal(deleted.parts.length,8);assert.ok(deleted.parts.some(p=>p.id==='engine_1'));
  assert.equal(connectedIds(deleted).size,2);
  const bad=structuredClone(loose);bad.parts.find(p=>p.id==='tank_1').parent='rcs_1';
  assert.throws(()=>restoreAssembly(bad));
});
