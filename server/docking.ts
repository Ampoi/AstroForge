import type {Simulation} from './physics.ts';
import {add,sub,mul,dot,norm,rotate,qconj,qmul,cross,matVec,inverse3} from '../shared/math.ts';
import {sensorPose} from './sensors.ts';
interface Link{a:Simulation;b:Simulation;portA:string;portB:string;rotation:number[]}
const links=new WeakMap<Simulation,Link>(),cooldown=new WeakMap<Simulation,number>();
export function dockedTogether(a:Simulation,b:Simulation){const link=links.get(a);return !!link&&(link.a===b||link.b===b);}
export function portPose(sim:Simulation,id:string){return sensorPose(sim,sim.props.parts.find(p=>p.id===id)!);}
export function portState(sim:Simulation,id:string){
  const link=links.get(sim),own=link?.a===sim,port=own?link?.portA:link?.portB,partner=own?link?.b:link?.a;
  const docked=!!link&&port===id;
  return {nodeType:'size0',state:docked?'Docked':'Ready',docked,acquiring:false,releasable:docked,cameraActive:sim.selectedDockingCamera===id,partnerName:docked?(own?link!.portB:link!.portA):'',partnerPartFlightId:0,partner};
}
export function releaseDock(sim:Simulation,id:string){
  const link=links.get(sim);if(!link||!(link.a===sim?link.portA===id:link.portB===id))throw Error('docking_port_not_docked');
  links.delete(link.a);links.delete(link.b);cooldown.set(link.a,sim.time+2);cooldown.set(link.b,sim.time+2);
  link.a.collisionGraceUntil=link.b.collisionGraceUntil=sim.time+.5;
  link.a.event(`ドッキング解除 — ${link.portA}`);link.b.event(`ドッキング解除 — ${link.portB}`);
}
function worldInertia(sim:Simulation){
  const axes=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(sim.quaternion,v));
  return Array.from({length:9},(_,n)=>{const i=Math.floor(n/3),j=n%3;let value=0;for(let k=0;k<3;k++)for(let l=0;l<3;l++)value+=axes[k][i]*sim.props.inertia[k*3+l]*axes[l][j];return value;});
}
/** A rigid two-vessel weld; bodies keep independent IDs and resource stores. */
function constrain(link:Link,dt:number){
  const {a,b}=link,ma=a.props.mass,mb=b.props.mass,total=ma+mb;
  const center=mul(add(mul(a.position,ma),mul(b.position,mb)),1/total),velocity=mul(add(mul(a.velocity,ma),mul(b.velocity,mb)),1/total);
  let momentum=[0,0,0];
  for(const s of [a,b])momentum=add(momentum,add(matVec(worldInertia(s),rotate(s.quaternion,s.omega)),mul(cross(sub(s.position,center),sub(s.velocity,velocity)),s.props.mass)));
  const before=[a,b].map(s=>({velocity:[...s.velocity],omega:[...s.omega]}));
  b.quaternion=qmul(a.quaternion,link.rotation);
  const portA=sub(portPose(a,link.portA).origin,a.position),portB=sub(portPose(b,link.portB).origin,b.position);
  const offset=sub(portA,portB);
  a.position=sub(center,mul(offset,mb/total));b.position=add(center,mul(offset,ma/total));
  const inertia=Array(9).fill(0);
  for(const s of [a,b]){const own=worldInertia(s),r=sub(s.position,center),rr=dot(r,r);for(let n=0;n<9;n++){const i=Math.floor(n/3),j=n%3;inertia[n]+=own[n]+s.props.mass*((i===j?rr:0)-r[i]*r[j]);}}
  const omega=matVec(inverse3(inertia),momentum);
  for(const [i,s] of [a,b].entries()){s.velocity=add(velocity,cross(omega,sub(s.position,center)));s.omega=rotate(qconj(s.quaternion),omega);s.acceleration=add(s.acceleration,mul(sub(s.velocity,before[i].velocity),1/dt));s.angularAcceleration=add(s.angularAcceleration,mul(sub(s.omega,before[i].omega),1/dt));}
}
export function updateDocking(bodies:Simulation[],dt=1/120){
  const present=new Set(bodies),handled=new Set<Link>();
  for(const s of bodies){
    const link=links.get(s);if(!link||handled.has(link))continue;handled.add(link);
    if(!present.has(link.a)||!present.has(link.b)||[link.a,link.b].some(v=>v.status==='destroyed')||!link.a.craft.parts.some(p=>p.id===link.portA)||!link.b.craft.parts.some(p=>p.id===link.portB)){links.delete(link.a);links.delete(link.b);continue;}
    constrain(link,dt);
  }
  const eligible=bodies.filter(s=>s.status==='flying'&&!s.passive&&!links.has(s)&&s.time>=(cooldown.get(s)??0)&&s.charge>0);
  for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++){
    const a=eligible[i],b=eligible[j];if(links.has(a)||links.has(b))continue;
    if(norm(sub(a.position,b.position))>a.stats.height+b.stats.height+3)continue;
    for(const pa of a.craft.parts.filter(p=>p.type==='docking'))for(const pb of b.craft.parts.filter(p=>p.type==='docking')){
      if(links.has(a)||links.has(b))continue;
      const x=portPose(a,pa.id),y=portPose(b,pb.id),na=rotate(x.rotation,[1,0,0]),nb=rotate(y.rotation,[1,0,0]);
      const va=add(a.velocity,rotate(a.quaternion,cross(a.omega,rotate(qconj(a.quaternion),sub(x.origin,a.position))))),vb=add(b.velocity,rotate(b.quaternion,cross(b.omega,rotate(qconj(b.quaternion),sub(y.origin,b.position)))));
      if(norm(sub(x.origin,y.origin))>.3||dot(na,nb)>-.98||norm(sub(va,vb))>.5||norm(sub(rotate(a.quaternion,a.omega),rotate(b.quaternion,b.omega)))>.2)continue;
      const link={a,b,portA:pa.id,portB:pb.id,rotation:qmul(qconj(a.quaternion),b.quaternion)};
      links.set(a,link);links.set(b,link);a.clearCommands();b.clearCommands();constrain(link,dt);
      a.event(`ドッキング完了 — ${pa.id}`);b.event(`ドッキング完了 — ${pb.id}`);
    }
  }
}
