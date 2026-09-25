import type {Simulation} from './physics.ts';
import type {WireCommand} from './types.ts';
import {isJoint} from '../shared/articulation.ts';
import {add,sub,mul,cross,dot,rotate,clamp} from '../shared/math.ts';
export interface JointState{position:number;velocity:number;effort:number;current:number;target:number;commandMode:string;commandActive:boolean;powered:boolean;engaged:boolean;locked:boolean}
export const jointLimits=(type:string)=>type==='servo'?{lower:-Math.PI/2,upper:Math.PI/2,speed:1,effort:180}:{lower:0,upper:2,speed:.5,effort:1500};
export function jointStates(sim:Simulation){
  for(const p of sim.craft.parts.filter(p=>isJoint(p.type)))sim.joints[p.id]??={position:0,velocity:0,effort:0,current:0,target:0,commandMode:'position',commandActive:false,powered:sim.charge>0,engaged:false,locked:true};
  return sim.joints;
}
export function jointLoad(sim:Simulation,id:string){
  const core=sim.props.parts.filter(p=>!p.def.radial),index=core.findIndex(p=>p.id===id),joint=core[index],ids=new Set(core.slice(0,index).map(p=>p.id));
  const axis=rotate(joint.rotation??[0,0,0,1],joint.type==='servo'?[0,0,1]:[1,0,0]);
  const children=sim.props.parts.filter(p=>ids.has(p.id)||ids.has(p.parent!));
  const mass=children.reduce((sum,p)=>sum+p.mass,0);
  const inertia=children.reduce((sum,p)=>{const r=sub(p.position,joint.position);return sum+p.mass*(dot(r,r)-dot(r,axis)**2+p.def.height**2/12);},0);
  return {joint,axis,children,load:Math.max(1,joint.type==='servo'?inertia:mass)};
}
export function internalMomentum(sim:Simulation){
  let result=[0,0,0];
  for(const [id,state] of Object.entries(jointStates(sim))){
    const {joint,axis,children}=jointLoad(sim,id);
    for(const p of children){
      const relative=joint.type==='servo'?cross(axis,sub(p.position,joint.position)):axis;
      result=add(result,mul(cross(sub(p.position,sim.props.com),relative),p.mass*state.velocity));
      if(joint.type==='servo')result=add(result,mul(axis,p.mass*p.def.height**2/12*state.velocity));
    }
  }
  return result;
}
export function advanceJoints(sim:Simulation,dt:number,now:number){
  jointStates(sim);
  for(const p of sim.craft.parts.filter(p=>isJoint(p.type))){
    const state=sim.joints[p.id],command=sim.motors[p.id],limits=jointLimits(p.type),load=jointLoad(sim,p.id).load;
    const active=!!command&&command.expires>now&&!sim.passive,powered=sim.charge>0,enabled=active&&command.enabled&&powered;
    Object.assign(state,{powered,commandActive:active,engaged:enabled,locked:!enabled});
    if(!enabled){state.velocity=0;state.effort=0;state.current=0;continue;}
    state.commandMode=command.mode;
    const desired=command.mode==='position'?clamp((clamp(command.position,limits.lower,limits.upper)-state.position)*4,-limits.speed,limits.speed):clamp(command.velocity,-limits.speed,limits.speed);
    state.effort=command.mode==='effort'?clamp(command.effort,-limits.effort,limits.effort):clamp((desired-state.velocity)*load*12,-limits.effort,limits.effort);
    state.velocity=clamp(state.velocity+state.effort/load*dt,-limits.speed,limits.speed);
    const previous=state.position;state.position=clamp(previous+state.velocity*dt,limits.lower,limits.upper);
    state.velocity=(state.position-previous)/dt;
    state.target=command.mode==='position'?clamp(command.position,limits.lower,limits.upper):command.mode==='velocity'?command.velocity:command.effort;
    const watts=Math.abs(state.effort*state.velocity)/.75+5;state.current=watts/24;
    sim.charge=Math.max(0,sim.charge-watts*dt/3600);
  }
}
export type MotorInput=Pick<WireCommand,'enabled'> & {mode:string;position:number;velocity:number;effort:number;expires:number};
