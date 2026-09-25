import type {Simulation} from './physics.ts';
import type {WheelState} from '../shared/types.ts';
import {add,sub,mul,dot,cross,norm,unit,rotate,qconj,clamp} from '../shared/math.ts';
import {EARTH} from './physics-reference.ts';

// Body x: forward, y: left, z: up. Raycast wheels have massless suspension
// links; their unsprung mass is included in the vehicle rigid-body inertia.
import {WHEEL,GROUND_ALTITUDE} from '../shared/craft.ts';
export {WHEEL} from '../shared/craft.ts';
export function roverForces(sim: Simulation,dt: number,now: number){
  const q=sim.quaternion,inverse=qconj(q),props=sim.props;
  let force=[0,0,0],torque=[0,0,0],watts=0;
  const states: WheelState[]=[];
  const wheels=props.parts.filter(p=>p.type==='wheel');
  const apply=(point: number[],f: number[])=>{force=add(force,f);torque=add(torque,cross(sub(point,props.com),f));};
  const sample=(point: number[])=>{
    const r=sub(point,props.com),world=add(sim.position,rotate(q,r)),up=unit(world);
    const velocity=sub(add(sim.velocity,rotate(q,cross(sim.omega,r))),cross([0,0,EARTH.spin],world));
    return {height:norm(world)-EARTH.radius-GROUND_ALTITUDE,normal:rotate(inverse,up),velocity:rotate(inverse,velocity)};
  };
  for(const p of wheels){
    const c=sim.wheels[p.id],active=!sim.passive&&sim.charge>0&&c?.enabled&&c.expires>now;
    const steering=active?c.steering*.55:0,motor=active?c.motor:0;
    // An expired/disabled controller applies a fail-safe parking brake.
    const brake=active?c.brake:1;
    const anchor=add(p.position,[0,Math.cos(p.angle!)*WHEEL.trackOffset,Math.sin(p.angle!)*WHEEL.trackOffset]);
    const rest=add(anchor,[0,0,-WHEEL.extension]),s=sample(rest);
    const upright=Math.max(0,s.normal[2]);
    const raw=upright>.2?(WHEEL.radius-s.height)/upright:0;
    const compression=clamp(raw,0,WHEEL.travel),grounded=raw>0&&upright>.2;
    const contact=add(rest,[0,0,compression-WHEEL.radius]);
    const v=sample(contact).velocity;
    const normalForce=grounded?Math.max(0,WHEEL.spring*compression-WHEEL.damper*dot(s.velocity,s.normal)+80000*Math.max(0,raw-WHEEL.travel)):0;
    const heading=[Math.cos(steering),Math.sin(steering),0];
    const forward=unit(sub(heading,mul(s.normal,dot(heading,s.normal)))),side=unit(cross(s.normal,forward));
    const speed=dot(v,forward),lateral=dot(v,side);
    const requested=motor*WHEEL.motorForce*Math.max(0,1-Math.max(0,speed*Math.sign(motor))/WHEEL.maxSpeed);
    const longitudinal=requested-clamp(speed*props.mass/(wheels.length*dt),-normalForce*(brake+.015),normalForce*(brake+.015));
    const sideways=-lateral*props.mass/(wheels.length*Math.max(dt,.08));
    const frictionScale=Math.min(1,WHEEL.grip*normalForce/(Math.hypot(longitudinal,sideways)||1));
    const drive=longitudinal*frictionScale;
    apply(contact,add(mul(s.normal,normalForce),add(mul(forward,drive),mul(side,sideways*frictionScale))));
    const motorForce=grounded?requested*frictionScale:0;
    watts+=Math.abs(motorForce*speed)/.8+Math.abs(motorForce)*.05;
    const previous=sim.wheelStates.find(w=>w.id===p.id);
    states.push({id:p.id,grounded,compression,normalForce,steering,speed,motorForce,rotation:((previous?.rotation||0)+speed/WHEEL.radius*dt)%(2*Math.PI)});
  }
  // The chassis and other rigid parts still collide when bottomed out or rolled over.
  // Ground forces never freeze the vehicle, so it can recover from a soft landing.
  for(const p of props.parts.filter(p=>!p.def.radial)){
    const half=[p.def.height/2,(p.def.width||1.25)/2,(p.def.depth||1.25)/2];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const point=add(p.position,[x*half[0],y*half[1],z*half[2]]),s=sample(point);
      if(s.height>=0)continue;
      const vertical=dot(s.velocity,s.normal),load=Math.max(0,-s.height*40000-vertical*1500);
      const tangent=sub(s.velocity,mul(s.normal,vertical));
      apply(point,add(mul(s.normal,load),mul(unit(tangent),-Math.min(load*.5,norm(tangent)*500))));
      if(vertical< -8){sim.impactDamage(-vertical);return {force:[0,0,0],torque:[0,0,0],states,watts:0};}
    }
  }
  return {force,torque,states,watts};
}
