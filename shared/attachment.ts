import type {PartType} from './types.ts';
import {PARTS, DIAMETER} from './craft.ts';
import {SLIM_DIAMETER} from './part-dimensions.ts';
export {SLIM_DIAMETER} from './part-dimensions.ts';

export type FaceProfile = {shape:'circle';diameter:number} | {shape:'rectangle';width:number;depth:number};
export const FACE_COLORS={standard:'#99e4d7',slim:'#c2a6ff',custom:'#efbc78'};

/** Body X is the stack axis; the profile lies in the Y/Z plane. */
export function attachmentFace(type: PartType,side: number): FaceProfile | null{
  const def=PARTS[type];
  if(def.radial)return null;
  if(type==='pod'&&side>0||type==='linear')return {shape:'circle',diameter:SLIM_DIAMETER};
  if(type==='servo')return {shape:'rectangle',width:.4,depth:.0896};
  if(def.width&&def.depth)return {shape:'rectangle',width:def.width,depth:def.depth};
  return {shape:'circle',diameter:DIAMETER};
}
export function faceStandard(face: FaceProfile){
  return face.shape==='circle'?(face.diameter===SLIM_DIAMETER?'slim':face.diameter===DIAMETER?'standard':'custom'):'custom';
}
export function faceLabel(face: FaceProfile){
  return face.shape==='circle'?`${faceStandard(face)==='slim'?'細径':faceStandard(face)==='standard'?'標準径':'円形'} ⌀${face.diameter} m`:`矩形 ${face.width} × ${face.depth} m`;
}
export function matchingFaces(a: FaceProfile,b: FaceProfile){
  return a.shape==='circle'&&b.shape==='circle'?Math.abs(a.diameter-b.diameter)<1e-6:
    a.shape==='rectangle'&&b.shape==='rectangle'&&Math.abs(a.width-b.width)<1e-6&&Math.abs(a.depth-b.depth)<1e-6;
}
/** Test the actual profiles, including a small near-contact margin. */
export function facesOverlap(a: FaceProfile,b: FaceProfile,dy:number,dz:number,margin=0){
  if(a.shape==='circle'&&b.shape==='circle')return Math.hypot(dy,dz)<=(a.diameter+b.diameter)/2+margin;
  if(a.shape==='rectangle'&&b.shape==='rectangle')return Math.abs(dy)<=(a.width+b.width)/2+margin&&Math.abs(dz)<=(a.depth+b.depth)/2+margin;
  const circle=a.shape==='circle'?a:b as Extract<FaceProfile,{shape:'circle'}>;
  const rect=a.shape==='rectangle'?a:b as Extract<FaceProfile,{shape:'rectangle'}>;
  return Math.hypot(Math.max(0,Math.abs(dy)-rect.width/2),Math.max(0,Math.abs(dz)-rect.depth/2))<=circle.diameter/2+margin;
}
