import type {PhysicsBody, PhysicsKernel} from './types.ts';
import type {ForceTorque} from '../shared/types.ts';
interface WasmApi { memory: WebAssembly.Memory; abi_version():number; input_len():number; output_len():number; input_ptr():number; output_ptr():number; integrate(count:number):number; evaluate_aero(count:number):number; evaluate_atmosphere(alt:number):number }
import {readFileSync} from 'node:fs';
import {javascriptKernel} from './physics-reference.ts';

const HEADER=43,FIN_STRIDE=7,MAX_FINS=80;

export function createWasmKernel(bytes: BufferSource=readWasm()): PhysicsKernel & {atmosphere(alt:number): {density:number; pressure:number; temperature:number; sound:number}}{
  const module=new WebAssembly.Module(bytes);
  function memory() {
    const api=new WebAssembly.Instance(module,{}).exports as unknown as WasmApi;
    if(api.abi_version?.()!==1||api.input_len?.()!==HEADER+MAX_FINS*FIN_STRIDE||api.output_len?.()!==13){
      throw Error('Physics Wasm ABI mismatch; run npm run build:physics');
    }
    return {api,input:new Float64Array(api.memory.buffer,api.input_ptr(),api.input_len()),
      output:new Float64Array(api.memory.buffer,api.output_ptr(),api.output_len()),parts:null as PhysicsBody['props']['parts'] | null,count:0};
  }
  const atmospheric=memory(), bodies=new WeakMap<PhysicsBody,ReturnType<typeof memory>>();
  function pack(sim: PhysicsBody,a: ForceTorque | null,dt: number){
    let body=bodies.get(sim);
    if(!body){body=memory();bodies.set(sim,body);}
    const {input}=body;
    input[13]=sim.props.mass;input.set(sim.props.com,14);
    input.set(sim.props.inertia,17);input.set(sim.props.inverseInertia,26);
    input[35]=sim.stats.height;
    for(let i=0;i<3;i++){input[36+i]=a?.force[i]??0;input[39+i]=a?.torque[i]??0;}
    input[42]=dt;
    // Layout arrays are stable while fuel changes; reset/separation replaces them.
    if(body.parts!==sim.props.parts){
      let count=0;
      for(const part of sim.props.parts){
        if(part.type!=='fin')continue;
        if(count===MAX_FINS)throw RangeError(`Physics supports at most ${MAX_FINS} fins`);
        const offset=HEADER+count++*FIN_STRIDE;
        input.set(part.position,offset);input[offset+3]=0;
        input[offset+4]=-Math.sin(part.angle!);input[offset+5]=Math.cos(part.angle!);input[offset+6]=part.def.area!;
      }
      body.parts=sim.props.parts;body.count=count;
    }
    return body;
  }
  function integrateInto(sim: PhysicsBody,state: number[],dt: number,a: ForceTorque,result: number[]){
    const {api,input,output,count}=pack(sim,a,dt);input.set(state,0);
    const valid=api.integrate(count);
    for(let i=0;i<13;i++)result[i]=valid?output[i]:NaN;
    return result;
  }
  return {
    name:'zig-wasm',
    integrateInto,
    integrate(sim,state,dt,a){return integrateInto(sim,state,dt,a,Array(13));},
    aerodynamic(sim,position,velocity,q,omega){
      const {api,input,output,count}=pack(sim,null,0);
      input.set(position,0);input.set(velocity,3);input.set(q,6);input.set(omega,10);
      if(!api.evaluate_aero(count))throw Error('Non-finite aerodynamic state');
      return {force:[output[0],output[1],output[2]],torque:[output[3],output[4],output[5]],q:output[6],mach:output[7],aoa:output[8],drag:output[9]};
    },
    atmosphere(alt){
      const {api,output}=atmospheric;
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
