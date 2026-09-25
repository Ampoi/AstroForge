import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {Simulation} from './physics.ts';
import {sub,rotate,qconj,qmul,clamp} from '../shared/math.ts';
import {PartIdentity} from './part-identity.ts';
const rpy=(q:number[])=>[Math.atan2(2*(q[3]*q[0]+q[1]*q[2]),1-2*(q[0]**2+q[1]**2)),Math.asin(clamp(2*(q[3]*q[1]-q[2]*q[0]),-1,1)),Math.atan2(2*(q[3]*q[2]+q[0]*q[1]),1-2*(q[1]**2+q[2]**2))];
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function vesselModel(sim:Simulation,sessionId:string,vesselId:string,ids:PartIdentity){
  const prefix=`pylon_${vesselId.slice(0,8)}`,parts=sim.props.parts,root=parts[0],frame=(id:string)=>`${prefix}_link_${ids.get(id)}`;
  const links=parts.map(p=>{
    const size=[p.def.height,p.def.width??(p.def.radial?.25:1.25),p.def.depth??(p.def.radial?.25:1.25)];
    const inertia=size.map((_,i)=>p.mass*(size[(i+1)%3]**2+size[(i+2)%3]**2)/12);
    const geometry=`<geometry><box size="${size.join(' ')}"/></geometry>`;
    return `<link name="${frame(p.id)}"><inertial><origin xyz="0 0 0" rpy="0 0 0"/><mass value="${p.mass}"/><inertia ixx="${inertia[0]}" iyy="${inertia[1]}" izz="${inertia[2]}" ixy="0" ixz="0" iyz="0"/></inertial><visual>${geometry}</visual><collision>${geometry}</collision></link>`;
  }).join('');
  const urdf=`<robot name="${prefix}_active_vessel">`+links+parts.slice(1).map(p=>`<joint name="${prefix}_joint_${ids.get(p.id)}" type="fixed"><parent link="${frame(root.id)}"/><child link="${frame(p.id)}"/><origin xyz="${rotate(qconj(root.rotation??[0,0,0,1]),sub(p.position,root.position)).join(' ')}" rpy="${rpy(qmul(qconj(root.rotation??[0,0,0,1]),p.rotation??[0,0,0,1])).join(' ')}"/></joint>`).join('')+'</robot>';
  const modelId=hash(urdf),bundle={type:'pylon_active_vessel_proxy',version:1,sessionId,vesselId,modelId,geometryPolicy:'primitive_proxy_only',persistencePolicy:'memory_only',urdf,rootFrame:frame(root.id),baseToRootPosition:sub(root.position,sim.props.com),baseToRootRotation:root.rotation??[0,0,0,1],partFrames:parts.map(p=>({partFlightId:ids.get(p.id),frame:frame(p.id)}))};
  const compressed=gzipSync(JSON.stringify(bundle)),size=12000,count=Math.ceil(compressed.length/size),sha256=hash(compressed);
  return Array.from({length:count},(_,chunkIndex)=>({sessionId,modelId,encoding:'gzip+base64',sha256,expiresAfterSec:3,chunkIndex,chunkCount:count,data:compressed.subarray(chunkIndex*size,(chunkIndex+1)*size).toString('base64')}));
}
