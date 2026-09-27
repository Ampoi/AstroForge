import * as THREE from 'three';
import {enhanceWeather,WEATHER_SOURCE_SIZE,WEATHER_DETAIL_SIZE} from './texture-detail.ts';

export const WEATHER_FACE_SIZE=WEATHER_DETAIL_SIZE;
/** RGB are low/middle/high cloud fractions; A blends shallow vs tall low clouds.
 * All layers share a fixed Earth-relative snapshot. No weather generation or
 * network polling happens in the render loop. */
export function weatherTexture(){
  // Flight can render before fetch completes. Cube faces must retain their
  // dimensions after the first GPU upload, including all generated mip levels.
  const clear=new Uint8Array(WEATHER_FACE_SIZE*WEATHER_FACE_SIZE*4);
  const map=new THREE.CubeTexture(Array.from({length:6},()=>new THREE.DataTexture(clear,WEATHER_FACE_SIZE,WEATHER_FACE_SIZE,THREE.RGBAFormat)));
  map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  let disposed=false,worker:Worker|undefined,finish:()=>void=()=>{};
  const ready=fetch('/assets/cloud-weather.rgba').then(response=>{
    if(!response.ok)throw Error(`Weather atlas: HTTP ${response.status}`);
    return response.arrayBuffer();
  }).then(async buffer=>{
    if(buffer.byteLength!==WEATHER_SOURCE_SIZE**2*6*4)throw Error('Weather atlas: invalid dimensions');
    if(disposed)return;
    let data:Uint8Array;
    if(typeof Worker==='undefined')data=enhanceWeather(new Uint8Array(buffer));
    else{
      worker=new Worker(new URL('./weather-worker.ts',import.meta.url),{type:'module'});
      const result=await new Promise<Uint8Array|undefined>((resolve,reject)=>{
        finish=()=>resolve(undefined);
        worker!.onmessage=({data})=>{worker!.terminate();resolve(data);};
        worker!.onerror=event=>{worker!.terminate();reject(Error(event.message));};
        worker!.postMessage(new Uint8Array(buffer),[buffer]);
      });
      if(!result||disposed)return;
      data=result;
    }
    const faceBytes=WEATHER_FACE_SIZE*WEATHER_FACE_SIZE*4;
    map.images=Array.from({length:6},(_,face)=>new THREE.DataTexture(data.subarray(face*faceBytes,(face+1)*faceBytes),WEATHER_FACE_SIZE,WEATHER_FACE_SIZE,THREE.RGBAFormat));map.needsUpdate=true;
  }).catch(error=>console.warn('Cloud weather:',error.message));
  return {map,ready,dispose(){disposed=true;worker?.terminate();finish();map.dispose();}};
}
