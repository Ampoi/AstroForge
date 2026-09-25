import type {PhysicsBody, PhysicsKernel} from './types.ts';
import type {ForceTorque} from '../shared/types.ts';
// JavaScript reference backend for numerical parity tests and explicit fallback.
import {add,sub,mul,dot,cross,norm,unit,clamp,qnorm,qconj,qmul,rotate,matVec} from '../shared/math.ts';
import {DIAMETER,G0} from '../shared/craft.ts';

export const EARTH={radius:6371000,mu:3.986004418e14,spin:7.292115e-5,atmosphereDepth:150000};
export const STEP=1/120;
// US Standard Atmosphere 1976 lower layers, geopotential altitude, SI.
const layers=[0,11000,20000,32000,47000,51000,71000,84852];
const lapse=[-.0065,0,.001,.0028,0,-.0028,-.002];
const bases=[{t:288.15,p:101325}];
for(let i=0;i<lapse.length;i++){
  const {t,p}=bases[i],dh=layers[i+1]-layers[i],l=lapse[i],next=t+l*dh;
  bases.push({t:next,p:l?p*(t/next)**(G0/(287.05287*l)):p*Math.exp(-G0*dh/(287.05287*t))});
}
export function atmosphere(alt: number){
  const h=EARTH.radius*Math.max(0,alt)/(EARTH.radius+Math.max(0,alt));
  if(alt>=EARTH.atmosphereDepth)return {density:0,pressure:0,temperature:186.87,sound:274};
  let i=0;while(i<layers.length-1&&h>=layers[i+1])i++;
  let {t,p}=bases[i];
  if(i<lapse.length){const l=lapse[i],next=t+l*(h-layers[i]);p*=l?(t/next)**(G0/(287.05287*l)):Math.exp(-G0*(h-layers[i])/(287.05287*t));t=next;}
  else p*=Math.exp(-(h-layers[i])/6500)*clamp((150000-alt)/30000,0,1);
  return {density:p/(287.05287*t),pressure:p,temperature:t,sound:Math.sqrt(1.4*287.05287*t)};
}
export const gravity = (r: number[],mu=EARTH.mu)=>mul(r,-mu/norm(r)**3);
export function orbitalElements(r: number[],v: number[],mu=EARTH.mu,radius=EARTH.radius){
  const d=norm(r),speed=norm(v),h=cross(r,v),hn=norm(h),energy=speed*speed/2-mu/d;
  const ev=sub(mul(cross(v,h),1/mu),mul(r,1/d)),e=norm(ev);
  const a=Math.abs(energy)>1e-12?-mu/(2*energy):null,p=hn*hn/mu;
  const periapsis=p/(1+e)-radius;
  let apoapsis=null,period=null,timeToApoapsis=null;
  if(energy<0 && a!==null){
    apoapsis=a*(1+e)-radius;period=2*Math.PI*Math.sqrt(a**3/mu);
    if(e>1e-9){const cosE=clamp((1-d/a)/e,-1,1);let E=Math.acos(cosE);if(dot(r,v)<0)E=2*Math.PI-E;
      const M=E-e*Math.sin(E);timeToApoapsis=((Math.PI-M+2*Math.PI)%(2*Math.PI))*Math.sqrt(a**3/mu);
    }else timeToApoapsis=0;
  }
  return {semiMajorAxis:a,eccentricity:e,periapsis,apoapsis,period,timeToApoapsis,energy,angularMomentum:hn,
    inclination:hn?Math.acos(clamp(h[2]/hn,-1,1))*180/Math.PI:0,eccentricityVector:ev,normal:unit(h)};
}
export function rk4(state: number[],dt: number,derivative: (state: number[])=>number[]){
  const k1=derivative(state),k2=derivative(add(state,mul(k1,dt/2))),k3=derivative(add(state,mul(k2,dt/2))),k4=derivative(add(state,mul(k3,dt)));
  return state.map((v,i)=>v+dt*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);
}


export function aerodynamic(sim: PhysicsBody,position: number[],velocity: number[],q: number[],omega: number[]){
    const alt=norm(position)-EARTH.radius,atm=atmosphere(alt);
    const relative=sub(velocity,cross([0,0,EARTH.spin],position));
    const vb=rotate(qconj(q),relative),speed=norm(vb),dynamicPressure=.5*atm.density*speed**2;
    const aoa=speed>1?Math.acos(clamp(vb[0]/speed,-1,1)):0,mach=speed/atm.sound;
    const cd=.25+.32*Math.exp(-(((mach-1.05)/.35)**2))+.65*Math.sin(aoa)**2;
    const area=Math.PI*(DIAMETER/2)**2;
    let force=mul(unit(vb),-dynamicPressure*cd*area),torque=[0,0,0];
    const applyNormal=(point: number[],normal: number[],a: number,slope: number)=>{
      const r=sub(point,sim.props.com),v=add(vb,cross(omega,r)),sp=norm(v);
      if(sp<.001)return;
      const incidence=dot(v,normal)/sp;
      // Small-angle slope with bounded post-stall coefficient; force always dissipates energy.
      const f=mul(normal,-.5*atm.density*sp*sp*a*clamp(slope*incidence,-1.8,1.8));
      force=add(force,f);torque=add(torque,cross(r,f));
    };
    const nose=[sim.stats.height*.75,0,0];
    applyNormal(nose,[0,1,0],area,2);applyNormal(nose,[0,0,1],area,2);
    for(const p of sim.props.parts.filter(p=>p.type==='fin')){
      applyNormal(p.position,rotate(p.rotation??[0,0,0,1],[0,-Math.sin(p.angle!),Math.cos(p.angle!)]),p.def.area!,4.5);
      force=add(force,mul(unit(vb),-dynamicPressure*p.def.area!*.018));
    }
    return {force,torque,q:dynamicPressure,mach,aoa,drag:-dot(force,unit(vb))};
  }

export function integrate(sim: PhysicsBody,start: number[],dt: number,a: ForceTorque){
  const props=sim.props;
  return rk4(start,dt,s=>{
    const r=s.slice(0,3),v=s.slice(3,6),q=qnorm(s.slice(6,10)),w=s.slice(10,13);
    const aero=aerodynamic(sim,r,v,q,w);
    const acceleration=add(gravity(r),mul(rotate(q,add(a.force,aero.force)),1/props.mass));
    const angular=matVec(props.inverseInertia,sub(add(a.torque,aero.torque),cross(w,matVec(props.inertia,w))));
    return [...v,...acceleration,...mul(qmul(q,[...w,0]),.5),...angular];
  });
}
export const javascriptKernel: PhysicsKernel={name:'js',integrate,aerodynamic};
