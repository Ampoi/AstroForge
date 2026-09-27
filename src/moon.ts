import * as THREE from 'three';

export type MoonImageLoader=(url:string)=>Promise<HTMLImageElement>;
const loadImage:MoonImageLoader=url=>new THREE.ImageLoader().loadAsync(url);

/** Locally bundled, precomputed surface: no synthesis or remote asset requests
 * in the render loop. Albedo and relief are separate so craters follow sunlight. */
export function moonSurface(loader:MoonImageLoader|undefined=typeof document==='undefined'?undefined:loadImage){
  const material=new THREE.MeshStandardMaterial({color:'#92908d',roughness:1,metalness:0});
  material.normalScale.set(1.35,1.35);
  let disposed=false,loaded=false,error:Error|undefined,finish=()=>{};
  const textures:THREE.Texture[]=[];
  const ready=new Promise<void>(resolve=>{
    finish=resolve;
    if(!loader){resolve();return;}
    Promise.all([loader('/assets/moon/color.png'),loader('/assets/moon/normal.png')]).then(images=>{
      if(disposed)return;
      if(images.some(image=>image.width!==4096||image.height!==2048))throw Error('Moon atlas: expected 4096 × 2048');
      for(const [index,image] of images.entries()){
        const texture=new THREE.Texture(image);
        texture.colorSpace=index===0?THREE.SRGBColorSpace:THREE.NoColorSpace;
        texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
        texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;
        textures.push(texture);
      }
      material.map=textures[0];material.normalMap=textures[1];material.color.set('#ffffff');
      material.needsUpdate=true;loaded=true;
    }).catch(reason=>{
      if(disposed)return;
      error=reason instanceof Error?reason:new Error(String(reason));
      console.warn('Moon surface:',error.message);
    }).finally(resolve);
  });
  return {material,ready,get loaded(){return loaded;},get error(){return error;},dispose(){
    if(disposed)return;
    disposed=true;finish();for(const texture of textures)texture.dispose();material.dispose();
  }};
}

export function moonGeometry(radius:number){
  // Atlas centre (longitude zero) is local +Z, the face SolarMap locks to Earth.
  return new THREE.SphereGeometry(radius,128,96).rotateY(-Math.PI/2);
}
