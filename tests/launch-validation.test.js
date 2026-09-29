import test from 'node:test';
import assert from 'node:assert/strict';
import {launchIssues,validateCraft,roverCraft,splitCraft} from '../shared/craft.ts';
import {Simulation} from '../server/physics.ts';

const craft=(...types)=>({name:'Launch experiment',parts:types.map((type,i)=>({id:`part_${i}`,type}))});
const rover=wheelCount=>{
  const value=roverCraft();let kept=0;
  value.parts=value.parts.filter(p=>p.type!=='wheel'||kept++<wheelCount);
  return value;
};
const designs={
  'pod only':craft('pod'),
  'no engine':craft('pod','tank'),
  'no fuel':craft('pod','engine'),
  'engine above pod and tank':craft('engine','pod','tank'),
  'multiple engines without separators':craft('pod','engine','tank','engine'),
  'thrust-to-weight ratio below one':craft('pod',...Array(8).fill('tank'),'engine'),
  'unpowered bottom stage':craft('pod','tank','engine','decoupler','battery'),
  'separator at top':craft('decoupler','pod'),
  'separator at bottom':craft('pod','decoupler'),
  'one wheel':rover(1),
  'two wheels':rover(2),
};
for(const [name,value] of Object.entries(designs))test(`flight accepts ${name} and physics remains finite`,()=>{
  assert.deepEqual(launchIssues(value),[]);
  const sim=new Simulation(validateCraft(value));
  for(let i=0;i<120;i++)sim.step();
  assert.ok([...sim.position,...sim.velocity,...sim.quaternion].every(Number.isFinite));
});
test('flight still requires one command pod and valid craft data',()=>{
  for(const value of [craft(),craft('tank'),craft('pod','pod'),
    {name:'Duplicate',parts:[{id:'pod',type:'pod'},{id:'pod',type:'tank'}]},
    {name:'Disconnected',parts:[{id:'pod',type:'pod'},{id:'fin',type:'fin',parent:'missing',offset:0,angle:0}]}]){
    assert.ok(launchIssues(value).length>0);
  }
});
test('allowing placement does not make an unusable separator operable',()=>{
  const value=craft('pod','decoupler');
  assert.deepEqual(launchIssues(value),[]);
  assert.throws(()=>splitCraft(value,'part_1'),/分離リングの下/);
});
