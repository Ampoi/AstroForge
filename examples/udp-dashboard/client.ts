import dgram from 'node:dgram';
import {lookup} from 'node:dns/promises';
import {randomUUID} from 'node:crypto';

export type Json = Record<string, unknown>;
const identityKeys=['runtimeInstance','runtimeGeneration','runtimeEpoch','runtimeVesselId','vesselId'] as const;
export function object(value:unknown):Json {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON object required');
  return value as Json;
}
function validPort(value:unknown):number {
  if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>65535)throw Error('ポートは1〜65535で指定してください');
  return value;
}

// A wire client only. No craft model, simulator imports, HTTP calls to AstroForge,
// actuator selection, guidance, staging policy, or engine-capability calculations.
export class UdpDashboardClient {
  socket:dgram.Socket|null=null;
  endpoint:{host:string;address:string;commandPort:number;telemetryPort:number}|null=null;
  session:Json|null=null;
  controllerId='udp-dashboard';leaseId=randomUUID();sequence=0;
  authority:Json|null=null;
  manifest:Json[]=[];
  telemetry=new Map<string,Json>();
  log:{id:number;direction:string;packet:unknown}[]=[];
  logId=0;sent=0;received=0;error='';
  repeat:Json|null=null;
  renewLease=true;
  leaseOptions:Json={priority:1,leaseDurationSeconds:2,suppressSas:false};
  lastRenew=0;lastReceive=0;lastBrowser=0;
  timer:ReturnType<typeof setInterval>|undefined;
  ticking=false;
  disconnecting:Promise<void>|null=null;

  snapshot(){return {connected:!!this.socket,endpoint:this.endpoint,session:this.session,
    controllerId:this.controllerId,leaseId:this.leaseId,nextSequence:this.sequence+1,
    authority:this.authority,manifest:this.manifest,telemetry:[...this.telemetry.values()],
    log:this.log,sent:this.sent,received:this.received,error:this.error,
    repeating:this.repeat,renewLease:this.renewLease};}
  record(direction:string,packet:unknown){
    this.log.push({id:++this.logId,direction,packet});this.log=this.log.slice(-40);
  }
  owns(){return this.authority?.state===1&&this.authority.controllerId===this.controllerId&&this.authority.leaseId===this.leaseId;}
  touch(){this.lastBrowser=Date.now();}
  async connect(input:Json){
    const commandPort=validPort(input.commandPort),telemetryPort=validPort(input.telemetryPort);
    if(commandPort===telemetryPort)throw Error('送信先と受信ポートは異なる値にしてください');
    if(typeof input.host!=='string'||!input.host.trim())throw Error('送信先ホストを指定してください');
    const {address}=await lookup(input.host,{family:4});
    await this.disconnect();
    const socket=dgram.createSocket('udp4');
    try{
      await new Promise<void>((resolve,reject)=>{
        socket.once('error',reject);
        socket.bind(telemetryPort,'127.0.0.1',()=>{socket.off('error',reject);resolve();});
      });
    }catch(error){socket.close();throw error;}
    this.socket=socket;this.endpoint={host:input.host,address,commandPort,telemetryPort};
    this.session=null;this.authority=null;this.manifest=[];this.telemetry.clear();
    this.leaseId=randomUUID();this.sequence=0;this.sent=0;this.received=0;this.error='';
    this.renewLease=input.renewLease!==false;this.lastReceive=0;this.touch();
    socket.on('message',(data,peer)=>{
      if(this.socket!==socket||peer.address!==address||peer.port!==commandPort)return;
      this.receive(data);
    });
    socket.on('error',error=>{this.error=error.message;this.repeat=null;});
    this.timer=setInterval(()=>{void this.tick();},50);
  }
  setSession(value:unknown){
    const input=object(value),session:Json={};
    for(const key of identityKeys){
      const v=input[key];
      if(key==='runtimeGeneration'?typeof v!=='number'||!Number.isSafeInteger(v):typeof v!=='string'||!v)throw Error(`セッションの${key}が不正です`);
      session[key]=v;
    }
    if(this.session&&identityKeys.some(key=>session[key]!==this.session![key])){
      this.repeat=null;this.authority=null;this.manifest=[];this.telemetry.clear();
      this.leaseId=randomUUID();this.sequence=0;
      this.record('INFO','セッション変更。連続送信を停止しました。');
    }
    this.session=session;
  }
  receive(data:Buffer){
    if(data.length>65507)return;
    let packet:Json;
    try{packet=object(JSON.parse(data.toString()));}catch{return;}
    this.received++;this.lastReceive=Date.now();
    if(packet.type==='pylon_session'&&packet.version===1){
      try{this.setSession(packet);}catch{return;}
      if(packet.available===false)this.repeat=null;
    }
    const matches=this.session&&identityKeys.every(key=>packet[key]===this.session![key]);
    if(matches&&packet.type==='pylon_control_authority_state'){
      const wasOwner=this.owns();this.authority=packet;
      if(wasOwner&&!this.owns())this.repeat=null;
      this.record('RX',packet);
    }
    if(matches&&packet.type==='pylon_actuator_manifest'&&Array.isArray(packet.actuators)){
      this.manifest=packet.actuators.filter((v):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v)).slice(0,100);
    }
    const key=`${String(packet.type)}:${String(packet.name??'')}`;
    if(this.telemetry.has(key)||this.telemetry.size<100)this.telemetry.set(key,packet);
  }
  async datagram(text:string){
    if(!this.socket||!this.endpoint)throw Error('先にUDP接続を開いてください');
    const data=Buffer.from(text);
    if(data.length>32768)throw Error('UDP JSONは32,768 bytes以内にしてください');
    const socket=this.socket,endpoint=this.endpoint;
    await new Promise<void>((resolve,reject)=>socket.send(data,endpoint.commandPort,endpoint.address,error=>error?reject(error):resolve()));
    this.sent++;this.record('TX',JSON.parse(text));
  }
  async send(command:Json){
    if(!this.session)throw Error('UDPセッションの受信を待つか、セッションJSONを設定してください');
    if(typeof command.type!=='string'||!command.type)throw Error('typeを指定してください');
    const packet={...command,...this.session,version:1,controllerId:this.controllerId,leaseId:this.leaseId,sequence:++this.sequence};
    // Names and values are sent exactly as specified. The UDP peer decides
    // whether a command is usable; a missing manifest never disables sending.
    await this.datagram(JSON.stringify(packet));
    return packet;
  }
  async command(input:Json){
    this.touch();
    const command=object(input.command);
    if(input.repeat===true&&command.type==='pylon_actuator_command'&&command.actuatorType==='separation')throw Error('切り離しは1回送信してください');
    if(command.type==='pylon_control_authority_command'){
      if(['release','emergency_stop','clear_emergency_stop'].includes(String(command.action)))this.repeat=null;
      if(command.action==='acquire')this.leaseOptions={priority:command.priority??1,leaseDurationSeconds:command.leaseDurationSeconds??2,suppressSas:command.suppressSas??false};
    }
    // Replacing the repeating packet is explicit. An unrelated one-shot command
    // (including separation) does not select or ignite another actuator.
    if(input.repeat===true)this.repeat=null;
    await this.send(command);
    if(input.repeat===true)this.repeat=structuredClone(command);
  }
  async raw(text:unknown){
    if(typeof text!=='string')throw Error('JSONテキストを指定してください');
    object(JSON.parse(text));this.touch();await this.datagram(text);
  }
  async tick(){
    if(this.ticking||!this.socket)return;
    this.ticking=true;
    try{
      const now=Date.now();
      if(now-this.lastBrowser>3000){await this.disconnect();return;}
      if(this.lastReceive&&now-this.lastReceive>1500){this.repeat=null;return;}
      if(this.renewLease&&this.owns()&&now-this.lastRenew>500){
        this.lastRenew=now;await this.send({type:'pylon_control_authority_command',action:'renew',...this.leaseOptions});
      }
      if(this.repeat)await this.send(this.repeat);
    }catch(error){this.error=error instanceof Error?error.message:String(error);this.repeat=null;}
    finally{this.ticking=false;}
  }
  disconnect():Promise<void>{
    if(this.disconnecting)return this.disconnecting;
    this.disconnecting=this.closeSocket().finally(()=>{this.disconnecting=null;});
    return this.disconnecting;
  }
  private async closeSocket(){
    clearInterval(this.timer);this.repeat=null;
    const socket=this.socket;
    if(!socket)return;
    if(this.owns())try{await this.send({type:'pylon_control_authority_command',action:'release'});}catch{}
    this.socket=null;this.authority=null;
    await new Promise<void>(resolve=>socket.close(resolve));
  }
}
