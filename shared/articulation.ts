import type {Craft,LayoutPart} from './types.ts';
import {layoutCraft} from './craft.ts';
import {add,sub,rotate,qmul,axisAngle} from './math.ts';
export const isJoint=(type:string)=>type==='servo'||type==='linear';
/** Stack joints move the entire nose-side subtree; radial children follow it. */
export function articulatedLayout(craft:Craft,positions:Record<string,number>):LayoutPart[]{
  const parts=layoutCraft(craft).map(p=>({...p,rotation:[0,0,0,1]})),core=parts.filter(p=>!p.def.radial);
  for(let i=core.length-1;i>=0;i--){
    const joint=core[i];if(!isJoint(joint.type))continue;
    const ids=new Set(core.slice(0,i).map(p=>p.id)),value=positions[joint.id]??0;
    const rotation=joint.type==='servo'?axisAngle(rotate(joint.rotation,[0,0,1]),value):[0,0,0,1];
    const translation=joint.type==='linear'?rotate(joint.rotation,[value,0,0]):[0,0,0];
    for(const p of parts)if(ids.has(p.id)||ids.has(p.parent!)){
      p.position=add(add(joint.position,rotate(rotation,sub(p.position,joint.position))),translation);
      p.rotation=qmul(rotation,p.rotation);
    }
  }
  return parts;
}
