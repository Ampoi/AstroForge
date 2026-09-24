import {PARTS,layoutCraft,craftStats,surfaceRadius,symmetryAngles,validateCraft} from './craft.js';
import {SNAP_DISTANCE,SURFACE_LEVELS,SURFACE_ANGLES} from './placement.js';

// The workshop is a forest. Only the tree containing rootId belongs to the vehicle.
// Positions stay in the workshop's body frame when a branch is disconnected.
export function emptyAssembly(name='新しい機体'){
  return {name,assemblyVersion:1,rootId:null,parts:[]};
}
export function toAssembly(craft){
  if(craft.assemblyVersion===1)return structuredClone(craft);
  const result=emptyAssembly(craft.name),core=craft.parts.filter(p=>!PARTS[p.type].radial);
  result.rootId=craft.rootId||core[0]?.id||null;
  const rootIndex=core.findIndex(p=>p.id===result.rootId);
  result.parts=layoutCraft(craft).map(({def,...p})=>{
    if(!def.radial){const i=core.findIndex(c=>c.id===p.id);p.parent=i===rootIndex?null:core[i+(i<rootIndex?1:-1)]?.id||null;}
    return p;
  });
  return result;
}
export function restoreAssembly(input){
  if(input?.assemblyVersion!==1)return toAssembly(validateCraft(input));
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>48||!Array.isArray(input.parts)||input.parts.length>80)throw Error('不正な下書きです');
  const ids=new Set();
  for(const p of input.parts){
    if(!PARTS[p.type]||typeof p.id!=='string'||!/^[a-zA-Z0-9_]{1,48}$/.test(p.id)||ids.has(p.id)||!Array.isArray(p.position)||p.position.length!==3||!p.position.every(Number.isFinite))throw Error('不正な下書きのパーツです');
    if(PARTS[p.type].radial&&(!Number.isFinite(p.offset)||Math.abs(p.offset)>.5||!Number.isFinite(p.angle)))throw Error('不正な取り付け位置です');
    ids.add(p.id);
  }
  if(input.parts.length?(!ids.has(input.rootId)||input.parts.find(p=>p.id===input.rootId).parent||PARTS[input.parts.find(p=>p.id===input.rootId).type].radial):input.rootId!==null)throw Error('ルートが不正です');
  const byId=new Map(input.parts.map(p=>[p.id,p]));
  for(const p of input.parts){
    const seen=new Set([p.id]);let parent=p.parent;
    while(parent){if(!ids.has(parent)||seen.has(parent))throw Error('接続関係が不正です');seen.add(parent);parent=byId.get(parent).parent;}
  }
  return structuredClone(input);
}
export function descendantIds(craft,roots){
  const ids=new Set(roots);let changed=true;
  while(changed){changed=false;for(const p of craft.parts)if(p.parent&&ids.has(p.parent)&&!ids.has(p.id)){ids.add(p.id);changed=true;}}
  return ids;
}
export function connectedIds(craft){return descendantIds(craft,craft.rootId?[craft.rootId]:[]);}
export function movingIds(craft,id){
  const p=craft.parts.find(p=>p.id===id);
  return descendantIds(craft,p?.group?craft.parts.filter(c=>c.group===p.group).map(c=>c.id):p?[id]:[]);
}
export function assembledCraft(craft){
  if(craft.assemblyVersion!==1)return craft;
  const ids=connectedIds(craft),parts=craft.parts.filter(p=>ids.has(p.id));
  const core=parts.filter(p=>!PARTS[p.type].radial).sort((a,b)=>b.position[0]-a.position[0]);
  return {name:craft.name,...(craft.rootId&&craft.rootId!==core[0]?.id?{rootId:craft.rootId}:{}),parts:[...core,...parts.filter(p=>PARTS[p.type].radial)].map(p=>{
    const out={id:p.id,type:p.type};
    if(PARTS[p.type].radial)for(const key of ['parent','offset','angle','group','mirror'])if(p[key]!==undefined)out[key]=p[key];
    return out;
  })};
}
export function assemblyStats(craft){
  const active=assembledCraft(craft);
  if(active.parts.length)return craftStats(active);
  return {mass:0,dry:0,fuel:0,mono:0,thrust:0,height:0,com:0,cp:0,stability:0,stageCount:0,twr:0,deltaV:0,burnTime:0,power:0};
}
export function assemblyLayout(craft){
  if(craft.assemblyVersion!==1)return layoutCraft(craft);
  const ids=connectedIds(craft);
  return craft.parts.map(p=>({...p,def:PARTS[p.type],connected:ids.has(p.id)}));
}
function surfacePosition(parent,type,offset,angle){
  const radius=surfaceRadius(parent.type,offset)+({fin:.03,rcs:.04,solar:0}[type]||0);
  return [parent.position[0]+offset*PARTS[parent.type].height,parent.position[1]+Math.cos(angle)*radius,parent.position[2]+Math.sin(angle)*radius];
}
function endPosition(p,side){return [p.position[0]+side*PARTS[p.type].height/2,...p.position.slice(1)];}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function occupied(craft,p,side,exclude){
  const end=endPosition(p,side);
  return craft.parts.some(c=>c.id!==p.id&&!exclude.has(c.id)&&(c.parent===p.id||p.parent===c.id)&&!PARTS[c.type].radial&&distance(end,endPosition(c,-side))<.001);
}
export function resolveAssemblyPlacement(craft,type,hit,{point=[4,0,0],movingId=null,snap=true}={}){
  const moving=craft.parts.find(p=>p.id===movingId),exclude=movingIds(craft,movingId);
  const free={kind:!craft.rootId?'root':'free',position:[...point],snapped:false};
  if(movingId===craft.rootId)return {...free,kind:'root'};
  const target=craft.parts.find(p=>p.id===hit?.id&&!exclude.has(p.id));
  if(PARTS[type].radial){
    if(!target||PARTS[target.type].radial||target.type==='engine'||Math.abs(hit.normal?.[0]||0)>.85)return free;
    let offset=Math.max(-.5,Math.min(.5,(hit.point[0]-target.position[0])/PARTS[target.type].height));
    let angle=Math.atan2(hit.point[2]-target.position[2],hit.point[1]-target.position[1]),snapped=false;
    if(snap){
      let nearest=SNAP_DISTANCE;const rawOffset=offset,rawAngle=angle;
      for(const level of SURFACE_LEVELS)for(const a of SURFACE_ANGLES){
        const delta=Math.atan2(Math.sin(rawAngle-a),Math.cos(rawAngle-a));
        const d=Math.hypot((rawOffset-level)*PARTS[target.type].height,delta*surfaceRadius(target.type,rawOffset));
        if(d<nearest){nearest=d;offset=level;angle=a;snapped=true;}
      }
    }
    return {kind:'surface',parent:target.id,offset,angle,snapped,position:surfacePosition(target,type,offset,angle)};
  }
  if(!snap)return free;
  // Only free mating faces can connect; neither an occupied face nor a descendant
  // can silently reparent a branch or create a cycle.
  const candidates=target?[target]:craft.parts.filter(p=>!exclude.has(p.id));
  let best=null,nearest=.55;
  for(const p of candidates){
    if(PARTS[p.type].radial)continue;
    for(const side of [1,-1]){
      if(occupied(craft,p,side,exclude))continue;
      if(moving&&occupied(craft,moving,-side,new Set(craft.parts.filter(c=>!exclude.has(c.id)).map(c=>c.id))))continue;
      const end=endPosition(p,side),position=[end[0]+side*PARTS[type].height/2,end[1],end[2]];
      const d=target?Math.abs(hit.point[0]-end[0]):distance(point,position);
      if(d<nearest){nearest=d;best={kind:'stack',parent:p.id,side,position,snapped:true};}
    }
  }
  return best||free;
}
export function placeAssembly(craft,type,placement,{movingId=null,count=1,mirror=false,idFactory=(type,i)=>`preview_${type}_${i}`}={}){
  const result=structuredClone(craft);
  if(!placement)return result;
  let p=result.parts.find(p=>p.id===movingId),ids=movingIds(result,movingId),roots=[];
  if(!p){
    count=PARTS[type].radial&&placement.kind==='surface'?(mirror?2:count):1;
    if(result.parts.length+count>80)throw Error('パーツは80個まで配置できます');
    const group=count>1?idFactory('group',0):undefined;
    for(let i=0;i<count;i++){
      const part={id:idFactory(type,i),type,parent:null,position:[...placement.position]};
      if(PARTS[type].radial)Object.assign(part,{offset:0,angle:0});
      if(group)part.group=group;if(mirror&&count>1)part.mirror=true;
      roots.push(part);result.parts.push(part);
    }
    p=roots[0];ids=new Set(roots.map(c=>c.id));
    if(!result.rootId)result.rootId=p.id;
  }else roots=result.parts.filter(c=>ids.has(c.id)&&!ids.has(c.parent));
  const delta=placement.position.map((v,i)=>v-p.position[i]);
  for(const c of result.parts)if(ids.has(c.id))c.position=c.position.map((v,i)=>v+delta[i]);
  for(const c of roots)c.parent=placement.parent||null;
  if(placement.kind==='surface'){
    const parent=result.parts.find(c=>c.id===placement.parent),oldAngle=p.angle;
    const angles=movingId?roots.map(c=>p.mirror?(c.id===p.id?placement.angle:Math.PI-placement.angle):c.angle+placement.angle-oldAngle):symmetryAngles(placement.angle,roots.length,mirror);
    roots.forEach((c,i)=>{
      c.offset=placement.offset;c.angle=angles[i];c.position=surfacePosition(parent,c.type,c.offset,c.angle);
    });
  }
  // Keep the connected vehicle above the workshop floor when extending its base.
  // Translate the whole root tree, so attachment geometry is unchanged.
  const connected=connectedIds(result),core=result.parts.filter(c=>connected.has(c.id)&&!PARTS[c.type].radial);
  const bottom=Math.min(...core.map(c=>c.position[0]-PARTS[c.type].height/2));
  if(bottom<0)for(const c of result.parts)if(connected.has(c.id))c.position[0]-=bottom;
  return result;
}
export function removeAssembly(craft,id){
  const ids=movingIds(craft,id),result=structuredClone(craft);
  result.parts=result.parts.filter(p=>!ids.has(p.id));
  if(ids.has(result.rootId))return emptyAssembly(craft.name);
  return result;
}
