import type {Craft, PartType, SurfaceHit} from './types.ts';
import {PARTS,layoutCraft,surfaceRadius} from './craft.ts';

export const SNAP_DISTANCE=.12;
export const SURFACE_LEVELS=[-.4,0,.4];
export const SURFACE_ANGLES=Array.from({length:8},(_,i)=>i*Math.PI/4);
const wrap=(a: number)=>Math.atan2(Math.sin(a),Math.cos(a));

// Hit coordinates are in the rocket's body frame, not screen/world coordinates.
// Snapping is a proximity test against individual points; elsewhere the face is free.
export function resolvePlacement(craft: Craft,type: PartType,hit: SurfaceHit | null,{snap=true}={}){
  const def=PARTS[type],target=craft.parts.find(p=>p.id===hit?.id);
  if(!def||!target||PARTS[target.type].radial||type==='pod')return null;
  const part=layoutCraft(craft).find(p=>p.id===target.id)!,localX=hit!.point[0]-part.position[0];
  if(def.radial){
    if(target.type==='engine'||Math.abs(hit!.normal?.[0]||0)>.85)return null;
    let offset=Math.max(-.5,Math.min(.5,localX/part.def.height)),angle=Math.atan2(hit!.point[2],hit!.point[1]);
    let snapped=false;
    if(snap){
      let nearest=SNAP_DISTANCE;const rawOffset=offset,rawAngle=angle;
      for(const level of SURFACE_LEVELS)for(const a of SURFACE_ANGLES){
        const distance=Math.hypot((rawOffset-level)*part.def.height,wrap(rawAngle-a)*surfaceRadius(target.type,rawOffset));
        if(distance<nearest){nearest=distance;offset=level;angle=a;snapped=true;}
      }
    }
    return {kind:'surface',parent:target.id,offset,angle,snapped};
  }
  const core=craft.parts.filter(p=>!PARTS[p.type].radial),i=core.findIndex(p=>p.id===target.id);
  const side=localX>0?'top':'bottom',index=i+(side==='bottom'?1:0);
  if(index===0)return null;
  // Axial components mate on end faces. A side hit selects the nearest end face.
  const trial=[...core];trial.splice(index,0,{id:'placement_preview',type});
  if(trial.some((p,j)=>p.type==='engine'&&j<trial.length-1&&trial[j+1].type!=='decoupler'))return null;
  return {kind:'stack',target:target.id,side,index,snapped:true};
}

export function placementParts(craft: Craft,type: PartType,placement: ReturnType<typeof resolvePlacement>,angles: number[]){
  if(!placement)return null;
  const parts=structuredClone(craft.parts);
  if(placement.kind==='surface'){
    for(let i=0;i<angles.length;i++)parts.push({id:`preview_${i}`,type,parent:placement.parent,offset:placement.offset,angle:angles[i]});
  }else{
    const core=parts.filter(p=>!PARTS[p.type].radial),radial=parts.filter(p=>PARTS[p.type].radial);
    core.splice(placement.index!,0,{id:'preview_0',type});
    return layoutCraft({name:craft.name,parts:[...core,...radial]});
  }
  return layoutCraft({name:craft.name,parts});
}
