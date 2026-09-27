import {predictNBodyOrbit} from '../shared/nbody-orbit.ts';
self.onmessage=({data}:{data:{generation:number;vehicles:{id:string;position:number[];velocity:number[];time:number}[]}})=>{
  self.postMessage({generation:data.generation,orbits:data.vehicles.map(v=>({id:v.id,...predictNBodyOrbit(v.position,v.velocity,v.time)}))});
};
