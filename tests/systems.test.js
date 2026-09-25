import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Simulation,EARTH} from '../server/physics.ts';
import {PylonProtocol} from '../server/protocol.ts';
import {roverCraft,twoStageCraft,validateCraft} from '../shared/craft.ts';
import {add,mul,rotate,axisAngle} from '../shared/math.ts';
import {sensorPose,raySphere} from '../server/sensors.ts';
import {advanceThermals} from '../server/thermal.ts';
const withSensors=()=>{const c=roverCraft();for(const type of ['lidar2d','lidar3d','camera','startracker'])c.parts.push({id:type,type,parent:'chassis_1',angle:0,offset:0});return validateCraft(c);};
function protocol(sim){const p=new PylonProtocol(sim,()=>sim.time);p.available=true;return p;}

test('mounted lidar scans hit another vessel at measured distances and reconstruct hemisphere rays',()=>{
  const s=new Simulation(withSensors()),p=protocol(s),target=new Simulation({name:'target',parts:[{id:'pod',type:'pod'}]});
  const pose=sensorPose(s,s.props.parts.find(p=>p.type==='lidar2d'));
  target.position=add(pose.origin,rotate(pose.rotation,[10,0,0]));target.quaternion=[0,0,0,1];
  s.environmentBodies=()=>[s,target];
  const scan=p.telemetry().find(v=>v.type==='pylon_lidar_scan'&&v.mode==='2D');
  assert.equal(scan.ranges.length,360);assert.ok(scan.ranges[180]>8&&scan.ranges[180]<10);
  target.position=add(target.position,rotate(pose.rotation,[5,0,0]));s.time=.3;
  const next=p.telemetry(),moved=next.find(v=>v.type==='pylon_lidar_scan'&&v.mode==='2D');
  assert.ok(Math.abs(moved.ranges[180]-scan.ranges[180]-5)<1e-7);
  const cloud=next.find(v=>v.type==='pylon_lidar_scan'&&v.mode==='3D');assert.equal(cloud.layout,'fibonacci-hemisphere');assert.equal(cloud.ranges.length,512);
  assert.ok(cloud.ranges.some(v=>v!==null));assert.equal(raySphere([0,0,0],[1,0,0],[10,0,0],1),9);
  assert.ok(!p.telemetry().some(v=>v.type==='pylon_lidar_scan'),'no duplicate sample at unchanged physics time');
});

test('RGB frames contain real raycast pixels, intrinsics metadata, and a matching checksum',()=>{
  const s=new Simulation(withSensors()),p=protocol(s),packets=p.telemetry();
  const frame=packets.find(v=>v.type==='pylon_camera_frame_chunk'),bytes=Buffer.from(frame.data,'base64');
  assert.equal(bytes.length,64*48*3);assert.equal(frame.step,192);assert.equal(frame.verticalFovDeg,60);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),frame.sha256);
  assert.ok(new Set(bytes).size>3,'ground and sky have different RGB pixels');
  assert.ok(Buffer.byteLength(JSON.stringify(frame))<60000);
  s.charge=0;s.time=.3;const unpowered=p.telemetry();assert.ok(!unpowered.some(v=>v.type==='pylon_camera_frame_chunk'||v.type==='pylon_lidar_scan'));
  const star=unpowered.find(v=>v.type==='pylon_star_tracker');assert.equal(star.reason,'no_power');assert.equal(star.orientation,null);
});

test('star tracker loses lock in atmosphere and on slew, then reacquires with bounded noise',()=>{
  const s=new Simulation(withSensors()),p=protocol(s),read=()=>p.telemetry().find(v=>v.type==='pylon_star_tracker');
  assert.equal(read().reason,'atmosphere');
  s.position=[EARTH.radius+300000,0,0];s.quaternion=[0,0,0,1];s.omega=[0,0,0];s.time=.3;
  assert.equal(read().reason,'acquiring');s.time=1.4;
  const good=read();assert.equal(good.reason,'tracking');assert.ok(Math.abs(Math.hypot(...good.orientation)-1)<1e-10);assert.notDeepEqual(good.orientation,s.quaternion);
  s.time=1.7;s.omega=[1,0,0];assert.equal(read().reason,'slew_rate_exceeded');
  s.time=2;s.omega=[0,0,0];assert.equal(read().reason,'acquiring');
});

test('URDF proxy is checksummed, maps sensor IDs, and follows topology changes',()=>{
  const s=new Simulation(withSensors()),p=protocol(s),packets=p.telemetry(),model=packets.find(v=>v.type==='pylon_vessel_urdf_chunk');
  const compressed=Buffer.from(model.data,'base64'),bundle=JSON.parse(gunzipSync(compressed));
  assert.equal(createHash('sha256').update(compressed).digest('hex'),model.sha256);
  assert.equal(createHash('sha256').update(bundle.urdf).digest('hex'),model.modelId);
  const scan=packets.find(v=>v.type==='pylon_lidar_scan');assert.ok(bundle.partFrames.some(f=>f.partFlightId===scan.partFlightId));
  assert.equal(bundle.partFrames.length,s.craft.parts.length);assert.equal(bundle.vesselId,p.vessel);
});

test('nearby observations share the observer origin and timestamp and exclude stale states',()=>{
  const a=new Simulation(roverCraft()),b=new Simulation(roverCraft()),p=protocol(a),q=protocol(b);
  b.position=add(a.position,[0,10,0]);a.environmentBodies=()=>[a,b];
  const packets=p.telemetry(),near=packets.find(v=>v.type==='pylon_nearby_vessels'),truth=packets.find(v=>v.type==='pylon_ground_truth');
  assert.deepEqual(near.position,truth.position);assert.deepEqual(near.linearVelocity,truth.linearVelocity);
  assert.equal(near.vessels[0].vesselId,q.vessel);assert.ok(Math.abs(near.vessels[0].position[0]-near.position[0]-10)<1e-7);
  b.time=1;assert.equal(p.telemetry().find(v=>v.type==='pylon_nearby_vessels').vessels.length,0);
});

test('thermal state evolves with heat input and survives stage separation',()=>{
  const s=new Simulation(twoStageCraft());s.status='flying';s.position=[EARTH.radius+200000,0,0];s.velocity=[0,0,0];
  s.lastActuation={engineResults:[{id:'engine_1',thrust:60000}]};
  for(let i=0;i<1200;i++)advanceThermals(s,1/120);
  assert.ok(s.thermals.engine_1.temperature>288.15);const before=s.thermals.engine_1.temperature;
  s.separate('separator_1');assert.equal(s.debris[0].thermals.engine_1.temperature,before);assert.ok(!('engine_1' in s.thermals));
  const packets=protocol(s).telemetry().filter(p=>p.type==='pylon_part_thermal_state');assert.equal(packets.length,s.craft.parts.length);
  assert.ok(packets.every(p=>p.temperature>0&&p.maxTemperature>p.temperature));
});

test('separation results are idempotent, queryable without a lease, retained across sessions, and expire',()=>{
  let now=0;const s=new Simulation(twoStageCraft()),p=new PylonProtocol(s,()=>now);p.available=true;s.status='flying';
  const send=c=>p.receive(Buffer.from(JSON.stringify(c))),common={...p.fields(),controllerId:'c',leaseId:'l',sequence:1};
  send({...common,type:'pylon_control_authority_command',action:'acquire',priority:1,suppressSas:false,leaseDurationSeconds:1});
  const operation={operationId:'operation-1',operationInstance:p.instance,operationEpoch:p.epoch,operationVesselId:p.vessel};
  const command={...common,...operation,type:'pylon_actuator_command',actuatorType:'separation',name:'separator_1',separate:true};
  assert.equal(send(command).reason,'command_accepted');assert.equal(s.debris.length,1);
  const query={type:'pylon_separation_query',version:1,...operation},result=send(query);
  assert.equal(result.type,'pylon_separation_result');assert.equal(result.success,true);assert.equal(result.resultingVesselIds.length,2);
  assert.deepEqual(send(command),result);assert.equal(s.debris.length,1);
  assert.equal(send({...command,name:'other'}).reason,'operation_id_conflict');
  p.newSession();assert.equal(send(query).success,true);assert.equal(send(query).operationEpoch,operation.operationEpoch);
  now=601;assert.equal(send(query).retained,false);assert.equal(send(query).reason,'result_not_found');
  assert.equal(send({...query,operationId:'bad token'}).reason,'invalid_operation_identity');
});

test('joint commands move attached parts, change inertia, obey limits, and stop on timeout',()=>{
  const craft=twoStageCraft();craft.parts.splice(1,0,{id:'hinge',type:'servo'},{id:'slide',type:'linear'});
  const s=new Simulation(validateCraft(craft)),p=protocol(s);s.status='flying';s.position=[EARTH.radius+400000,0,0];s.velocity=[0,0,0];s.omega=[0,0,0];
  const send=c=>p.receive(Buffer.from(JSON.stringify({...p.fields(),controllerId:'c',leaseId:'l',sequence:1,...c})));
  send({type:'pylon_control_authority_command',action:'acquire',priority:1,suppressSas:false,leaseDurationSeconds:10});
  const command={type:'pylon_motor_command',name:'hinge',hasEnabled:true,enabled:true,mode:'position',hasPosition:true,position:.4,timeoutSeconds:10};
  const initialInertia=[...s.props.inertia];assert.equal(send(command).reason,'command_accepted');
  assert.equal(send({...command,name:'slide',position:.7}).reason,'command_accepted');
  for(let i=0;i<720;i++)s.step();
  assert.ok(Math.abs(s.joints.hinge.position-.4)<.01);assert.ok(Math.abs(s.joints.slide.position-.7)<.01);
  assert.notDeepEqual(s.props.inertia,initialInertia);
  const poses=s.snapshot().partPoses;assert.ok(poses.find(p=>p.id==='pod_1').position[1]>.1);
  const state=p.telemetry().find(v=>v.type==='pylon_motor_state'&&v.name==='hinge');assert.equal(state.jointType,'revolute');assert.ok(state.commandActive);
  assert.equal(send({...command,sequence:2,position:100}).reason,'command_accepted');
  for(let i=0;i<600;i++)s.step();assert.ok(s.joints.hinge.position<=Math.PI/2);
  s.motors.hinge.expires=s.time;const before=s.joints.hinge.position;s.step();assert.equal(s.joints.hinge.position,before);assert.equal(s.joints.hinge.locked,true);
  send({type:'pylon_control_authority_command',action:'acquire',priority:1,suppressSas:false,leaseDurationSeconds:10,sequence:2});
  assert.equal(send({...command,sequence:3,position:null}).reason,'invalid_motor_command');
});

test('docking constrains two bodies, preserves momentum, releases, and exposes port camera',async()=>{
  const {updateDocking,dockedTogether,portPose}=await import('../server/docking.ts');
  const {norm,sub}=await import('../shared/math.ts');
  const craft=twoStageCraft();craft.parts.push({id:'port',type:'docking',parent:'tank_1',angle:0,offset:0});
  const a=new Simulation(craft),b=new Simulation(craft),p=protocol(a);a.status=b.status='flying';
  a.position=[EARTH.radius+400000,0,0];b.quaternion=axisAngle([1,0,0],Math.PI);a.omega=b.omega=[0,0,0];a.velocity=[0,.1,0];b.velocity=[0,-.1,0];
  b.position=add(b.position,sub(portPose(a,'port').origin,portPose(b,'port').origin));
  updateDocking([a,b]);assert.equal(dockedTogether(a,b),true);
  const separation=norm(sub(a.position,b.position));a.velocity=[0,1,0];b.velocity=[0,0,0];const momentum=add(mul(a.velocity,a.props.mass),mul(b.velocity,b.props.mass));
  updateDocking([a,b]);assert.ok(norm(sub(add(mul(a.velocity,a.props.mass),mul(b.velocity,b.props.mass)),momentum))<1e-8);
  assert.ok(Math.abs(norm(sub(a.position,b.position))-separation)<1e-8);
  const send=c=>p.receive(Buffer.from(JSON.stringify({...p.fields(),controllerId:'c',leaseId:'l',sequence:1,...c})));
  send({type:'pylon_control_authority_command',action:'acquire',priority:1,suppressSas:false,leaseDurationSeconds:10});
  assert.equal(send({type:'pylon_docking_port_command',name:'port',action:'1'}).reason,'invalid_docking_action');
  assert.equal(send({type:'pylon_docking_port_command',name:'port',action:1}).reason,'command_accepted');
  const packets=p.telemetry(),state=packets.find(v=>v.type==='pylon_docking_port_state');assert.equal(state.docked,true);assert.equal(state.partnerName,'port');
  assert.ok(packets.some(v=>v.type==='pylon_camera_frame_chunk'&&v.source==='docking_port'));
  assert.equal(send({type:'pylon_docking_port_command',name:'port',action:3,sequence:2}).reason,'command_accepted');
  assert.equal(dockedTogether(a,b),false);updateDocking([a,b]);assert.equal(dockedTogether(a,b),false,'cooldown prevents immediate recapture');
  assert.equal(send({type:'pylon_docking_port_command',name:'port',action:3,sequence:3}).reason,'docking_port_not_docked');
});

test('docking rejects high approach speed and non-opposing port directions',async()=>{
  const {updateDocking,dockedTogether,portPose}=await import('../server/docking.ts');const {sub}=await import('../shared/math.ts');
  const craft=twoStageCraft();craft.parts.push({id:'port',type:'docking',parent:'tank_1',angle:0,offset:0});
  const a=new Simulation(craft),b=new Simulation(craft);a.status=b.status='flying';a.position=[EARTH.radius+400000,0,0];a.omega=b.omega=[0,0,0];
  b.position=add(b.position,sub(portPose(a,'port').origin,portPose(b,'port').origin));a.velocity=b.velocity=[0,0,0];
  updateDocking([a,b]);assert.equal(dockedTogether(a,b),false);
  b.quaternion=axisAngle([1,0,0],Math.PI);b.position=add(b.position,sub(portPose(a,'port').origin,portPose(b,'port').origin));b.velocity=[0,1,0];
  updateDocking([a,b]);assert.equal(dockedTogether(a,b),false);
});

test('articulated staging preserves world-space part geometry',async()=>{
  const {articulatedLayout}=await import('../shared/articulation.ts');const {massProperties}=await import('../shared/craft.ts');
  const {sub,norm}=await import('../shared/math.ts');
  const craft=twoStageCraft();craft.parts.splice(craft.parts.findIndex(p=>p.id==='tank_2'),0,{id:'hinge',type:'servo'});
  const s=new Simulation(craft);s.status='flying';s.position=[EARTH.radius+400000,0,0];s.velocity=[0,0,0];s.omega=[0,0,0];
  s.joints.hinge={position:.5,velocity:0};s.props=massProperties(craft,s.tankFuel,1,articulatedLayout(craft,{hinge:.5}));
  const positions=new Map(s.props.parts.map(p=>[p.id,add(s.position,rotate(s.quaternion,sub(p.position,s.props.com)))]));
  s.separate('separator_1');
  for(const body of [s,...s.debris])for(const p of body.props.parts){
    const after=add(body.position,rotate(body.quaternion,sub(p.position,body.props.com)));
    assert.ok(norm(sub(after,positions.get(p.id)))<1e-7,p.id);
  }
});

test('docked ports stay together during powered motion and changing fuel mass',async()=>{
  const {FlightWorld}=await import('../server/world.ts');const {updateDocking,portPose,dockedTogether}=await import('../server/docking.ts');const {sub,norm}=await import('../shared/math.ts');
  const craft=twoStageCraft();craft.parts.push({id:'port',type:'docking',parent:'tank_1',angle:0,offset:0});
  const world=new FlightWorld(craft),a=world.active,b=new Simulation(craft);world.vehicles.push(b);a.status=b.status='flying';
  a.position=[EARTH.radius+400000,0,0];b.quaternion=axisAngle([1,0,0],Math.PI);a.omega=b.omega=[0,0,0];a.velocity=b.velocity=[0,0,0];
  b.position=add(b.position,sub(portPose(a,'port').origin,portPose(b,'port').origin));updateDocking([a,b]);
  a.engines.engine_1={enabled:true,targetThrust:6000,expires:10};
  for(let i=0;i<240;i++)world.step();
  assert.equal(dockedTogether(a,b),true);assert.ok(norm(sub(portPose(a,'port').origin,portPose(b,'port').origin))<1e-6);
  assert.ok(a.fuel<b.fuel);assert.ok([...a.position,...b.position,...a.velocity,...b.velocity].every(Number.isFinite));
});
