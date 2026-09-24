import test from 'node:test';
import assert from 'node:assert/strict';
import {guidance,DemoController} from '../examples/demo-controller.js';
import {Simulation,STEP} from '../server/physics.js';
import {PylonProtocol} from '../server/protocol.js';
import {starterCraft,twoStageCraft} from '../shared/craft.js';

test('standalone demo waits without an app lifecycle and ignores malformed datagrams',()=>{
  const demo=new DemoController();
  Object.assign(demo,{running:true,started:performance.now()/1000-60});
  for(const value of ['bad json','null','{}'])demo.receive(Buffer.from(value));
  demo.tick();assert.equal(demo.running,true);
});

test('lost telemetry stops the controller even before actuator discovery completes',()=>{
  const demo=new DemoController();let reason;
  Object.assign(demo,{running:true,session:{},lastHeartbeat:performance.now()/1000-2,lastFlight:performance.now()/1000});
  demo.stop=value=>{reason=value;};demo.tick();assert.equal(reason,'テレメトリが途絶えました');
});

test('preempted demo sends no stale shutdown commands to the new owner',()=>{
  const demo=new DemoController();let sent=0;
  Object.assign(demo,{running:true,acquired:true,lease:'demo',authority:{state:1,leaseId:'external'}});
  demo.send=()=>sent++;demo.stop('制御権が移りました');assert.equal(sent,0);assert.equal(demo.running,false);
});

test('demo reaches space through PyLoN commands and latches its engine cutoff',()=>{
  const sim=new Simulation(starterCraft()),protocol=new PylonProtocol(sim,()=>sim.time),state={};
  protocol.available=true;let sequence=0,throttleTest=false,rcsTest=false,cutoff=false;
  const send=(type,fields)=>{
    const packet={type,...protocol.fields(),controllerId:'test-demo',leaseId:'test-lease',sequence:++sequence,...fields};
    protocol.receive(Buffer.from(JSON.stringify(packet)));assert.equal(protocol.rejected,0,protocol.lastCommand?.reason);
  };
  send('pylon_control_authority_command',{action:'acquire',priority:1,leaseDurationSeconds:2,suppressSas:true});
  for(let i=0;i<180/STEP;i++){
    if(i%6===0){
      if(i%120===0)send('pylon_control_authority_command',{action:'renew',priority:1,leaseDurationSeconds:2,suppressSas:true});
      const f=protocol.telemetry().find(p=>p.type==='pylon_flight_state'),c=guidance(f,sim.time,state);
      send('pylon_flight_control_command',{pitch:c.pitch,yaw:c.yaw,roll:c.roll,landingGear:false,timeoutSeconds:.4});
      send('pylon_actuator_command',{actuatorType:'engine',name:'engine_1',enabled:c.thrust>0,targetThrust:c.thrust,timeoutSeconds:.4});
      for(const name of Object.keys(sim.rcs))send('pylon_actuator_command',{actuatorType:'rcs',name,enabled:c.rcs,thrustLimit:250,timeoutSeconds:.4});
      // Parts are discoverable even before the first command creates actuator state.
      for(const p of sim.craft.parts.filter(p=>p.type==='rcs'&&!sim.rcs[p.id]))send('pylon_actuator_command',{actuatorType:'rcs',name:p.id,enabled:c.rcs,thrustLimit:250,timeoutSeconds:.4});
      throttleTest||=c.thrust===45000;rcsTest||=c.rcs;cutoff||=c.thrust===0;
      if(cutoff)assert.equal(c.thrust,0,'cutoff must remain latched');
    }
    sim.step(STEP);
  }
  const result=sim.snapshot();assert.equal(result.status,'flying');assert.ok(result.altitude>100000,`altitude ${result.altitude}`);
  assert.ok(throttleTest&&rcsTest&&cutoff);assert.ok(sim.mono<32);assert.ok(sim.charge>0);
  const f=protocol.telemetry().find(p=>p.type==='pylon_flight_state');f.apoapsis=10000;
  assert.equal(guidance(f,200,state).thrust,0);
});

async function controlledDemo(t,craft=twoStageCraft()){
  let timeScale=1;
  const sim=new Simulation(craft),clock=()=>sim.time/timeScale,protocol=new PylonProtocol(sim,clock),demo=new DemoController({telemetryPort:0});
  protocol.available=true;
  demo.running=true;
  t.after(()=>demo.stop());
  const commands=[];
  demo.send=(type,fields)=>{
    commands.push({time:sim.time,separations:sim.separations.length,fuel:{...sim.tankFuel},alignment:demo.flight?.upBody[0],type,...fields});
    if(type==='pylon_actuator_command'&&fields.actuatorType==='engine'&&fields.enabled){
      assert.ok(demo.engineStates[fields.name]?.available,'Only exposed engines may receive ignition commands');
    }
    const packet={type,...protocol.fields(),controllerId:demo.controller,leaseId:demo.lease,sequence:++demo.sequence,...fields};
    const response=protocol.receive(Buffer.from(JSON.stringify(packet)));
    assert.equal(protocol.rejected,0,response.reason);
    demo.receive(Buffer.from(JSON.stringify(response)));
  };
  const receive=p=>demo.receive(Buffer.from(JSON.stringify(p)));
  const observe=()=>{const packets=protocol.telemetry();for(const p of packets)receive(p);return packets;};
  const drive=(seconds,scale=1)=>{
    timeScale=scale;protocol.timeScale=scale;
    for(let i=0;i<seconds/STEP;i++){
      if(i%(6*timeScale)===0){
        observe();
        // Renew on simulated time; the real client renews against its wall clock.
        if(i%120===0&&demo.acquired)demo.leaseCommand('renew');
        demo.tick();
      }
      sim.step(STEP,clock());
    }
  };
  return {sim,protocol,demo,commands,receive,observe,drive};
}

test('two-stage demo burns only the lower engine, confirms separation and then ignites the upper engine',async t=>{
  const {sim,demo,commands,drive}=await controlledDemo(t);
  drive(180);
  const ignition=commands.find(c=>c.name==='upper_engine'&&c.enabled);
  assert.equal(sim.separations.length,1);assert.ok(ignition);assert.equal(ignition.separations,1);
  assert.ok(ignition.time-sim.separations[0].time>=.8,'Wait for separation confirmation and stage clearance before upper ignition');
  assert.equal(commands.filter(c=>c.actuatorType==='separation').length,1);
  assert.equal(sim.status,'flying');assert.ok(sim.maxAltitude>100000);
  assert.ok(sim.debris[0].fuel<.001);assert.ok(sim.fuel<1200);
  assert.equal(sim.craft.parts.filter(p=>p.type==='fin').length,4,'Upper stage retains its own stabilizing fins');
  assert.equal(demo.snapshot().stage,2);assert.equal(demo.snapshot().stageCount,2);
  assert.equal(demo.events.filter(e=>e.text.includes('段 点火')).length,2);
  assert.equal(demo.events.filter(e=>e.text.includes('分離確認')).length,1);
  const cutoff=demo.events.find(e=>e.text.includes('推力停止'));assert.ok(cutoff);
  assert.equal(demo.command.thrust,0,'Upper-stage cutoff stays latched');
});

for(const scale of [2,5,10])test(`two-stage guidance remains stable with telemetry and control at ${scale}x simulation speed`,async t=>{
  const {sim,demo,commands,drive}=await controlledDemo(t);
  drive(180,scale);
  assert.equal(sim.separations.length,1);assert.equal(demo.stage,2);
  assert.ok(sim.maxAltitude>100000,`max altitude ${sim.maxAltitude}; ${demo.phase}`);
  const tilted=commands.find(c=>c.actuatorType==='engine'&&c.enabled&&c.separations===1&&c.alignment<=.9);
  assert.ok(!tilted,`Upper-stage thrust must stay directed upward: ${JSON.stringify(tilted)}`);
  assert.equal(demo.command.thrust,0);
});

test('single-stage vehicles still complete the standalone demo without a separation command',async t=>{
  const {sim,demo,commands,drive}=await controlledDemo(t,starterCraft());
  drive(180);
  assert.ok(sim.maxAltitude>100000);assert.equal(demo.command.thrust,0);
  assert.equal(demo.stageCount,1);assert.ok(!commands.some(c=>c.actuatorType==='separation'));
});

test('three-stage demo separates bottom-up and keeps each upper tank reserved until its ignition',async t=>{
  const craft=twoStageCraft();
  craft.parts.splice(5,0,{id:'middle_tank',type:'tank'},{id:'middle_engine',type:'engine'},{id:'bottom_separator',type:'decoupler'});
  const {sim,demo,commands,drive}=await controlledDemo(t,craft);
  sim.tankFuel.tank_2=20;sim.tankFuel.middle_tank=25;sim.status='flying';sim.position[0]+=10000;
  drive(12);
  assert.deepEqual(sim.separations.map(s=>s.id),['bottom_separator','separator_1'],JSON.stringify({phase:demo.phase,status:sim.status,fuel:sim.tankFuel,events:demo.events}));
  assert.deepEqual(commands.filter(c=>c.actuatorType==='separation').map(c=>c.name),['bottom_separator','separator_1']);
  for(const [name,count] of [['engine_1',0],['middle_engine',1],['upper_engine',2]]){
    assert.equal(commands.find(c=>c.name===name&&c.enabled)?.separations,count);
  }
  assert.equal(commands.find(c=>c.name==='middle_engine'&&c.enabled).fuel.middle_tank,25);
  assert.equal(commands.find(c=>c.name==='upper_engine'&&c.enabled).fuel.tank_1,1200);
  assert.equal(demo.stage,3);assert.equal(demo.stageCount,3);assert.ok(sim.fuel<1200);
});

test('partial, delayed and reordered telemetry cannot bypass separation confirmation or the ignition delay',async t=>{
  const {sim,protocol,demo,commands,receive,observe,drive}=await controlledDemo(t);
  sim.status='flying';sim.position[0]+=10000;sim.tankFuel.tank_2=0;
  observe();demo.tick();const before=observe();demo.tick();
  assert.equal(sim.separations.length,1);assert.equal(demo.stage,1);
  const after=sim.fuel;assert.equal(after,1200,'Upper tank is untouched at separation');
  const partial=protocol.telemetry().filter(p=>p.type!=='pylon_control_snapshot');
  for(const p of partial)receive(p);
  demo.tick();assert.equal(demo.stage,1);assert.equal(demo.command.thrust,0);
  assert.ok(!commands.some(c=>c.name==='upper_engine'&&c.enabled));
  observe();demo.tick();assert.equal(demo.stage,2);assert.equal(demo.command.thrust,0);
  for(const p of before.toReversed())receive(p);
  drive(2);
  assert.ok(commands.some(c=>c.name==='upper_engine'&&c.enabled));
  assert.equal(sim.separations.length,1);assert.equal(demo.stage,2);
});

test('unconfirmed separation stops and releases control without igniting an upper engine',async t=>{
  const {sim,protocol,demo,commands,observe}=await controlledDemo(t);
  sim.status='flying';sim.tankFuel.tank_2=0;
  observe();demo.tick();observe();demo.tick();assert.ok(demo.pendingSeparation);
  demo.pendingSeparation.started-=6;
  demo.tick();
  assert.equal(demo.running,false);assert.match(demo.phase,/確認できません/);
  assert.equal(protocol.owner.state,0);assert.equal(demo.command.thrust,0);
  assert.ok(!commands.some(c=>c.name==='upper_engine'&&c.enabled));
});

test('a lost separation command is retried until confirmed and never drops another stage',async t=>{
  const {sim,demo,observe,drive}=await controlledDemo(t);
  sim.status='flying';sim.position[0]+=10000;sim.tankFuel.tank_2=0;
  const send=demo.send;let attempts=0;
  demo.send=(type,fields)=>{
    if(fields.actuatorType==='separation'&&++attempts===1)return;
    send(type,fields);
  };
  observe();demo.tick();observe();demo.tick();
  assert.equal(attempts,1);assert.equal(sim.separations.length,0);
  demo.pendingSeparation.lastSent-=1;demo.tick();
  assert.equal(attempts,2);assert.equal(sim.separations.length,1);
  drive(2);assert.equal(attempts,2);assert.equal(demo.stage,2);assert.ok(sim.last.thrust>0);
});
