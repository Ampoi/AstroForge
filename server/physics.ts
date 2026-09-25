import type {Craft, FlightStatus, Actuation, EngineCommand, RcsCommand, FlightCommand, WrenchCommand, WheelCommand, WheelState} from '../shared/types.ts';
import type {PhysicsKernel, FlightSnapshot} from './types.ts';
import {randomUUID} from 'node:crypto';
import {add,sub,mul,dot,cross,norm,unit,clamp,qnorm,qconj,qmul,rotate,axisAngle,matVec} from '../shared/math.ts';
import {PARTS,G0,craftStats,massProperties,stages,splitCraft,isRover,GROUND_ALTITUDE} from '../shared/craft.ts';

import {EARTH,STEP,atmosphere,gravity,orbitalElements} from './physics-reference.ts';
import {roverForces,WHEEL} from './rover.ts';
import {PartIdentity} from './part-identity.ts';
import {advanceJoints,internalMomentum} from './motors.ts';
import type {JointState,MotorInput} from './motors.ts';
import {articulatedLayout,isJoint} from '../shared/articulation.ts';
import {advanceThermals} from './thermal.ts';
import type {ThermalState} from './thermal.ts';
import {prepareMassModel} from '../shared/mass-model.ts';
import {physicsKernel} from './physics-kernel.ts';
export {EARTH,STEP,atmosphere,gravity,orbitalElements,rk4} from './physics-reference.ts';

export class Simulation{
  kernel: PhysicsKernel;
  partIds=new PartIdentity();
  vesselIdentity=randomUUID().replaceAll('-','');
  environmentBodies: ()=>Simulation[]=()=>[this,...this.debris];
  selectedDockingCamera: string|null=null;
  joints: Record<string,JointState>={}; motors: Record<string,MotorInput>={};
  get articulated(){return this.craft.parts.some(p=>isJoint(p.type));}
  thermals: Record<string,ThermalState>={};
  private integrationOutput = Array<number>(13);
  private massModel?: ReturnType<typeof prepareMassModel>;
  private updateMass() {
    if(this.articulated)return massProperties(this.craft,this.tankFuel,this.stats.mono?this.mono/this.stats.mono:0,articulatedLayout(this.craft,Object.fromEntries(Object.entries(this.joints).map(([id,j])=>[id,j.position]))));
    if (this.massModel?.craft !== this.craft) this.massModel = prepareMassModel(this.craft);
    return this.massModel.update(this.tankFuel, this.stats.mono ? this.mono / this.stats.mono : 0);
  }
  id!: string; craft!: Craft; stats!: ReturnType<typeof craftStats>; props!: ReturnType<typeof massProperties>;
  createdAt=0; destroyedAt: number | null=null; impact: FlightSnapshot['impact']=null;
  tankFuel: Record<string,number>={}; mono=0; charge=0; time=0; status: FlightStatus='pad';
  maxAltitude=0; maxQ=0; trail: number[][]=[]; events: {time:number;text:string}[]=[];
  debris: Simulation[]=[]; separations: {id:string;time:number}[]=[]; passive=false; fragment=false;
  expiresAt=0; collisionGraceUntil=0; padHeight=0;
  position: number[]=[]; velocity: number[]=[]; quaternion: number[]=[]; omega: number[]=[];
  acceleration: number[]=[]; angularAcceleration: number[]=[];
  last={thrust:0,drag:0,q:0,mach:0,aoa:0}; lastActuation: Actuation | null=null;
  engines: Record<string,EngineCommand>={}; rcs: Record<string,RcsCommand>={};
  wheels: Record<string,WheelCommand>={}; wheelStates: WheelState[]=[];
  get rover(){return isRover(this.craft);}
  flight: FlightCommand | null=null; wrench: WrenchCommand | null=null;

  constructor(craft: Craft,{kernel=physicsKernel}={}){this.kernel=kernel;this.reset(craft);}
  get fuel(){return Object.values(this.tankFuel).reduce((s,v)=>s+v,0);}
  set fuel(value){
    const tanks=this.craft.parts.filter(p=>p.type==='tank'),capacity=tanks.length*PARTS.tank.fuel;
    this.tankFuel=Object.fromEntries(tanks.map(p=>[p.id,capacity?clamp(value,0,capacity)/tanks.length:0]));
  }
  reset(craft: Craft){
    this.id=randomUUID();this.createdAt=0;this.destroyedAt=null;this.impact=null;this.craft=structuredClone(craft);this.joints={};this.motors={};this.selectedDockingCamera=null;this.stats=craftStats(craft);this.fuel=this.stats.fuel;this.mono=this.stats.mono;this.charge=this.stats.power;
    this.time=0;this.status='pad';this.maxAltitude=0;this.maxQ=0;this.trail=[];this.events=[];this.debris=[];this.separations=[];this.passive=false;
    this.props=this.updateMass();this.padHeight=this.props.com[0];
    this.position=[EARTH.radius+this.padHeight,0,0];this.velocity=cross([0,0,EARTH.spin],this.position);
    this.quaternion=[0,0,0,1];this.omega=[0,0,EARTH.spin];
    if(this.rover){
      this.quaternion=[.5,.5,.5,.5];
      const bottom=Math.min(...this.props.parts.filter(p=>p.type==='wheel').map(p=>p.position[2]-WHEEL.extension-WHEEL.radius));
      this.padHeight=this.props.com[2]-bottom+GROUND_ALTITUDE+.08;
      this.position=[Math.sqrt((EARTH.radius+this.padHeight)**2-200**2),200,0];this.velocity=cross([0,0,EARTH.spin],this.position);
      this.omega=rotate(qconj(this.quaternion),[0,0,EARTH.spin]);this.status='flying';
    }
    this.wheelStates=[];this.thermals={};
    this.acceleration=[0,0,0];this.angularAcceleration=[0,0,0];this.last={thrust:0,drag:0,q:0,mach:0,aoa:0};
    this.clearCommands();this.event(this.rover?'ローバーを地表に配置。車輪UDPコマンドを待っています。':'発射台に配置。UDPコマンドを待っています。');
  }
  clearCommands(){this.motors={};this.wheels={};this.engines={};this.rcs={};this.flight=null;this.wrench=null;}
  event(text: string){this.events.unshift({time:this.time,text});this.events=this.events.slice(0,30);}
  separationIssue(id: string){
    if(this.status!=='flying')return 'separation_requires_flight';
    if(this.charge<=0)return 'no_power';
    try{splitCraft(this.craft,id);}catch{return 'separation_unavailable';}
    return null;
  }
  separate(id: string){
    const issue=this.separationIssue(id);if(issue)throw Error(issue);
    const {retained,detached}=splitCraft(this.craft,id),oldStats=this.stats;
    const thermals={...this.thermals},joints=structuredClone(this.joints);
    const fuel={...this.tankFuel},monoFraction=oldStats.mono?this.mono/oldStats.mono:0,chargeFraction=oldStats.power?this.charge/oldStats.power:0;
    const oldProps=this.updateMass(),origin=[...this.position],velocity=[...this.velocity];
    const q=[...this.quaternion],omega=[...this.omega],height=craftStats(detached).height;
    const debris=new Simulation(detached,{kernel:this.kernel});debris.id=`${this.id}/${id}`;debris.createdAt=this.time;debris.time=this.time;debris.status='flying';debris.passive=true;debris.padHeight=this.padHeight;
    this.craft=retained;
    for(const [body,shift] of ([[this,[height,0,0]],[debris,[0,0,0]]] as [Simulation,number[]][])){
      body.joints=Object.fromEntries(body.craft.parts.filter(p=>joints[p.id]).map(p=>[p.id,joints[p.id]]));
      body.thermals=Object.fromEntries(body.craft.parts.map(p=>[p.id,{...(thermals[p.id]??{temperature:288.15,skinTemperature:288.15})}]));
      body.environmentBodies=this.environmentBodies;
      body.stats=craftStats(body.craft);body.tankFuel=Object.fromEntries(body.craft.parts.filter(p=>p.type==='tank').map(p=>[p.id,fuel[p.id]]));
      body.mono=body.stats.mono*monoFraction;body.charge=body.stats.power*chargeFraction;
      body.props=body.updateMass();
      const reference=body.props.parts[0],oldReference=oldProps.parts.find(p=>p.id===reference.id)!;
      const rotation=qmul(oldReference.rotation??[0,0,0,1],qconj(reference.rotation??[0,0,0,1]));
      const offset=sub(add(oldReference.position,rotate(rotation,sub(body.props.com,reference.position))),oldProps.com);
      body.position=add(origin,rotate(q,offset));body.velocity=add(velocity,rotate(q,cross(omega,offset)));
      body.quaternion=qmul(q,rotation);body.omega=rotate(qconj(rotation),omega);body.clearCommands();
      body.last={thrust:0,drag:0,q:0,mach:0,aoa:0};body.lastActuation=null;
    }
    // Equal/opposite axial impulse at the ring's center, including off-axis torque.
    const ring=oldProps.parts.find(p=>p.id===id)!;
    const ringWorld=add(origin,rotate(q,sub(ring.position,oldProps.com)));
    for(const [body,sign] of ([[this,1],[debris,-1]] as [Simulation,number][])){
      const impulse=rotate(qmul(q,ring.rotation??[0,0,0,1]),[sign*PARTS.decoupler.impulse,0,0]);
      body.velocity=add(body.velocity,mul(impulse,1/body.props.mass));
      const arm=rotate(qconj(body.quaternion),sub(ringWorld,body.position)),localImpulse=rotate(qconj(body.quaternion),impulse);
      body.omega=add(body.omega,matVec(body.props.inverseInertia,cross(arm,localImpulse)));
    }
    this.collisionGraceUntil=this.time+.5;debris.collisionGraceUntil=this.time+.5;this.debris.push(debris);this.separations.push({id,time:this.time});this.event(`分離完了 — ${id} / ${detached.parts.length}パーツを切り離しました`);
  }
  impactDamage(speed: number,kind='ground'){
    if(this.status==='destroyed')return;
    this.impact={time:this.time,speed,kind,position:[...this.position]};
    this.status='destroyed';this.destroyedAt=this.time;this.clearCommands();
    this.last={thrust:0,drag:0,q:0,mach:0,aoa:0};this.lastActuation=null;
    this.event(`${kind==='ground'?'地面':'機体'}への衝突 — ${speed.toFixed(1)} m/s / ${speed>=65?'機体消失':'機体破損'}`);
    // Break at stack joints, preserving attached surface parts and remaining resources.
    // Already broken pieces and extreme impacts disappear instead of spawning recursively.
    if(speed>=65||this.fragment)return;
    const old=this.props,monoFraction=this.stats.mono?this.mono/this.stats.mono:0,chargeFraction=this.stats.power?this.charge/this.stats.power:0;
    const pieces=[];
    for(const core of old.parts.filter(p=>!p.def.radial)){
      const craft={name:`${this.craft.name} / ${PARTS[core.type].name}`,parts:this.craft.parts.filter(p=>p.id===core.id||p.parent===core.id)};
      const piece=new Simulation(craft,{kernel:this.kernel});piece.id=`${this.id}/fragment/${core.id}`;piece.fragment=true;piece.passive=true;
      piece.time=this.time;piece.createdAt=this.time;piece.expiresAt=this.time+20;piece.status='flying';piece.collisionGraceUntil=this.time+.5;
      piece.tankFuel=Object.fromEntries(craft.parts.filter(p=>p.type==='tank').map(p=>[p.id,this.tankFuel[p.id]||0]));
      piece.mono=piece.stats.mono*monoFraction;piece.charge=piece.stats.power*chargeFraction;
      piece.props=piece.updateMass();piece.padHeight=0;
      const localCore=piece.props.parts.find(p=>p.id===core.id)!;
      const offset=sub(add(sub(core.position,localCore.position),piece.props.com),old.com);
      piece.position=add(this.position,rotate(this.quaternion,offset));piece.quaternion=[...this.quaternion];
      piece.velocity=add(this.velocity,rotate(this.quaternion,cross(this.omega,offset)));
      piece.omega=add(this.omega,[.4*Math.sin(pieces.length),.6,-.4]);
      pieces.push(piece);
    }
    const kicks=pieces.map((_,i)=>[2*Math.cos(i*2.4),3*Math.sin(i*2.4),2*Math.sin(i*1.7)]);
    const total=pieces.reduce((sum,p)=>sum+p.props.mass,0);
    const mean=mul(pieces.reduce((sum,p,i)=>add(sum,mul(kicks[i],p.props.mass)),[0,0,0]),1/total);
    pieces.forEach((p,i)=>{
      p.velocity=add(p.velocity,sub(kicks[i],mean));
      if(kind==='ground'){
        const up=unit(p.position),surface=cross([0,0,EARTH.spin],p.position),relative=sub(p.velocity,surface),vertical=dot(relative,up);
        // Ground absorbs the impact; chunks rebound briefly before falling back.
        p.velocity=add(surface,add(mul(sub(relative,mul(up,vertical)),.3),mul(up,3+Math.min(4,speed*.08))));
      }
    });
    this.debris.push(...pieces);
  }
  actuation(now: number,dt: number){
    const atmospheric=atmosphere(norm(this.position)-EARTH.radius),fraction=clamp(atmospheric.pressure/101325,0,1);
    const isp=PARTS.engine.ispVac-(PARTS.engine.ispVac-PARTS.engine.isp)*fraction;
    const maxThrust=PARTS.engine.thrust*isp/PARTS.engine.isp;
    const powered=!this.passive&&this.charge>0&&!['crashed','landed','destroyed'].includes(this.status);
    const activeStage=stages(this.craft).at(-1)!,activeIds=new Set(activeStage.map(p=>p.id));
    const stageFuel=activeStage.reduce((s,p)=>s+(this.tankFuel[p.id]||0),0);
    const flight=powered&&this.flight && this.flight.expires>now?this.flight:{pitch:0,yaw:0,roll:0};
    const wrench=powered&&this.wrench && this.wrench.expires>now?this.wrench:null;
    let force=[0,0,0],torque=[0,0,0],thrust=0;
    const engineResults=[];
    for(const p of this.props.parts.filter(p=>p.type==='engine')){
      const exposed=activeIds.has(p.id),c=this.engines[p.id],active=powered&&exposed&&c?.enabled&&c.expires>now;
      let t=wrench&&exposed?clamp(wrench.force[0],0,maxThrust):(active?clamp(c.targetThrust,0,maxThrust):0);
      const gp=active&&c.hasGimbalCommand?c.gimbalPitch:flight.pitch;
      const gy=active&&c.hasGimbalCommand?c.gimbalYaw:flight.yaw;
      const direction=rotate(p.rotation??[0,0,0,1],unit([1,-gy*Math.tan(Math.PI/30),gp*Math.tan(Math.PI/30)]));
      t*=Math.min(1,stageFuel/(t/(isp*G0)*dt||1));
      const f=mul(direction,t);force=add(force,f);torque=add(torque,cross(sub(p.position,this.props.com),f));thrust+=t;
      engineResults.push({id:p.id,thrust:t,maxThrust:exposed?maxThrust:0,available:exposed,fuel:exposed?stageFuel:0,gimbalPitch:gp,gimbalYaw:gy});
    }
    const wheel=[flight.roll*PARTS.pod.wheelTorque,flight.pitch*PARTS.pod.wheelTorque,flight.yaw*PARTS.pod.wheelTorque];
    torque=add(torque,wheel);
    const blocks=this.props.parts.filter(p=>p.type==='rcs');
    const enabled=blocks.filter(p=>wrench||(this.rcs[p.id]?.enabled&&this.rcs[p.id].expires>now));
    const rcsMax=enabled.reduce((s,p)=>s+PARTS.rcs.thrust*(wrench?1:this.rcs[p.id].thrustLimit),0);
    const arm=enabled.length?Math.max(.625,...enabled.map(p=>norm(sub(p.position,this.props.com)))):.625;
    let rf=wrench?sub(wrench.force,force):[0,0,0];
    let rt=wrench?sub(wrench.torque,torque):mul([flight.roll,flight.pitch,flight.yaw],rcsMax*arm*.5);
    // Ideal six-axis RCS allocator with a shared total nozzle-force budget.
    const requested=norm(rf)+norm(rt)/arm,limit=Math.min(1,rcsMax/(requested||1),this.mono*220*G0/(dt*(requested||1)));
    rf=mul(rf,limit);rt=mul(rt,limit);const rcsUsed=norm(rf)+norm(rt)/arm;
    force=add(force,rf);torque=add(torque,rt);
    const sun=unit([.3,-.8,.5]);const behind=dot(this.position,sun)<0&&norm(cross(this.position,sun))<EARTH.radius;
    let watts=0;
    if(!behind)for(const p of this.props.parts.filter(p=>p.type==='solar'))watts+=PARTS.solar.watts*Math.abs(dot(rotate(this.quaternion,[0,-Math.sin(p.angle!),Math.cos(p.angle!)]),sun));
    this.charge=clamp(this.charge+(watts-15-norm(wheel)*.12)*dt/3600,0,this.stats.power);
    const consumed=thrust/(isp*G0)*dt;
    for(const p of activeStage)if(p.type==='tank')this.tankFuel[p.id]=Math.max(0,this.tankFuel[p.id]-consumed*this.tankFuel[p.id]/(stageFuel||1));
    this.mono=Math.max(0,this.mono-rcsUsed/(220*G0)*dt);
    const rcsResults=blocks.map(p=>{
      const available=enabled.includes(p)?PARTS.rcs.thrust*(wrench?1:this.rcs[p.id].thrustLimit):0;
      return {id:p.id,thrust:rcsMax?rcsUsed*available/rcsMax:0,thrustLimit:available};
    });
    return {force,torque,thrust,engineResults,rcsResults,rcsUsed,watts};
  }
  aerodynamic(position: number[],velocity: number[],q: number[],omega: number[]){
    return this.kernel.aerodynamic(this,position,velocity,q,omega);
  }
  step(dt=STEP,now=this.time){
    // Suspension contact needs smaller fixed steps, including under time warp.
    if(this.rover&&dt>1/240+1e-10){const n=Math.ceil(dt/(1/240));for(let i=0;i<n;i++)this.step(dt/n,now);return;}

    for(const debris of this.debris)debris.step(dt,now);
    this.debris=this.debris.filter(d=>!d.expiresAt||d.time<d.expiresAt);
    if(this.status==='destroyed'){this.time+=dt;return;}
    if(this.articulated){
      const momentum=add(matVec(this.props.inertia,this.omega),internalMomentum(this));
      advanceJoints(this,dt,now);this.props=this.updateMass();
      this.omega=matVec(this.props.inverseInertia,sub(momentum,internalMomentum(this)));
    }
    advanceThermals(this,dt);
    if(this.status==='crashed'||this.status==='landed'){
      const q=axisAngle([0,0,1],EARTH.spin*dt),spin=[0,0,EARTH.spin];
      this.position=rotate(q,this.position);this.quaternion=qmul(q,this.quaternion);this.velocity=cross(spin,this.position);
      this.omega=rotate(qconj(this.quaternion),spin);this.acceleration=cross(spin,this.velocity);this.angularAcceleration=[0,0,0];
      this.last={thrust:0,drag:0,q:0,mach:0,aoa:0};this.lastActuation={force:[0,0,0],torque:[0,0,0],thrust:0,engineResults:[],rcsUsed:0,watts:0};this.time+=dt;return;
    }
    this.props=this.updateMass();
    const a=this.actuation(now,dt),props=this.props;
    if(this.rover){
      const ground=roverForces(this,dt,now);this.wheelStates=ground.states;
      if(this.destroyedAt!==null){this.time+=dt;return;}
      a.force=add(a.force,ground.force);a.torque=add(a.torque,ground.torque);
      this.charge=Math.max(0,this.charge-ground.watts*dt/3600);
    }
    this.lastActuation=a;
    const start=[...this.position,...this.velocity,...this.quaternion,...this.omega];
    if(this.status==='pad'&&a.thrust>props.mass*norm(gravity(this.position))){this.status='flying';this.event('LIFTOFF — 発射台を離れました');}
    if(this.status==='pad'){
      const spin=EARTH.spin*(this.time+dt);this.position=[(EARTH.radius+this.padHeight)*Math.cos(spin),(EARTH.radius+this.padHeight)*Math.sin(spin),0];
      this.velocity=cross([0,0,EARTH.spin],this.position);this.quaternion=axisAngle([0,0,1],spin);this.omega=[0,0,EARTH.spin];
      this.acceleration=cross([0,0,EARTH.spin],this.velocity);this.angularAcceleration=[0,0,0];
    }else{
      const next=this.kernel.integrateInto?.(this,start,dt,a,this.integrationOutput) ?? this.kernel.integrate(this,start,dt,a);
      if(!next.every(Number.isFinite)){this.status='crashed';this.clearCommands();this.event('数値計算を停止しました');return;}
      this.position=next.slice(0,3);this.velocity=next.slice(3,6);this.quaternion=qnorm(next.slice(6,10));this.omega=next.slice(10,13);
      this.acceleration=mul(sub(this.velocity,start.slice(3,6)),1/dt);this.angularAcceleration=mul(sub(this.omega,start.slice(10,13)),1/dt);
      const up=unit(this.position),nose=rotate(this.quaternion,[1,0,0]);
      const alignment=dot(up,nose);
      let contactExtent=Math.max(this.props.com[0]*alignment,-(this.stats.height-this.props.com[0])*alignment)+.625*Math.sqrt(Math.max(0,1-alignment**2));
      if(this.articulated){
        const upBody=rotate(qconj(this.quaternion),up);
        contactExtent=Math.max(...this.props.parts.map(p=>{
          const localUp=rotate(qconj(p.rotation??[0,0,0,1]),upBody),half=[p.def.height/2,(p.def.width??1.25)/2,(p.def.depth??1.25)/2];
          return -dot(sub(p.position,this.props.com),upBody)+half.reduce((sum,v,i)=>sum+v*Math.abs(localUp[i]),0);
        }));
      }
      const lowest=norm(this.position)-EARTH.radius-contactExtent;
      if(!this.rover&&lowest<=0){
        const impact=norm(sub(this.velocity,cross([0,0,EARTH.spin],this.position)));
        if(impact>=8){this.time+=dt;this.impactDamage(impact);return;}
        this.status=impact<4&&dot(up,nose)>.95?'landed':'crashed';this.clearCommands();
        this.position=mul(up,EARTH.radius+Math.max(.625,contactExtent));this.velocity=[0,0,0];this.omega=[0,0,0];
        this.event(`${this.status==='landed'?'着地':'地表に衝突'} — ${impact.toFixed(1)} m/s`);
      }
    }
    this.time+=dt;
    const aero=this.aerodynamic(this.position,this.velocity,this.quaternion,this.omega);
    this.last={thrust:a.thrust,drag:aero.drag,q:aero.q,mach:aero.mach,aoa:aero.aoa};
    const altitude=Math.max(0,norm(this.position)-EARTH.radius-this.padHeight);
    this.maxAltitude=Math.max(this.maxAltitude,altitude);this.maxQ=Math.max(this.maxQ,aero.q);
    if(this.status==='flying'&&Math.floor(this.time*2)!==Math.floor((this.time-dt)*2)){this.trail.push([...this.position]);if(this.trail.length>2400)this.trail.shift();}
  }
  snapshot(cache?: Map<Simulation, FlightSnapshot>): FlightSnapshot{
    const cached=cache?.get(this);if(cached)return cached;
    const r=norm(this.position),up=unit(this.position),east=unit(cross([0,0,1],up)),north=cross(up,east);
    const sv=sub(this.velocity,cross([0,0,EARTH.spin],this.position)),verticalSpeed=dot(sv,up);
    const orbit=orbitalElements(this.position,this.velocity),inverse=qconj(this.quaternion);
    const snapshot: FlightSnapshot = {id:this.id,craft:this.craft,createdAt:this.createdAt,fragment:!!this.fragment,passive:this.passive,impact:this.impact,time:this.time,status:this.status,position:this.position,velocity:this.velocity,quaternion:this.quaternion,omega:this.omega,
      altitude:Math.max(0,r-EARTH.radius-this.padHeight),altitudeAsl:r-EARTH.radius,verticalSpeed,horizontalSpeed:Math.sqrt(Math.max(0,dot(sv,sv)-verticalSpeed**2)),speed:norm(sv),
      mass:this.props.mass,fuel:this.fuel,mono:this.mono,charge:this.charge,orbit,...this.last,maxAltitude:this.maxAltitude,maxQ:this.maxQ,
      upBody:rotate(inverse,up),eastBody:rotate(inverse,east),northBody:rotate(inverse,north),surfaceVelocityBody:rotate(inverse,sv),orbitalVelocityBody:rotate(inverse,this.velocity),
      gravity:EARTH.mu/(r*r),events:this.events,stats:this.stats,com:this.props.com,
      joints:Object.entries(this.joints).map(([id,j])=>({id,position:j.position})),
      partPoses:this.articulated?this.props.parts.map(p=>({id:p.id,position:p.position,rotation:p.rotation??[0,0,0,1]})):[],
      wheels:this.wheelStates,engines:this.lastActuation?.engineResults||[],powerGeneration:this.lastActuation?.watts||0,
      separations:this.separations,debris:this.debris.map(d=>d.snapshot(cache))};
    cache?.set(this,snapshot);return snapshot;
  }
}
