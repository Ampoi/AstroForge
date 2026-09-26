import * as THREE from 'three';
import {PARTS} from '../shared/craft.ts';
import type {PartType} from '../shared/types.ts';
import {makePart,disposeGroup} from './scene.ts';

let images: Map<PartType,string> | undefined;
/** Render the workshop models once, sharing one temporary WebGL context. */
export function partThumbnails(): Map<PartType,string>{
  if(images)return images;
  images=new Map();
  let renderer: THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}
  catch{return images;}
  renderer.setSize(184,208);
  renderer.setClearColor(0,0);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.5;
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff','#738394',3));
  const light=new THREE.DirectionalLight('#fff2dc',4);light.position.set(3,5,4);scene.add(light);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
  const aspect=184/208;
  try{
    for(const type of Object.keys(PARTS) as PartType[]){
      const model=makePart(type);
      scene.add(model);
      try{
        const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());
        camera.position.copy(center).add(new THREE.Vector3(1,1,1).normalize().multiplyScalar(12));
        camera.lookAt(center);camera.updateMatrixWorld(true);
        const projected=new THREE.Box3();
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
          projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
        }
        const size=projected.getSize(new THREE.Vector3());
        const half=Math.max(size.y,size.x/aspect)*.57;
        camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;
        camera.updateProjectionMatrix();
        renderer.render(scene,camera);
        images.set(type,renderer.domElement.toDataURL('image/png'));
      }finally{scene.remove(model);disposeGroup(model);}
    }
  }finally{renderer.dispose();renderer.forceContextLoss();}
  return images;
}
