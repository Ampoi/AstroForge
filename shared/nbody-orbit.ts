import {add,sub,mul,dot,norm} from './math.ts';
import {EARTH_RADIUS,SUN_RADIUS,MOON_RADIUS,earthPosition,moonRelativePosition} from './solar-system.ts';

export const EARTH_MU=3.986004418e14;
export const SUN_MU=1.32712440018e20;
export const MOON_MU=4.9048695e12;
const pointGravity=(r:number[],mu:number)=>mul(r,-mu/Math.max(1,norm(r))**3);
/** Differential third-body gravity in the translating, non-rotating Earth frame.
 * Subtract Earth's acceleration as well as adding gravity at the spacecraft. */
export function thirdBodyGravity(position:number[],time:number){
  const sun=earthPosition(time).map(v=>-v),moon=moonRelativePosition(time);
  const acceleration=[0,0,0];
  for(let bodyIndex=0;bodyIndex<2;bodyIndex++){
    const body=bodyIndex===0?sun:moon,mu=bodyIndex===0?SUN_MU:MOON_MU;
    const dx=body[0]-position[0],dy=body[1]-position[1],dz=body[2]-position[2];
    const distance=Math.max(1,Math.hypot(dx,dy,dz)),earthDistance=Math.hypot(...body);
    const atCraft=mu/distance**3,atEarth=mu/earthDistance**3;
    acceleration[0]+=dx*atCraft-body[0]*atEarth;
    acceleration[1]+=dy*atCraft-body[1]*atEarth;
    acceleration[2]+=dz*atCraft-body[2]*atEarth;
  }
  return acceleration;
}
export function nbodyGravity(position:number[],time:number){return add(pointGravity(position,EARTH_MU),thirdBodyGravity(position,time));}
export interface OrbitSample{time:number;position:number[]}
export interface NumericalOrbit{samples:OrbitSample[];end:'duration'|'impact'|'budget'|'invalid';impact?:'earth'|'moon'|'sun';steps:number;duration:number}
export interface PredictionOptions{duration?:number;tolerance?:number;maxSteps?:number;maxStep?:number;thirdBodies?:boolean}
function rk4(state:number[],time:number,dt:number,thirdBodies:boolean){
  const derivative=(s:number[],t:number)=>[...s.slice(3),...(thirdBodies?nbodyGravity(s.slice(0,3),t):pointGravity(s.slice(0,3),EARTH_MU))];
  const offset=(a:number[],scale:number)=>state.map((v,i)=>v+a[i]*scale);
  const a=derivative(state,time),b=derivative(offset(a,dt/2),time+dt/2),c=derivative(offset(b,dt/2),time+dt/2),d=derivative(offset(c,dt),time+dt);
  return state.map((v,i)=>v+dt*(a[i]+2*b[i]+2*c[i]+d[i])/6);
}
function centers(time:number){return [{id:'earth' as const,position:[0,0,0],radius:EARTH_RADIUS,mu:EARTH_MU},
  {id:'moon' as const,position:moonRelativePosition(time),radius:MOON_RADIUS,mu:MOON_MU},
  {id:'sun' as const,position:mul(earthPosition(time),-1),radius:SUN_RADIUS,mu:SUN_MU}];}
export function predictionDuration(position:number[],velocity:number[],time=0){
  const moon=moonRelativePosition(time),relative=sub(position,moon);
  const lunar=MOON_MU/norm(relative)**2>EARTH_MU/norm(position)**2;
  const r=lunar?relative:position,mu=lunar?MOON_MU:EARTH_MU;
  const v=lunar?sub(velocity,mul(sub(moonRelativePosition(time+1),moonRelativePosition(time-1)),.5)):velocity;
  const energy=dot(v,v)/2-mu/norm(r);
  const period=energy<0?2*Math.PI*Math.sqrt((-mu/(2*energy))**3/mu):Infinity;
  return Math.min(30*86400,Math.max(600,period));
}
/** Adaptive RK4 step doubling, local position error in metres. Bounded work for
 * interactive previews. Ephemerides move during every derivative evaluation.
 * No thrust, drag, terrain relief, oblateness or mutual planetary perturbations. */
export function predictNBodyOrbit(position:number[],velocity:number[],time:number,options:PredictionOptions={}):NumericalOrbit{
  const result:NumericalOrbit={samples:[],end:'invalid',steps:0,duration:0};
  const duration=options.duration??predictionDuration(position,velocity,time),tolerance=options.tolerance??2;
  const maxSteps=options.maxSteps??4096,maxStep=options.maxStep??3600,thirdBodies=options.thirdBodies??true;
  if(position.length!==3||velocity.length!==3||![...position,...velocity,time,duration,tolerance,maxSteps,maxStep].every(Number.isFinite)||duration<=0||tolerance<=0||maxSteps<1||maxStep<=0)return result;
  let state=[...position,...velocity],elapsed=0,dt=Math.min(10,maxStep);
  result.samples.push({time,position:[...position]});result.end='budget';
  const initial=centers(time).find(body=>norm(sub(position,body.position))<=body.radius);
  if(initial){result.end='impact';result.impact=initial.id;return result;}
  for(let attempt=0;attempt<maxSteps&&elapsed<duration;attempt++){
    const epoch=time+elapsed,bodies=centers(epoch);
    // Resolve close approaches even when the requested error tolerance is loose.
    const dynamical=Math.min(...bodies.map(body=>.08*Math.sqrt(norm(sub(state.slice(0,3),body.position))**3/body.mu)));
    dt=Math.min(dt,maxStep,dynamical,duration-elapsed);
    if(dt<1e-5)break;
    const full=rk4(state,epoch,dt,thirdBodies),half=rk4(state,epoch,dt/2,thirdBodies),next=rk4(half,epoch+dt/2,dt/2,thirdBodies);
    if(!next.every(Number.isFinite)){result.end='invalid';break;}
    const error=Math.max(norm(sub(next.slice(0,3),full.slice(0,3))),dt*norm(sub(next.slice(3),full.slice(3))))/15;
    const factor=Math.max(.2,Math.min(2,.9*(tolerance/Math.max(error,1e-12))**.2));
    if(error>tolerance){dt*=factor;continue;}
    // Swept contact against each moving sphere; stop at the first surface.
    const future=centers(epoch+dt);let fraction=1,impact:NumericalOrbit['impact'];
    for(let i=0;i<bodies.length;i++){
      const start=sub(state.slice(0,3),bodies[i].position),end=sub(next.slice(0,3),future[i].position),delta=sub(end,start);
      const a=dot(delta,delta),b=dot(start,delta),c=dot(start,start)-bodies[i].radius**2,disc=b*b-a*c;
      if(a>0&&disc>=0){const hit=(-b-Math.sqrt(disc))/a;if(hit>=0&&hit<=fraction){fraction=hit;impact=bodies[i].id;}}
    }
    elapsed+=dt*fraction;result.steps++;
    const point=impact?state.slice(0,3).map((v,i)=>v+(next[i]-v)*fraction):next.slice(0,3);
    result.samples.push({time:time+elapsed,position:point});result.duration=elapsed;
    if(impact){result.end='impact';result.impact=impact;break;}
    state=next;dt*=factor;
    if(elapsed>=duration-1e-7)result.end='duration';
  }
  return result;
}
