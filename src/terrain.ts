import * as THREE from 'three';
import {PLANET_RADIUS,TERRAIN_STEP,terrainDirection,terrainCoordinates,terrainVertexSample,terrainColor} from '../shared/terrain.ts';

export function planetTexture(){
  const map=new THREE.DataTexture(new Uint8Array([18,49,76,0]),1,1,THREE.RGBAFormat);
  const worker=new Worker(new URL('./terrain-worker.ts',import.meta.url),{type:'module'});
  const ready=new Promise<void>((resolve,reject)=>{
    worker.onmessage=({data})=>{map.image=data;map.needsUpdate=true;worker.terminate();resolve();};
    worker.onerror=(event)=>{worker.terminate();reject(new Error(event.message));};
  });
  map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  return {map,ready,dispose:()=>worker.terminate()};
}
function groundTexture(){
  const data=new Uint8Array(128*128*4);let seed=73129;
  for(let i=0;i<128*128;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const shade=205+(seed>>>26)*.78;data.set([shade,shade,shade,255],i*4);
  }
  const map=new THREE.DataTexture(data,128,128);map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;return map;
}
// Dense shared cells around the vehicle; exponentially larger cells toward the
// horizon. No planet-sized float32 translations: vertices are relative to an anchor.
const offsets=[0];
for(let i=1;i<=48;i++)offsets.push(offsets[i-1]+(i<=20?1:Math.ceil(1.3**(i-20))));
const grid=[...offsets.slice(1).reverse().map(v=>-v),...offsets];
export class LocalTerrain extends THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>{
  private anchor=new THREE.Vector3();
  private cell='';
  constructor(){
    super(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,map:groundTexture(),roughness:1,metalness:0}));
    this.receiveShadow=true;this.frustumCulled=false;this.visible=false;
  }
  update(fixed:THREE.Vector3,center:THREE.Vector3){
    const [lon,lat]=terrainCoordinates([fixed.y,fixed.x,-fixed.z]);
    const i=Math.floor(lon/TERRAIN_STEP/8)*8,j=Math.floor(lat/TERRAIN_STEP/8)*8,cell=`${i}:${j}`;
    if(cell!==this.cell){
      this.cell=cell;
      const a=terrainDirection(i*TERRAIN_STEP,j*TERRAIN_STEP).map(v=>v*PLANET_RADIUS);
      this.anchor.set(a[1],a[0],-a[2]);
      const positions:number[]=[],colors:number[]=[],uvs:number[]=[],indices:number[]=[],color=new THREE.Color();
      for(const y of grid)for(const x of grid){
        const jj=Math.max(-65536,Math.min(65536,j+y)),direction=terrainDirection((i+x)*TERRAIN_STEP,jj*TERRAIN_STEP),sample=terrainVertexSample(i+x,jj),radius=PLANET_RADIUS+sample.height;
        positions.push(direction[1]*radius-this.anchor.x,direction[0]*radius-this.anchor.y,-direction[2]*radius-this.anchor.z);
        uvs.push((i+x)*TERRAIN_STEP*PLANET_RADIUS/12,jj*TERRAIN_STEP*PLANET_RADIUS/12);
        const rgb=terrainColor(sample);color.setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255,THREE.SRGBColorSpace);colors.push(color.r,color.g,color.b);
      }
      const n=grid.length;
      for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
        const a=y*n+x,b=a+1,c=a+n,d=c+1;
        indices.push(a,b,d,a,d,c);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
      this.geometry.dispose();this.geometry=geometry;
    }
    this.position.copy(this.anchor).sub(fixed).add(center);
  }
}
