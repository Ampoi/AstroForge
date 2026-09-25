import type {Simulation} from './physics.ts';
import type {UdpConfig, Packet} from './types.ts';
import {errorCode} from '../shared/errors.ts';
interface Channel {commandPort:number;telemetryPort:number;protocol:PylonProtocol;sent:number;sendErrors:number;socket?: dgram.Socket | null}
import dgram from 'node:dgram';
import {PylonProtocol} from './protocol.ts';
import {ManualController} from '../examples/manual-controller.ts';

// Mutations are serialized by the HTTP server so binding and removing a vehicle
// cannot race. Each vehicle owns its socket, protocol identity and lease.
export class VehicleUdp{
  config: UdpConfig; channels=new Map<string,Channel>();
  demos=new Map<string,ManualController>();
  constructor(config: UdpConfig){
    if(config.commandPort===config.telemetryPort)throw Error('UDP受信・送信ポートは異なる値にしてください');
    this.config=config;this.channels=new Map();
  }
  async bind(commandPort: number){
    const socket=dgram.createSocket('udp4');
    try{
      await new Promise<void>((resolve,reject)=>{
        socket.once('error',reject);
        socket.bind(commandPort,'127.0.0.1',()=>{socket.off('error',reject);resolve();});
      });
      return socket;
    }catch(error){socket.close();throw error;}
  }
  async enable(sim: Simulation){
    let channel=this.channels.get(sim.id);
    if(channel?.socket)return;
    let socket: dgram.Socket | undefined;
    if(channel){
      try{socket=await this.bind(channel.commandPort);}
      catch(error){throw Error(`UDP受信ポート :${channel.commandPort} を利用できません (${errorCode(error)})`);}
      channel.protocol.newSession();
    }else{
      const used=new Set([...this.channels.values()].flatMap(c=>[c.commandPort,c.telemetryPort]));
      for(let offset=0;Math.max(this.config.commandPort,this.config.telemetryPort)+offset<=65535;offset+=2){
        const commandPort=this.config.commandPort+offset,telemetryPort=this.config.telemetryPort+offset;
        if(used.has(commandPort)||used.has(telemetryPort))continue;
        try{socket=await this.bind(commandPort);}
        catch(error){if(errorCode(error)==='EADDRINUSE')continue;throw error;}
        channel={commandPort,telemetryPort,protocol:new PylonProtocol(sim),sent:0,sendErrors:0};break;
      }
      if(!channel)throw Error('割り当て可能なUDPポートがありません。UDP_COMMAND_PORT / UDP_TELEMETRY_PORTを確認してください');
      this.channels.set(sim.id,channel);
    }
    if(!socket)throw Error('UDP socket unavailable');
    channel.socket=socket;channel.protocol.available=true;
    socket.on('message',data=>{if(channel!.socket===socket)this.send(channel!,channel!.protocol.receive(data));});
    socket.on('error',error=>{channel!.sendErrors++;console.error(`UDP :${channel!.commandPort}:`,error.message);});
  }
  async disable(id: string){
    this.demos.get(id)?.stop('UDP OFF · 手動デモ停止');
    const channel=this.channels.get(id);if(!channel)return;
    channel.protocol.available=false;channel.protocol.clearOwner('udp_disabled');
    const socket=channel.socket;channel.socket=null;
    if(socket)await new Promise<void>(resolve=>socket.close(resolve));
  }
  async retain(vehicles: Simulation[]){
    const ids=new Set(vehicles.map(v=>v.id));
    for(const id of this.channels.keys())if(!ids.has(id)){await this.disable(id);this.channels.delete(id);this.demos.delete(id);}
  }
  async manual(id: string,action: unknown,throttle?: unknown){
    const channel=this.channels.get(id);
    if(!channel)throw Error('機体のUDPをONにしてください');
    let demo=this.demos.get(id);
    if(action==='stop'){demo?.stop();return;}
    if(!channel.socket)throw Error('機体のUDPをONにしてください');
    if(action==='start'){
      if(demo?.running){demo.touch();return;}
      if(!['127.0.0.1','localhost'].includes(this.config.telemetryHost))throw Error('手動デモはUDP_TELEMETRY_HOST=127.0.0.1で利用できます');
      if(channel.protocol.authority().state!==0)throw Error('別のコントローラが制御中、または緊急停止中です');
      demo=new ManualController({commandPort:channel.commandPort,telemetryPort:channel.telemetryPort,duration:Infinity});
      try{await demo.start();}
      catch(error){throw Error(`テレメトリポート :${channel.telemetryPort} を利用できません。外部デモを終了してください (${errorCode(error)})`);}
      this.demos.set(id,demo);return;
    }
    if(!demo?.running)throw Error('手動デモを開始してください');
    if(action==='heartbeat')demo.touch();
    else if(action==='throttle')demo.setThrottle(throttle);
    else if(action==='separate')demo.separate();
    else throw Error('不明な手動デモ操作です');
  }
  async close(){await this.retain([]);}
  send(channel: Channel,packet: Packet){
    if(!channel.socket)return;
    channel.socket.send(Buffer.from(JSON.stringify(packet)),channel.telemetryPort,this.config.telemetryHost,error=>{if(error)channel.sendErrors++;else channel.sent++;});
  }
  expire(){for(const c of this.channels.values())if(c.socket)c.protocol.expire();}
  telemetry(timeScale: number){
    for(const c of this.channels.values())if(c.socket){c.protocol.timeScale=timeScale;for(const packet of c.protocol.telemetry())this.send(c,packet);}
  }
  snapshot(id: string){
    const c=this.channels.get(id),p=c?.protocol;
    return {enabled:!!c?.socket,commandHost:'127.0.0.1',commandPort:c?.commandPort??null,telemetryHost:this.config.telemetryHost,telemetryPort:c?.telemetryPort??null,
      received:p?.received??0,accepted:p?.accepted??0,rejected:p?.rejected??0,sent:c?.sent??0,sendErrors:c?.sendErrors??0,lastCommand:p?.lastCommand??null,
      authority:p?.authority()??null,session:c?.socket?p!.fields():null,demo:this.demos.get(id)?.manualSnapshot()??null};
  }
}
