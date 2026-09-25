import * as THREE from 'three';
import {FACE_COLORS,faceStandard,type FaceProfile} from '../shared/attachment.ts';

/** An outline follows the mating face rather than a universal radius. */
export function makeFaceGuide(face: FaceProfile,opacity=.65){
  const material=new THREE.MeshBasicMaterial({color:FACE_COLORS[faceStandard(face)],transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false,fog:false});
  const thickness=face.shape==='circle'?Math.min(.012,face.diameter*.06):.01;
  let geometry: THREE.BufferGeometry;
  if(face.shape==='circle'){
    geometry=new THREE.TorusGeometry(face.diameter/2,thickness,6,64);
    geometry.rotateX(Math.PI/2);
  }else{
    const x=face.width/2,z=face.depth/2;
    const points=[[-x,0,-z],[x,0,-z],[x,0,z],[-x,0,z],[-x,0,-z]].map(p=>new THREE.Vector3(...p));
    const path=new THREE.CurvePath<THREE.Vector3>();
    for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(points[i-1],points[i]));
    geometry=new THREE.TubeGeometry(path,32,thickness,6,false);
  }
  const guide=new THREE.Mesh(geometry,material);guide.renderOrder=5;
  guide.userData.attachmentGuide=true;
  return guide;
}
