import * as THREE from 'three';

export const WEATHER_FACE_SIZE=128;
/** RGB are low/middle/high cloud fractions; A blends shallow vs tall low clouds.
 * All layers share a fixed Earth-relative snapshot. No weather generation or
 * network polling happens in the render loop. */
export function weatherTexture(){
  const map=new THREE.CubeTexture(Array.from({length:6},()=>new THREE.DataTexture(new Uint8Array(4),1,1,THREE.RGBAFormat)));
  map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  let disposed=false;
  const ready=fetch('/assets/cloud-weather.rgba').then(response=>{
    if(!response.ok)throw Error(`Weather atlas: HTTP ${response.status}`);
    return response.arrayBuffer();
  }).then(buffer=>{
    const faceBytes=WEATHER_FACE_SIZE*WEATHER_FACE_SIZE*4;
    if(buffer.byteLength!==faceBytes*6)throw Error('Weather atlas: invalid dimensions');
    if(disposed)return;
    const data=new Uint8Array(buffer);
    map.images=Array.from({length:6},(_,face)=>new THREE.DataTexture(data.subarray(face*faceBytes,(face+1)*faceBytes),WEATHER_FACE_SIZE,WEATHER_FACE_SIZE,THREE.RGBAFormat));map.needsUpdate=true;
  }).catch(error=>console.warn('Cloud weather:',error.message));
  return {map,ready,dispose(){disposed=true;map.dispose();}};
}
