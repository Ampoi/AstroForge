import type {Craft, Part, PartType, PartDefinition, LayoutPart} from './types.ts';
import {record, errorMessage} from './errors.ts';
import {add,mul,sub,dot,inverse3,rotate} from './math.ts';
import {SLIM_DIAMETER} from './part-dimensions.ts';

export function sensorName(id:string){const value=id.replace(/_+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'sensor';return /^\d/.test(value)?'_'+value:value;}
export const DIAMETER=1.25;
export const G0=9.80665;
// The surrounding ground is below the launch deck (deck altitude = 0).
export const GROUND_ALTITUDE=-1.12;
export const WHEEL={radius:.45,extension:.55,travel:.4,spring:18000,damper:850,trackOffset:.32,motorForce:900,maxSpeed:12,grip:.85};
const definitions={
  docking:{name:'ドッキングポート',label:'DP-30 Capture port',category:'structure',description:'低速で対向するポートを結合。UDPで切り離し・ポートカメラを操作。',mass:18,height:.3,width:.3,depth:.3,radial:true,color:'#bac9ce'},
  servo:{name:'回転サーボ',label:'RJ-180 Stack hinge',category:'robotics',description:'機首側のパーツを機体Z軸周り±90°に回転。最大180 N·m。',mass:25,height:.4,width:.5,depth:.5,color:'#d9a651'},
  linear:{name:'直動モーター',label:'LJ-2 Telescopic joint',category:'robotics',description:'機首側のパーツを軸方向へ0〜2 m伸縮。最大1500 N。',mass:30,height:.5,width:.5,depth:.5,color:'#91a5b0'},
  lidar2d:{name:'2D LiDAR',label:'LS-360 Planar scanner',category:'sensors',description:'360方向・360°の距離走査。公開UDPでLaserScan互換データを配信。',mass:3,height:.2,width:.2,depth:.2,radial:true,color:'#52cfc0'},
  lidar3d:{name:'3D LiDAR',label:'LS-3D Hemisphere scanner',category:'sensors',description:'512方向の半球距離走査。点群の復元に対応。',mass:5,height:.25,width:.25,depth:.25,radial:true,color:'#56aacd'},
  camera:{name:'RGBカメラ',label:'CAM-64 Optical sensor',category:'sensors',description:'64×48 RGB画像・垂直視野60°。5 HzでUDP配信。',mass:2,height:.2,width:.2,depth:.2,radial:true,color:'#7b94b4'},
  startracker:{name:'スタートラッカー',label:'ST-1 Attitude sensor',category:'sensors',description:'姿勢観測。大気・太陽・遮蔽・角速度による追尾喪失と再捕捉。',mass:4,height:.3,width:.3,depth:.3,radial:true,color:'#bca4d8'},
  pod:{name:'コマンドポッド',label:'CP-1 Pathfinder',category:'command',description:'フライトコンピューターと姿勢用リアクションホイール。',mass:220,height:1.25,color:'#e0e8e8',power:80,wheelTorque:180},
  tank:{name:'燃料タンク',label:'FT-1200 Propellant',category:'fuel',description:'液体燃料・酸化剤をまとめて搭載。スタックして容量を追加。',mass:90,height:2.4,fuel:1200,color:'#dce2de'},
  engine:{name:'液体燃料エンジン',label:'LE-60 Kestrel',category:'propulsion',description:'60 kN・ジンバル ±6°。推力はUDPで個別に指定。',mass:150,height:1.05,thrust:60000,isp:310,ispVac:345,color:'#9caab0'},
  decoupler:{name:'分離リング',label:'DC-125 Stack separator',category:'structure',description:'このリングと下側の段を切り離します。上段エンジンの下に挟むと多段化できます。',mass:28,height:.22,impulse:120,color:'#e3ae58'},
  fin:{name:'安定翼',label:'AF-1 Delta fin',category:'aero',description:'空力で機体を安定化。ミラー・放射状対称に対応。',mass:12,height:0.9,area:0.55,radial:true,color:'#d1dbdc'},
  rcs:{name:'RCSスラスター',label:'RC-4 Attitude block',category:'propulsion',description:'最大250 N。独立した一液式推進剤を搭載。',mass:9,height:0.28,radial:true,mono:8,thrust:250,color:'#a8b4bd'},
  battery:{name:'バッテリー',label:'EC-800 Power bank',category:'electrical',description:'800 Wh。制御装置とリアクションホイールに給電。',mass:35,height:0.32,power:800,color:'#465966'},
  chassis:{name:'直方体シャーシ',label:'CH-400 Rover frame',category:'structure',description:'4 × 1.8 × 0.45 m の構造フレーム。左右にタイヤを取り付けてローバーを構成。',mass:180,height:4,width:1.8,depth:.45,color:'#c5c9b7'},
  wheel:{name:'サスペンション付きタイヤ',label:'RW-45 Electric wheel',category:'mobility',description:'半径0.45 m。独立ばね・ダンパー、電動駆動・操舵・ブレーキ。UDPで個別操作。',mass:35,height:.9,radial:true,color:'#30383d'},
  solar:{name:'ソーラーパネル',label:'SP-120 Solar array',category:'electrical',description:'最大120 W。太陽方向と地球の影に応じて発電。',mass:8,height:0.8,radial:true,watts:120,color:'#36778e'}
} satisfies Record<PartType, PartDefinition>;
export const PARTS: {[K in PartType]: typeof definitions[K] & PartDefinition} = definitions;
export function starterCraft(): Craft{
  return {name:'Pathfinder 01',parts:[
    {id:'pod_1',type:'pod'},{id:'battery_1',type:'battery'},
    {id:'tank_1',type:'tank'},{id:'tank_2',type:'tank'},{id:'engine_1',type:'engine'},
    ...Array.from({length:4},(_,i)=>({id:`fin_${i+1}`,type:'fin' as const,parent:'tank_2',offset:-0.34,angle:i*Math.PI/2,group:'fins_1'})),
    ...Array.from({length:4},(_,i)=>({id:`rcs_${i+1}`,type:'rcs' as const,parent:'tank_1',offset:0.32,angle:i*Math.PI/2,group:'rcs_1'}))
  ]};
}
export function roverCraft(): Craft{
  return {name:'Trailblazer 01 / Rover',parts:[
    {id:'pod_1',type:'pod'},{id:'chassis_1',type:'chassis'},{id:'battery_1',type:'battery'},
    ...[-.4,.4].flatMap((offset,i)=>[0,Math.PI].map((angle,j)=>({id:`wheel_${i?'front':'rear'}_${j?'right':'left'}`,type:'wheel' as const,parent:'chassis_1',offset,angle})))
  ]};
}
export function isRover(craft: Craft){return craft.parts.some(p=>p.type==='wheel');}
export function twoStageCraft(){
  const craft=starterCraft();craft.name='Pathfinder 02 / Two stage';
  craft.parts.splice(3,0,{id:'upper_engine',type:'engine'},{id:'separator_1',type:'decoupler'});
  // This suborbital demo stages inside the atmosphere; the upper stage needs
  // its own tail fins after the first stage takes the original fins with it.
  craft.parts.push(...Array.from({length:4},(_,i)=>({id:`upper_fin_${i+1}`,type:'fin' as const,parent:'tank_1',offset:-.4,angle:i*Math.PI/2,group:'upper_fins'})));
  return craft;
}
export function validateCraft(value: unknown): Craft{
  const input=record(value);
  if(!input||typeof input.name!=='string'||!Array.isArray(input.parts)||input.parts.length>80)throw Error('機体名と80個以内のパーツが必要です');
  if(!input.name.trim()||input.name.length>48)throw Error('機体名は1〜48文字で指定してください');
  const ids=new Set<string>();
  const parts=input.parts.map((value: unknown)=>{
    const p=record(value);
    if(typeof p.type!=='string'||!Object.hasOwn(PARTS,p.type)||typeof p.id!=='string'||!/^[a-zA-Z0-9_]{1,48}$/.test(p.id)||ids.has(p.id))throw Error('不正なパーツIDです');
    ids.add(p.id);
    const type=p.type as PartType;
    const out: Part={id:p.id,type};
    if(PARTS[type].radial){
      if(typeof p.parent!=='string'||typeof p.angle!=='number'||typeof p.offset!=='number'||!Number.isFinite(p.angle)||!Number.isFinite(p.offset)||Math.abs(p.offset)>.5)throw Error('取り付け位置が不正です');
      if(type==='wheel'&&Math.abs(Math.sin(p.angle))>1e-6)throw Error('タイヤは左右の側面（0°・180°）に取り付けてください');
      Object.assign(out,{parent:p.parent,angle:p.angle%(2*Math.PI),offset:p.offset});
      if(typeof p.group==='string'&&/^[a-zA-Z0-9_]{1,48}$/.test(p.group))out.group=p.group;
      if(p.mirror===true)out.mirror=true;
    }
    return out;
  });
  if(parts.filter(p=>['lidar2d','lidar3d','camera','startracker'].includes(p.type)).length>8)throw Error('センサーは1機体8個までです');
  const sensorNames=parts.filter(p=>['lidar2d','lidar3d','camera','startracker'].includes(p.type)).map(p=>sensorName(p.id));
  if(new Set(sensorNames).size!==sensorNames.length)throw Error('センサーIDは大文字・小文字を区別せず一意にしてください');
  const core=parts.filter(p=>!PARTS[p.type].radial);
  if(parts.filter(p=>p.type==='pod').length!==1)throw Error('コマンドポッドを1個配置してください');
  if(core.some((p,i)=>p.type==='engine'&&i!==core.length-1&&core[i+1].type!=='decoupler'))throw Error('エンジンの下には分離リングを配置してください');
  for(const p of parts.filter(p=>PARTS[p.type].radial))if(!core.some(c=>c.id===p.parent&&c.type!=='engine'))throw Error('側面パーツの取り付け先がありません');
  if(input.rootId!==undefined&&!core.some(p=>p.id===input.rootId))throw Error('ルートパーツがありません');
  return {name:input.name.trim(),...(input.rootId!==undefined?{rootId:input.rootId as string}:{}),parts};
}
// Root of a radial model rests on the hull instead of a fixed floating radius.
export function surfaceRadius(type: PartType,offset=0,angle=0){
  if(type==='chassis')return Math.min(.9/Math.max(1e-9,Math.abs(Math.cos(angle))),.225/Math.max(1e-9,Math.abs(Math.sin(angle))));
  if(type==='pod'){
    const y=Math.max(-.625,Math.min(.625,offset*PARTS.pod.height));
    return y<-.495?.635:y>.505?SLIM_DIAMETER*(.8-(y-.505)/.12*.3):.624-(y+.515)/1.02*(.624-SLIM_DIAMETER*.8);
  }
  if(type==='linear')return SLIM_DIAMETER/2;
  if(type==='tank')return Math.abs(offset)>.46?.636:.615;
  if(type==='battery')return Math.abs(offset)>.37?.633:.62;
  return .64;
}
export function symmetryAngles(angle: number,count: number,mirror=false){
  return mirror?[angle,Math.PI-angle]:Array.from({length:count},(_,i)=>angle+i*2*Math.PI/count);
}
export function stages(craft: Craft){
  const result: Part[][]=[[]];
  for(const p of craft.parts.filter(p=>!PARTS[p.type].radial)){
    if(p.type==='decoupler')result.push([]);
    result.at(-1)!.push(p);
  }
  return result;
}
export function splitCraft(craft: Craft,id: string){
  const core=craft.parts.filter(p=>!PARTS[p.type].radial),index=core.findIndex(p=>p.id===id&&p.type==='decoupler');
  if(index<1||index===core.length-1)throw Error('分離リングの下にパーツが必要です');
  const detachedIds=new Set(core.slice(index).map(p=>p.id));
  const detached=(p: Part)=>detachedIds.has(p.id)||detachedIds.has(p.parent!);
  return {retained:{name:craft.name,parts:craft.parts.filter(p=>!detached(p))},detached:{name:`${craft.name} / detached`,parts:craft.parts.filter(detached)}};
}
// Part positions use body x = nose, y = left, z = up. Datum is the engine base.
export function layoutCraft(craft: Craft): LayoutPart[]{
  const positions=new Map<string, number[]>();let height=0;
  for(const p of craft.parts.filter(p=>!PARTS[p.type].radial).toReversed()){
    const def=PARTS[p.type];positions.set(p.id,[height+def.height/2,0,0]);height+=def.height;
  }
  return craft.parts.map(p=>{
    const d=PARTS[p.type];
    const parent=d.radial?craft.parts.find(c=>c.id===p.parent):null;
    const radius=parent?surfaceRadius(parent.type,p.offset,p.angle)+(({fin:.03,rcs:.04,solar:0} as Partial<Record<PartType, number>>)[p.type] || 0):0;
    const pos=d.radial?[positions.get(p.parent!)![0]+p.offset!*PARTS[parent!.type].height,Math.cos(p.angle!)*radius,Math.sin(p.angle!)*radius]:positions.get(p.id)!;
    return {...p,position:pos,def:d};
  });
}
export function massProperties(craft: Craft,fuelFraction: number | Record<string, number>=1,monoFraction=1,layout:LayoutPart[]=layoutCraft(craft)){
  const parts=layout.map(p=>({...p,mass:p.def.mass+(typeof fuelFraction==='number'?(p.def.fuel||0)*fuelFraction:(fuelFraction[p.id]||0))+(p.def.mono||0)*monoFraction}));
  const mass=parts.reduce((s,p)=>s+p.mass,0);
  const com=mul(parts.reduce((s,p)=>add(s,mul(p.position,p.mass)),[0,0,0]),1/mass);
  const inertia=Array(9).fill(0);
  for(const p of parts){
    const r=sub(p.position,com),rr=dot(r,r),radius=p.def.radial?.18:DIAMETER/2;
    const own=p.def.width&&p.def.depth?[p.mass*(p.def.width**2+p.def.depth**2)/12,p.mass*(p.def.height**2+p.def.depth**2)/12,p.mass*(p.def.height**2+p.def.width**2)/12]:[p.mass*radius**2/2,p.mass*(3*radius**2+p.def.height**2)/12,p.mass*(3*radius**2+p.def.height**2)/12];
    const axes=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(p.rotation??[0,0,0,1],v));
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)inertia[i*3+j]+=p.mass*((i===j?rr:0)-r[i]*r[j])+axes.reduce((sum,axis,k)=>sum+axis[i]*axis[j]*own[k],0);
  }
  return {mass,com,inertia,inverseInertia:inverse3(inertia),parts};
}
export function craftStats(craft: Craft){
  const props=massProperties(craft),dry=massProperties(craft,0,0).mass;
  const fuel=craft.parts.reduce((s,p)=>s+(PARTS[p.type].fuel||0),0);
  const mono=craft.parts.reduce((s,p)=>s+(PARTS[p.type].mono||0),0);
  const thrust=stages(craft).at(-1)!.some(p=>p.type==='engine')?PARTS.engine.thrust:0;
  const height=craft.parts.reduce((s,p)=>s+(PARTS[p.type].radial?0:PARTS[p.type].height),0);
  const fins=props.parts.filter(p=>p.type==='fin');
  const cp=(height*.75*2+fins.reduce((s,p)=>s+p.position[0]*4,0))/(2+fins.length*4);
  let remainingMass=props.mass,deltaV=0;
  for(const stage of stages(craft).toReversed()){
    const stageFuel=stage.reduce((s,p)=>s+(PARTS[p.type].fuel||0),0),ids=new Set(stage.map(p=>p.id));
    if(stage.some(p=>p.type==='engine')&&stageFuel)deltaV+=PARTS.engine.ispVac*G0*Math.log(remainingMass/(remainingMass-stageFuel));
    remainingMass-=props.parts.filter(p=>ids.has(p.id)||ids.has(p.parent!)).reduce((s,p)=>s+p.mass,0);
  }
  const activeFuel=stages(craft).at(-1)!.reduce((s,p)=>s+(PARTS[p.type].fuel||0),0);
  return {mass:props.mass,dry,fuel,mono,thrust,height,com:props.com[0],cp,stability:(props.com[0]-cp)/DIAMETER,stageCount:stages(craft).length,
    twr:thrust/(props.mass*G0),deltaV,
    burnTime:thrust?activeFuel*PARTS.engine.isp*G0/thrust:0,
    power:craft.parts.reduce((s,p)=>s+(PARTS[p.type].power||0),0)};
}
export function launchIssues(craft: Craft){
  const s=craftStats(craft),issues=[];
  try{validateCraft(craft);}catch(e){issues.push(errorMessage(e));}
  const active=stages(craft).at(-1)!;
  if(isRover(craft)){
    if(craft.parts.filter(p=>p.type==='wheel').length<3)issues.push('ローバーには3輪以上のタイヤを取り付けてください');
    return issues;
  }
  if(!active.some(p=>p.type==='engine'))issues.push('最下段にエンジンを取り付けてください');
  if(!active.some(p=>p.type==='tank'))issues.push('最下段に燃料タンクを取り付けてください');
  for(const p of craft.parts.filter(p=>p.type==='decoupler'))try{splitCraft(craft,p.id);}catch(e){issues.push(errorMessage(e));}
  if(s.thrust&&s.twr<=1)issues.push('推力重量比が1以下です。燃料タンクを減らしてください');
  return issues;
}
