import {randomUUID} from 'node:crypto';
import {appendObservations} from './observations.js';
import {EARTH} from './physics.js';
import {PARTS,splitCraft,stages} from '../shared/craft.js';
import {add,sub,mul,dot,cross,norm,clamp,rotate,qconj,qmul,axisAngle} from '../shared/math.js';

const identity=v=>typeof v==='string'&&v.trim().length>0&&v.length<=64;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const range=(v,a,b)=>finite(v)&&v>=a&&v<=b;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
const boolean=v=>typeof v==='boolean';
function requireValue(ok,reason){if(!ok)throw Error(reason);}

export class PylonProtocol{
  constructor(sim,clock=()=>performance.now()/1000){
    this.sim=sim;this.clock=clock;this.instance=randomUUID().replaceAll('-','');this.generation=0;this.observation=0;this.started=clock();
    this.received=0;this.accepted=0;this.rejected=0;this.lastCommand=null;this.available=false;this.newSession();
  }
  newSession(){
    this.generation++;this.epoch=randomUUID().replaceAll('-','');this.vessel=randomUUID().replaceAll('-','');this.sequences=new Map();this.clearOwner('session_changed');this.sim.clearCommands();
  }
  clearOwner(reason){this.owner={state:0,controllerId:'',leaseId:'',priority:0,expires:0,sasSuppressed:false,lastSequence:0,reason};this.sim.clearCommands();}
  expire(){if(this.owner.state===1&&this.clock()>this.owner.expires)this.clearOwner('lease_expired');}
  fields(){return {version:1,runtimeInstance:this.instance,runtimeGeneration:this.generation,runtimeEpoch:this.epoch,runtimeVesselId:this.vessel,vesselId:this.vessel};}
  packet(type,fields={}){return {type,...this.fields(),observationSequence:this.observation,universalTime:this.sim.time,...fields};}
  authority(reason=this.owner.reason){
    this.expire();const o=this.owner;
    return this.packet('pylon_control_authority_state',{vessel:this.sim.craft.name,state:o.state,controllerId:o.controllerId,leaseId:o.leaseId,priority:o.priority,
      leaseRemainingSeconds:o.state===1?Math.max(0,o.expires-this.clock()):0,sasSuppressed:o.sasSuppressed,emergencyStop:o.state===2,lastSequence:o.lastSequence,reason});
  }
  checkEnvelope(p){
    requireValue(p&&typeof p==='object'&&!Array.isArray(p)&&p.version===1&&typeof p.type==='string','invalid_envelope');
    const f=this.fields();for(const k of Object.keys(f))requireValue(p[k]===f[k],'runtime_session_mismatch');
    requireValue(this.available&&!['crashed','landed','destroyed'].includes(this.sim.status),'control_unavailable');
    requireValue(identity(p.controllerId)&&identity(p.leaseId),'invalid_lease');
    requireValue(Number.isSafeInteger(p.sequence)&&p.sequence>0,'invalid_sequence');
  }
  checkSequence(p,stream){
    const key=JSON.stringify([p.controllerId,p.leaseId,stream]);requireValue(p.sequence>(this.sequences.get(key)||0),'stale_sequence');return key;
  }
  advance(p,key){
    requireValue(this.sequences.has(key)||this.sequences.size<2048,'sequence_capacity');
    this.sequences.set(key,p.sequence);this.owner.lastSequence=p.sequence;
  }
  owns(p){return this.owner.state===1&&p.controllerId===this.owner.controllerId&&p.leaseId===this.owner.leaseId;}
  authorize(p){requireValue(this.owns(p),this.owner.state===2?'emergency_stop':'lease_not_owned');}
  authorityCommand(p){
    const key=this.checkSequence(p,'authority'),o=this.owner,now=this.clock();
    switch(p.action){
      case 'acquire':
      case 'renew':{
        requireValue(range(p.leaseDurationSeconds,.1,10)&&Number.isSafeInteger(p.priority??0)&&boolean(p.suppressSas),'invalid_lease');
        requireValue(o.state!==2,'emergency_stop');
        if(p.action==='renew')this.authorize(p);
        else requireValue(o.state!==1||this.owns(p)||p.priority>o.priority,'authority_held_by_higher_or_equal_priority');
        const same=this.owns(p);this.advance(p,key);if(!same)this.sim.clearCommands();
        this.owner={state:1,controllerId:p.controllerId,leaseId:p.leaseId,priority:p.priority??o.priority,expires:now+p.leaseDurationSeconds,sasSuppressed:p.suppressSas,lastSequence:p.sequence,reason:same?'lease_renewed':'lease_acquired'};break;
      }
      case 'release':this.authorize(p);this.advance(p,key);this.clearOwner('lease_released');break;
      case 'emergency_stop':
        this.advance(p,key);this.sim.clearCommands();this.owner={state:2,controllerId:p.controllerId,leaseId:p.leaseId,priority:0,expires:0,sasSuppressed:true,lastSequence:p.sequence,reason:'emergency_stop'};break;
      case 'clear_emergency_stop':
        requireValue(o.state===2&&o.controllerId===p.controllerId&&o.leaseId===p.leaseId,'emergency_stop_owner_mismatch');
        this.advance(p,key);this.clearOwner('emergency_stop_cleared');break;
      default:throw Error('unsupported_authority_action');
    }
  }
  validateOperation(p){
    if(p.type==='pylon_actuator_command'&&p.actuatorType==='separation'){
      requireValue(boolean(p.separate),'invalid_separation');
      requireValue(this.sim.craft.parts.some(c=>c.id===p.name&&c.type==='decoupler'),'unknown_actuator');
      if(p.separate){const issue=this.sim.separationIssue(p.name);requireValue(!issue,issue);}
      return {stream:`separation:${p.name}`,apply:()=>{if(p.separate)this.sim.separate(p.name);}};
    }
    const expires=this.clock()+p.timeoutSeconds;
    requireValue(range(p.timeoutSeconds,.05,p.type==='pylon_flight_control_command'?1:10),'invalid_timeout');
    if(p.type==='pylon_flight_control_command'){
      requireValue(['pitch','yaw','roll'].every(k=>range(p[k],-1,1))&&boolean(p.landingGear),'invalid_flight_input');
      return {stream:'attitude',apply:()=>{this.sim.wrench=null;this.sim.flight={...p,expires,receivedAt:this.clock()};}};
    }
    if(p.type==='pylon_body_wrench_command'){
      requireValue(p.frame==='base_link'&&vector(p.force)&&vector(p.torque)&&[...p.force,...p.torque].every(v=>Math.abs(v)<=1e8),'invalid_wrench');
      return {stream:'wrench',apply:()=>{this.sim.flight=null;this.sim.wrench={...p,expires};}};
    }
    requireValue(p.type==='pylon_actuator_command','unsupported_command');
    const part=this.sim.craft.parts.find(c=>c.id===p.name&&c.type===p.actuatorType);
    requireValue(part&&['engine','rcs'].includes(p.actuatorType),'unknown_actuator');
    requireValue(boolean(p.enabled),'invalid_actuator_enabled');
    if(p.actuatorType==='engine'){
      requireValue(range(p.targetThrust,0,1e8),'invalid_thrust');
      requireValue(boolean(p.hasGimbalCommand??false)&&['gimbalPitch','gimbalYaw','gimbalRoll'].every(k=>range(p[k]??0,-1,1)),'invalid_gimbal');
      return {stream:`actuator:engine:${p.name}`,apply:()=>{this.sim.wrench=null;this.sim.engines[p.name]={gimbalPitch:0,gimbalYaw:0,gimbalRoll:0,...p,expires};}};
    }
    requireValue(range(p.thrustLimit,0,1e8),'invalid_rcs_limit');
    return {stream:`actuator:rcs:${p.name}`,apply:()=>{this.sim.rcs[p.name]={...p,thrustLimit:clamp(p.thrustLimit/PARTS.rcs.thrust,0,1),expires};}};
  }
  batch(p){
    requireValue(boolean(p.hasFlight)&&boolean(p.hasSeparation)&&boolean(p.renewLease),'unsupported_batch');
    requireValue(Array.isArray(p.engineJson)&&p.engineJson.length<=16,'invalid_batch_engines');
    if(p.renewLease)requireValue(range(p.leaseDurationSeconds,.1,10)&&boolean(p.suppressSas),'invalid_lease');
    const children=p.engineJson.map(raw=>{requireValue(typeof raw==='string','invalid_batch_member');const e=JSON.parse(raw);requireValue(e.type==='pylon_actuator_command'&&e.actuatorType==='engine','invalid_batch_engine');return e;});
    if(p.hasFlight){requireValue(typeof p.flightJson==='string','invalid_batch_flight');const f=JSON.parse(p.flightJson);requireValue(f.type==='pylon_flight_control_command','invalid_batch_flight');children.push(f);}
    if(p.hasSeparation){
      requireValue(typeof p.separationJson==='string','invalid_batch_separation');const s=JSON.parse(p.separationJson);
      requireValue(s.type==='pylon_actuator_command'&&s.actuatorType==='separation','invalid_batch_separation');
      this.validateOperation(s);
      if(s.separate){const {retained}=splitCraft(this.sim.craft,s.name);requireValue(children.every(c=>c.actuatorType!=='engine'||retained.parts.some(r=>r.id===c.name)),'batch_targets_detached_part');}
      // Separate first: reset old commands, then apply the new upper-stage inputs.
      children.unshift(s);
    }
    const ops=children.map(c=>{
      for(const k of ['version','vesselId','controllerId','leaseId','sequence'])requireValue(c[k]===p[k],'batch_identity_mismatch');
      if(c.actuatorType!=='separation')requireValue(range(c.timeoutSeconds,.05,1),'invalid_timeout');return this.validateOperation(c);
    });
    requireValue(new Set(ops.map(o=>o.stream)).size===ops.length,'duplicate_batch_actuator');
    const key=this.checkSequence(p,'batch');this.advance(p,key);
    if(p.renewLease){this.owner.expires=this.clock()+p.leaseDurationSeconds;this.owner.sasSuppressed=p.suppressSas;}
    for(const op of ops)op.apply();
  }
  receive(data){
    this.received++;this.expire();let p;
    try{
      requireValue(data.length<=32768,'packet_too_large');p=JSON.parse(data.toString('utf8'));this.checkEnvelope(p);
      if(p.type==='pylon_control_authority_command')this.authorityCommand(p);
      else{this.authorize(p);if(p.type==='pylon_control_batch')this.batch(p);else{const op=this.validateOperation(p),key=this.checkSequence(p,op.stream);this.advance(p,key);op.apply();}this.owner.reason='command_accepted';}
      this.accepted++;this.lastCommand={time:this.clock(),type:p.type,accepted:true,reason:this.owner.reason};
      return this.authority();
    }catch(e){this.rejected++;this.lastCommand={time:this.clock(),type:p?.type||'invalid',accepted:false,reason:e.message};return this.authority(e.message);}
  }
  telemetry(){
    this.expire();const s=this.sim.snapshot(),now=this.clock(),f=this.sim.flight,active=this.owner.state===1&&f?.expires>now&&this.sim.charge>0;
    const session=this.packet('pylon_session',{available:this.available&&!['crashed','landed','destroyed'].includes(s.status),vesselName:this.sim.craft.name,observationSequence:++this.observation,
      realtimeSinceStartup:now-this.started,paused:!this.available,packed:false,warpRate:this.timeScale||1,physicsWarp:(this.timeScale||1)>1});
    const packets=[session];if(!this.available)return packets;
    const spin=[0,0,EARTH.spin],inverse=qconj(this.sim.quaternion),spinQ=axisAngle([0,0,1],-EARTH.spin*s.time);
    const enuQ=qmul([-.5,-.5,-.5,.5],spinQ),enu=v=>rotate(enuQ,v);
    const sv=sub(s.velocity,cross(spin,s.position));
    const av=sub(this.sim.omega,rotate(inverse,spin));
    const fixed=rotate(spinQ,s.position);
    packets.push(this.packet('pylon_flight_state',{
      observationSequence:this.observation,bodyName:'Earth',altitudeAsl:s.altitudeAsl,altitudeAgl:s.altitudeAsl,
      latitude:Math.asin(s.position[2]/norm(s.position))*180/Math.PI,longitude:Math.atan2(fixed[1],fixed[0])*180/Math.PI,
      mass:s.mass,liquidFuel:s.fuel*.45/5,oxidizer:s.fuel*.55/5,electricCharge:s.charge,
      gravity:s.gravity,bodyRadius:EARTH.radius,gravitationalParameter:EARTH.mu,atmosphereDepth:EARTH.atmosphereDepth,
      apoapsis:s.orbit.apoapsis??0,periapsis:s.orbit.periapsis,timeToApoapsis:s.orbit.timeToApoapsis??0,
      verticalSpeed:s.verticalSpeed,horizontalSpeed:s.horizontalSpeed,dynamicPressure:s.q,landed:['pad','landed'].includes(s.status),splashed:false,
      upBody:s.upBody,eastBody:s.eastBody,northBody:s.northBody,surfaceVelocityBody:s.surfaceVelocityBody,orbitalVelocityBody:s.orbitalVelocityBody,angularVelocityBody:av,
      appliedInputValid:!!active,flightCommandActive:!!active,appliedInputSequence:active?f.sequence:0,appliedInputAge:f?Math.max(0,now-f.receivedAt):0,
      appliedPitch:active?f.pitch:0,appliedYaw:active?f.yaw:0,appliedRoll:active?f.roll:0,inputAtLimit:!!active&&[f.pitch,f.yaw,f.roll].some(v=>Math.abs(v)>=.999),
      orbitBound:s.orbit.apoapsis!==null
    }));
    const fixedAcceleration=enu(add(sub(this.sim.acceleration,mul(cross(spin,s.velocity),2)),cross(spin,cross(spin,s.position))));
    packets.push(this.packet('pylon_ground_truth',{
      vessel:this.sim.craft.name,originSequence:this.generation,position:sub(enu(s.position),[0,0,EARTH.radius+this.sim.padHeight]),rotation:qmul(enuQ,s.quaternion),
      linearVelocity:enu(sv),angularVelocity:enu(rotate(s.quaternion,av)),linearVelocityBody:s.surfaceVelocityBody,angularVelocityBody:av,
      linearAcceleration:fixedAcceleration,angularAcceleration:enu(rotate(s.quaternion,this.sim.angularAcceleration)),frameAngularVelocity:enu(spin)
    }));
    packets.push(this.authority());
    const actuators=this.sim.craft.parts.filter(p=>['engine','rcs','decoupler'].includes(p.type)).map(p=>({name:p.id,actuatorType:p.type==='decoupler'?'separation':p.type,partId:p.id}));
    packets.push(this.packet('pylon_actuator_manifest',{actuators}));
    for(const a of actuators){
      if(a.actuatorType==='separation'){
        packets.push(this.packet('pylon_actuator_state',{...a,mechanism:'decoupler',available:!this.sim.separationIssue(a.name),separated:false}));continue;
      }
      const c=(a.actuatorType==='engine'?this.sim.engines:this.sim.rcs)[a.name],directActive=!!c&&c.expires>now&&this.owner.state===1;
      const wrenchActive=!!this.sim.wrench&&this.sim.wrench.expires>now&&this.owner.state===1,commandActive=directActive||wrenchActive;
      if(a.actuatorType==='engine'){
        const e=s.engines.find(e=>e.id===a.name);
        const gimbalActive=directActive&&c.hasGimbalCommand&&!wrenchActive;
        const stage=stages(this.sim.craft).at(-1),available=stage.some(p=>p.id===a.name),stageFuel=stage.reduce((sum,p)=>sum+(this.sim.tankFuel[p.id]||0),0);
        packets.push(this.packet('pylon_actuator_state',{...a,enabled:available&&(wrenchActive||directActive&&c.enabled),commandActive:available&&commandActive,throttle:(e?.thrust||0)/(e?.maxThrust||PARTS.engine.thrust),
          thrust:e?.thrust||0,maxThrust:available?(e?.maxThrust||PARTS.engine.thrust):0,available,operational:available&&stageFuel>0&&s.charge>0&&!['crashed','landed','destroyed'].includes(s.status),gimbalAvailable:true,gimbalCommandActive:available&&!!gimbalActive,
          gimbalPitch:gimbalActive?c.gimbalPitch:0,gimbalYaw:gimbalActive?c.gimbalYaw:0,gimbalRoll:gimbalActive?c.gimbalRoll:0,flameout:available&&stageFuel<=0}));
      }else{
        const r=this.sim.lastActuation?.rcsResults?.find(r=>r.id===a.name);
        packets.push(this.packet('pylon_actuator_state',{...a,enabled:wrenchActive||directActive&&c.enabled,active:(r?.thrust||0)>0,commandActive,thrust:r?.thrust||0,maxThrust:PARTS.rcs.thrust,thrustLimit:r?.thrustLimit||0,flameout:s.mono<=0}));
      }
    }
    for(const s of this.sim.separations)packets.push(this.packet('pylon_actuator_state',{name:s.id,partId:s.id,actuatorType:'separation',mechanism:'decoupler',available:false,separated:true}));
    const w=this.sim.wrench;
    if(w){
      const achieved={force:this.sim.lastActuation?.force||[0,0,0],torque:this.sim.lastActuation?.torque||[0,0,0]};
      const residual={force:sub(w.force,achieved.force),torque:sub(w.torque,achieved.torque)};
      const ratio=norm([...residual.force,...residual.torque])/Math.max(1,norm([...w.force,...w.torque]));
      packets.push(this.packet('pylon_wrench_status',{controllerId:w.controllerId,leaseId:w.leaseId,sequence:w.sequence,accepted:w.expires>now,reason:w.expires>now?'allocated':'command_expired',requested:{force:w.force,torque:w.torque},allocated:achieved,achieved,allocationResidual:residual,trackingResidual:{force:[0,0,0],torque:[0,0,0]},saturationRatio:ratio,trackingErrorRatio:0,saturated:ratio>.001,achievedQuality:'simulated'}));
    }
    appendObservations(packets,this.sim,(type,fields)=>this.packet(type,fields));
    return packets;
  }
}
