import {add,sub,mul,dot,cross,norm,unit,clamp} from './math.js';

// Osculating two-body path in inertial metres. No thrust, drag, or Earth rotation
// is integrated into this conic; the renderer rotates the whole path at display time.
// Returns the future arc up to impact, one revolution, or a finite escape boundary.
export function predictOrbit(position,velocity,{mu=3.986004418e14,radius=6371000,segments=384,maxRadius=radius*40}={}){
  if(!Array.isArray(position)||!Array.isArray(velocity)||position.length!==3||velocity.length!==3||![...position,...velocity,mu,radius,maxRadius,segments].every(Number.isFinite)||mu<=0||radius<=0||segments<2)return [];
  segments=Math.min(2048,Math.floor(segments));
  const r=norm(position);if(r<radius-.001)return [];
  maxRadius=Math.max(maxRadius,r*1.05);
  const h=cross(position,velocity),hn=norm(h),radial=dot(position,velocity)/r;
  // A radial trajectory has no unique orbital plane. Its geometric path is a line.
  if(hn/Math.sqrt(mu*r)<1e-8){
    const direction=unit(position),energy=dot(velocity,velocity)/2-mu/r;
    const apex=energy<0?-mu/energy:Infinity,points=[[...position]];
    if(radial>0){points.push(mul(direction,Math.min(apex,maxRadius)));if(apex>maxRadius)return points;}
    points.push(mul(direction,radius));return points;
  }
  const ev=sub(mul(cross(velocity,h),1/mu),mul(position,1/r)),e=norm(ev),p=hn*hn/mu;
  const x=e>1e-10?unit(ev):unit(position),y=unit(cross(h,x));
  const start=Math.atan2(dot(position,y),dot(position,x)),tau=Math.PI*2;
  let end=start+tau;
  const future=angle=>{if(e<1)while(angle<start-1e-10)angle+=tau;return angle;};
  // The inbound root is the first physical contact; never draw through Earth.
  if(p/(1+e)<radius&&e>1e-10){
    const impact=future(-Math.acos(clamp((p/radius-1)/e,-1,1)));
    if(impact>=start-1e-10)end=Math.min(end,impact);
  }
  if(e>=1||p/(1-e)>maxRadius){
    const boundary=future(Math.acos(clamp((p/maxRadius-1)/e,-1,1)));
    if(boundary>=start)end=Math.min(end,boundary);
  }
  const points=[[...position]];
  for(let i=1;i<=segments;i++){
    const angle=start+(end-start)*i/segments,den=1+e*Math.cos(angle);
    if(den<=0)break;
    const distance=p/den;
    if(!Number.isFinite(distance)||distance<radius-.01||distance>maxRadius*1.000001)break;
    points.push(add(mul(x,distance*Math.cos(angle)),mul(y,distance*Math.sin(angle))));
  }
  return points;
}
