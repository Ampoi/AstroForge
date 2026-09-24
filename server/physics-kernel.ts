import type {PhysicsBody, PhysicsKernel} from './types.ts';
import type {ForceTorque} from '../shared/types.ts';
interface WasmApi { memory: WebAssembly.Memory; abi_version():number; input_len():number; output_len():number; input_ptr():number; output_ptr():number; integrate(count:number):number; evaluate_aero(count:number):number; evaluate_atmosphere(alt:number):number }
import {readFileSync} from 'node:fs';
import {javascriptKernel} from './physics-reference.ts';

const HEADER=43,FIN_STRIDE=7,MAX_FINS=80;

export function createWasmKernel(bytes: BufferSource=readWasm()): PhysicsKernel & {atmosphere(alt:number): {density:number; pressure:number; temperature:number; sound:number}}{
  const module=new WebAssembly.Module(bytes);
  const api=new WebAssembly.Instance(module,{}).exports as unknown as WasmApi;
  if(api.abi_version?.()!==1||api.input_len?.()!==HEADER+MAX_FINS*FIN_STRIDE||api.output_len?.()!==13){
    throw Error('Physics Wasm ABI mismatch; run npm run build:physics');
  }
  const input=new Float64Array(api.memory.buffer,api.input_ptr(),api.input_len());
  const output=new Float64Array(api.memory.buffer,api.output_ptr(),api.output_len());
  function pack(sim: PhysicsBody,state: number[],a: ForceTorque | null,dt: number){
    input.set(state,0);
    input[13]=sim.props.mass;input.set(sim.props.com,14);
    input.set(sim.props.inertia,17);input.set(sim.props.inverseInertia,26);
    input[35]=sim.stats.height;input.set(a?.force||[0,0,0],36);input.set(a?.torque||[0,0,0],39);input[42]=dt;
    let count=0;
    for(const part of sim.props.parts){
      if(part.type!=='fin')continue;
      if(count===MAX_FINS)throw RangeError(`Physics supports at most ${MAX_FINS} fins`);
      const offset=HEADER+count++*FIN_STRIDE;
      input.set(part.position,offset);input[offset+3]=0;
      input[offset+4]=-Math.sin(part.angle!);input[offset+5]=Math.cos(part.angle!);input[offset+6]=part.def.area!;
    }
    return count;
  }
  return {
    name:'zig-wasm',
    integrate(sim,state,dt,a){
      const count=pack(sim,state,a,dt);
      // Preserve Simulation.step's existing numerical failure path.
      if(!api.integrate(count))return Array(13).fill(NaN);
      return Array.from(output);
    },
    aerodynamic(sim,position,velocity,q,omega){
      const count=pack(sim,[...position,...velocity,...q,...omega],null,0);
      if(!api.evaluate_aero(count))throw Error('Non-finite aerodynamic state');
      // Copy out: the scratch buffer is reused for every vessel and call.
      return {force:Array.from(output.subarray(0,3)),torque:Array.from(output.subarray(3,6)),q:output[6],mach:output[7],aoa:output[8],drag:output[9]};
    },
    atmosphere(alt){
      if(!api.evaluate_atmosphere(alt))throw Error('Non-finite atmosphere altitude');
      return {density:output[0],pressure:output[1],temperature:output[2],sound:output[3]};
    }
  };
}

function readWasm(){
  try{return readFileSync(new URL('../build/physics.wasm',import.meta.url));}
  catch(error){throw Error('Physics Wasm is missing; run npm run build:physics with Zig 0.16.0, or set ASTROFORGE_PHYSICS=js for the reference backend.',{cause:error});}
}
const selected=process.env.ASTROFORGE_PHYSICS||'zig';
if(!['zig','js'].includes(selected))throw Error('ASTROFORGE_PHYSICS must be zig or js');
export const physicsKernel=selected==='js'?javascriptKernel:createWasmKernel();
