import test from 'node:test';
import assert from 'node:assert/strict';
import {pathfinder3Craft,craftStats,launchIssues,validateCraft,PARTS,G0,splitCraft} from '../shared/craft.ts';
import {Simulation} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';

test('Pathfinder3 is a valid orbital launcher with sufficient thrust and staged delta-v',()=>{
 const craft=validateCraft(pathfinder3Craft()),s=craftStats(craft);
 assert.deepEqual(launchIssues(craft),[]);assert.equal(s.stageCount,2);
 assert.ok(s.twr>2&&s.twr<3);assert.ok(s.deltaV>10000);
 const upper=splitCraft(craft,'stage_separator').retained;
 assert.equal(upper.parts.filter(p=>p.type==='tank').length,3);
 assert.ok(upper.parts.some(p=>p.type==='vacuum_engine'));
 assert.equal(craftStats(upper).fuel,3600);
});
test('engine variants use their own thrust and Isp while preserving the public engine protocol',()=>{
 for(const type of ['engine','booster_engine','vacuum_engine']){
  const craft={name:type,parts:[{id:'pod',type:'pod'},{id:'tank',type:'tank'},{id:'custom_name',type}]};
  const sim=new Simulation(craft),protocol=new PylonProtocol(sim,()=>0);protocol.available=true;
  const common={version:1,...protocol.fields(),controllerId:'test',leaseId:'lease'};
  protocol.receive(Buffer.from(JSON.stringify({...common,type:'pylon_control_authority_command',sequence:1,action:'acquire',priority:1,leaseDurationSeconds:2,suppressSas:true})));
  protocol.receive(Buffer.from(JSON.stringify({...common,type:'pylon_actuator_command',actuatorType:'engine',name:'custom_name',sequence:2,enabled:true,targetThrust:1e6,timeoutSeconds:1})));
  assert.equal(protocol.rejected,0);
  const initial=sim.fuel,a=sim.actuation(0,.01),definition=PARTS[type];
  assert.ok(Math.abs(a.thrust-definition.thrust)<100);
  assert.ok(Math.abs(initial-sim.fuel-a.thrust/(definition.isp*G0)*.01)<.001);
  const manifest=protocol.telemetry().find(p=>p.type==='pylon_actuator_manifest');
  assert.deepEqual(manifest.actuators,[{name:'custom_name',actuatorType:'engine',partId:'custom_name'}]);
 }
});
