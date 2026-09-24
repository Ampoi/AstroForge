// SI units, right-handed vectors. Quaternions are [x, y, z, w].
export const add = (a,b) => a.map((v,i)=>v+b[i]);
export const sub = (a,b) => a.map((v,i)=>v-b[i]);
export const mul = (a,s) => a.map(v=>v*s);
export const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm = a => Math.hypot(...a);
export const unit = a => mul(a,1/(norm(a)||1));
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const qnorm = q => mul(q,1/(norm(q)||1));
export const qconj = q => [-q[0],-q[1],-q[2],q[3]];
export const qmul = (a,b) => [...add(add(mul(b.slice(0,3),a[3]),mul(a.slice(0,3),b[3])),cross(a,b)),a[3]*b[3]-dot(a.slice(0,3),b.slice(0,3))];
export const rotate = (q,v) => {
  const t=mul(cross(q,v),2);
  return add(v,add(mul(t,q[3]),cross(q,t)));
};
export const axisAngle = (axis,angle) => [...mul(unit(axis),Math.sin(angle/2)),Math.cos(angle/2)];
export const matVec = (m,v) => [dot(m.slice(0,3),v),dot(m.slice(3,6),v),dot(m.slice(6,9),v)];
export function inverse3(m) {
  const [a,b,c,d,e,f,g,h,i]=m;
  const inv=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det=a*inv[0]+b*inv[3]+c*inv[6];
  return inv.map(v=>v/det);
}
