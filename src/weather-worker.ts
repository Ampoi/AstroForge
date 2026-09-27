import {enhanceWeather} from './texture-detail.ts';
self.onmessage=({data}:{data:Uint8Array})=>{
  const enhanced=enhanceWeather(data);
  postMessage(enhanced,{transfer:[enhanced.buffer]});
};
