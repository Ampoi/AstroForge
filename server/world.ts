import {updateDocking,dockedTogether} from './docking.ts';
import type {FlightSnapshot} from './types.ts';
import type {Craft} from '../shared/types.ts';
import {Simulation,STEP,EARTH} from './physics.ts';
import {add,sub,mul,dot,norm,unit,rotate,axisAngle,cross,clamp,qmul,qconj} from '../shared/math.ts';

export const TIME_SCALES=[1,2,5,10];
const alive=(body: Simulation)=>body.status!=='destroyed';
const flatten=(body: Simulation): Simulation[]=>[body,...body.debris.flatMap(flatten)];

// A chain of small spheres follows each stack part. Relative swept tests prevent
// fast vehicles passing through one another between fixed 1/120 second steps.
function spheres(body: Simulation,position=body.position,q=body.quaternion){
  return body.props.parts.flatMap(p=>{
    const radius=p.def.radial?.22:Math.min(.625,p.def.height/2);
    const half=p.def.radial?0:Math.max(0,p.def.height/2-radius),count=Math.max(1,Math.ceil(half*2/.4));
    return Array.from({length:count+1},(_,i)=>({radius,center:add(position,rotate(q,sub(add(p.position,rotate(p.rotation??[0,0,0,1],[-half+2*half*i/count,0,0])),body.props.com)))}));
  });
}
function contact(a: Simulation,b: Simulation,previous: Map<string,{position:number[];quaternion:number[]}>){
  const pa=previous.get(a.id),pb=previous.get(b.id);
  if(!pa||!pb)return null;
  const travel=norm(sub(a.position,pa.position))+norm(sub(b.position,pb.position));
  if(norm(sub(a.position,b.position))>a.stats.height+b.stats.height+4+travel)return null;
  const ac=spheres(a),bc=spheres(b),ap=spheres(a,pa.position,pa.quaternion),bp=spheres(b,pb.position,pb.quaternion);
  for(let i=0;i<ac.length;i++)for(let j=0;j<bc.length;j++){
    const start=sub(ap[i].center,bp[j].center),end=sub(ac[i].center,bc[j].center),delta=sub(end,start),radius=ac[i].radius+bc[j].radius;
    const t=clamp(-dot(start,delta)/(dot(delta,delta)||1),0,1),closest=add(start,mul(delta,t));
    if(norm(closest)>radius)continue;
    const normal=unit(norm(start)>1e-7?start:sub(a.velocity,b.velocity));
    const closing=-dot(sub(a.velocity,b.velocity),normal);
    if(closing>.05)return {normal,speed:closing};
  }
  return null;
}

export class FlightWorld{
  time=0; timeScale=1; accumulator=0; slowFrames=0; vehicles: Simulation[]=[]; activeId!: string;
  constructor(craft: Craft){this.time=0;this.timeScale=1;this.accumulator=0;this.slowFrames=0;this.vehicles=[];this.add(craft);}
  get bodies(){return this.vehicles.flatMap(flatten);}
  get active(){return this.vehicles.find(v=>v.id===this.activeId)!;}
  add(craft: Craft){
    const body=new Simulation(craft);body.environmentBodies=()=>this.bodies;
    const rotation=axisAngle([0,0,1],EARTH.spin*this.time);
    body.position=rotate(rotation,body.position);body.quaternion=qmul(rotation,body.quaternion);body.omega=rotate(qconj(body.quaternion),[0,0,EARTH.spin]);body.velocity=cross([0,0,EARTH.spin],body.position);
    // Only an unlaunched pad occupant is replaced; existing flights keep running.
    const occupant=this.vehicles.find(v=>v.status==='pad');
    const nearPad=this.bodies.some(v=>v!==occupant&&alive(v)&&norm(sub(v.position,body.position))<v.stats.height+body.stats.height+4);
    if(nearPad)throw Error('発射台付近に機体があります。離れるまでお待ちください');
    const retained=this.vehicles.filter(v=>v!==occupant);
    if(retained.length>=12)throw Error('同時に配置できる機体は12機までです');
    body.createdAt=this.time;body.time=this.time;this.vehicles=[...retained,body];this.activeId=body.id;return body;
  }
  setTimeScale(scale: unknown){if(typeof scale!=='number'||!TIME_SCALES.includes(scale))throw Error('倍率は1・2・5・10のいずれかです');this.timeScale=scale;}
  step(dt=STEP,now=this.time){
    const before=this.bodies,previous=new Map(before.map(v=>[v.id,{position:[...v.position],quaternion:[...v.quaternion]}]));
    for(const v of this.vehicles)v.step(dt,now);
    this.time+=dt;updateDocking(this.bodies,dt);
    const bodies=this.bodies.filter(v=>alive(v)&&!(v.collisionGraceUntil>this.time));
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
      const a=bodies[i],b=bodies[j];if(!alive(a)||!alive(b)||dockedTogether(a,b))continue;
      const hit=contact(a,b,previous);if(!hit)continue;
      if(hit.speed>=8){a.impactDamage(hit.speed,'vehicle');b.impactDamage(hit.speed,'vehicle');}
      else{
        const impulse=hit.speed*1.15/(1/a.props.mass+1/b.props.mass);
        a.velocity=add(a.velocity,mul(hit.normal,impulse/a.props.mass));b.velocity=sub(b.velocity,mul(hit.normal,impulse/b.props.mass));
        for(const v of [a,b]){if(['pad','landed','crashed'].includes(v.status))v.status='flying';v.event(`機体との接触 — ${hit.speed.toFixed(1)} m/s`);}
      }
    }
  }
  advance(elapsed: number,now: number){
    this.accumulator+=Math.min(elapsed,.25)*this.timeScale;
    let steps=0;
    while(this.accumulator+1e-12>=STEP&&steps<300){this.step(STEP,now);this.accumulator=Math.max(0,this.accumulator-STEP);steps++;}
    if(elapsed>.25)this.slowFrames++;
    return steps;
  }
  snapshots(cache=new Map<Simulation,FlightSnapshot>()){return this.bodies.map(v=>{const {debris,...snapshot}=v.snapshot(cache);return {...snapshot,controllable:!v.passive&&!['destroyed','crashed','landed'].includes(v.status),trail:v.trail.filter((_,i)=>i%Math.max(1,Math.floor(v.trail.length/360))===0)};});}
}
