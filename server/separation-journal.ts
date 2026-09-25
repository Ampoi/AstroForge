import {createHash} from 'node:crypto';
import type {PylonProtocol} from './protocol.ts';
import type {Packet,WireCommand} from './types.ts';
const token=(value:unknown):value is string=>typeof value==='string'&&/^[\x21-\x7e]{1,128}$/.test(value);
export class SeparationJournal{
  private entries=new Map<string,{expires:number;packet:Packet}>();
  constructor(private protocol:PylonProtocol){}
  private prune(){for(const [key,entry] of this.entries)if(entry.expires<=this.protocol.clock())this.entries.delete(key);}
  identity(p:Record<string,unknown>,command=false){
    const runtime=this.protocol;
    const identity={operationId:p.operationId??(command?'legacy-'+createHash('sha256').update([p.controllerId,p.leaseId,p.name,p.sequence].join('\n')).digest('hex'):undefined),operationInstance:p.operationInstance??(command?runtime.instance:undefined),operationEpoch:p.operationEpoch??(command?runtime.epoch:undefined),operationVesselId:p.operationVesselId??(command?runtime.vessel:undefined)};
    if(!Object.values(identity).every(token))throw Error('invalid_operation_identity');
    return identity as Record<keyof typeof identity,string>;
  }
  private key(p:Record<string,unknown>){return JSON.stringify([p.operationInstance,p.operationEpoch,p.operationVesselId,p.operationId]);}
  query(p:Record<string,unknown>):Packet{
    this.prune();const identity=this.identity(p),entry=this.entries.get(this.key(identity));
    return entry?{...entry.packet,retentionRemainingSeconds:Math.max(0,entry.expires-this.protocol.clock())}:{type:'pylon_separation_result',version:1,...identity,originalGeneration:0,name:'',controllerId:'',sequence:0,completed:false,success:false,retained:false,reason:'result_not_found',resultEpoch:'',resultGeneration:0,activeVesselId:'',resultingVesselIds:[],retentionRemainingSeconds:0};
  }
  replay(p:WireCommand){
    this.prune();const identity=this.identity(p,true),old=this.entries.get(this.key(identity));
    if(!old)return null;
    if(old.packet.name!==p.name||old.packet.controllerId!==p.controllerId)throw Error('operation_id_conflict');
    return this.query(identity);
  }
  prepare(p:WireCommand){
    this.prune();const identity=this.identity(p,true),key=this.key(identity),old=this.entries.get(key),runtime=this.protocol;
    if(old){
      if(old.packet.name!==p.name||old.packet.controllerId!==p.controllerId)throw Error('operation_id_conflict');
      return {replay:true,apply:()=>{}};
    }
    if(identity.operationInstance!==runtime.instance||identity.operationEpoch!==runtime.epoch||identity.operationVesselId!==runtime.vessel)throw Error('original_session_not_current');
    if(this.entries.size>=128)throw Error('result_journal_full');
    return {replay:false,apply:()=>{
      let success=true,reason='separated';
      try{runtime.sim.separate(p.name);}catch(error){success=false;reason=error instanceof Error?error.message:'separation_exception';}
      this.entries.set(key,{expires:runtime.clock()+600,packet:{type:'pylon_separation_result',version:1,...identity,originalGeneration:runtime.generation,name:p.name,controllerId:p.controllerId,sequence:p.sequence,completed:true,success,retained:true,reason,resultEpoch:runtime.epoch,resultGeneration:runtime.generation,activeVesselId:runtime.vessel,resultingVesselIds:success?[runtime.vessel,runtime.sim.debris.at(-1)!.vesselIdentity]:[],retentionRemainingSeconds:600}});
    }};
  }
  packets(){this.prune();return [...this.entries.values()].map(e=>({...e.packet,retentionRemainingSeconds:Math.max(0,e.expires-this.protocol.clock())}));}
}
