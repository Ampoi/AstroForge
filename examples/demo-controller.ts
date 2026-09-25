
interface Session { [key:string]: string | number }
interface TelemetryIdentity { [key:string]: unknown; version:number; observationSequence:number; universalTime:number }
interface Flight extends TelemetryIdentity {liquidFuel:number;altitudeAgl:number;apoapsis:number;upBody:number[];eastBody:number[];angularVelocityBody:number[];landed:boolean}
export interface Actuator extends TelemetryIdentity {name:string;actuatorType:string;available:boolean;separated:boolean;flameout:boolean;maxThrust:number;thrust:number}
interface Authority {state:number;leaseId:string}
interface Telemetry extends TelemetryIdentity, Authority {type:string;available:boolean;warpRate:number;actuators:Actuator[];flight:Flight;engines:Actuator[];separations:Actuator[]}
interface PendingSeparation {name:string;engines:string[];observation:number;started:number;lastSent:number;confirmedAt:number|null}
import dgram from 'node:dgram';
import {randomUUID} from 'node:crypto';

const IDENTITY=['runtimeInstance','runtimeGeneration','runtimeEpoch','runtimeVesselId','vesselId'];
const clip=(v: number)=>Math.max(-1,Math.min(1,v));
const SEPARATION_DELAY=.8; // Simulation seconds between confirmed separation and ignition.

// Uses only PyLoN telemetry. State latches cutoff so drag cannot restart the engine.
export function guidance(f: Flight,elapsed: number,state: {coasting?:boolean},timeScale=1){
  if(f.liquidFuel<=0||f.altitudeAgl>30000&&f.apoapsis>=160000)state.coasting=true;
  const tilt=4*Math.PI/180*Math.max(0,Math.min(1,(f.altitudeAgl-30000)/10000));
  const target=f.upBody.map((u,i)=>u*Math.cos(tilt)+f.eastBody[i]*Math.sin(tilt));
  const rollTest=elapsed>=25&&elapsed<33&&!state.coasting;
  const throttleTest=elapsed>=8&&elapsed<15&&!state.coasting;
  // UDP remains at 20 Hz while physics accelerates. Bound position feedback
  // and rate damping for the longer command hold, including the light upper stage.
  const interval=Math.max(1,timeScale),positionGain=Math.min(2,10/interval),rateGain=Math.min(1.8,3/interval);
  return {phase:state.coasting?'惰性飛行 · 宇宙へ':rollTest?'RCS · ロール試験':throttleTest?'推力を75%へ変更':elapsed<8?'点火 · 垂直上昇':tilt===0?'姿勢保持 · 垂直上昇':'姿勢保持 · 東へ緩やかに旋回',
    thrust:state.coasting?0:throttleTest?45000:60000,rcs:rollTest,
    pitch:clip(-positionGain*target[2]-rateGain*f.angularVelocityBody[1]),yaw:clip(positionGain*target[1]-rateGain*f.angularVelocityBody[2]),
    roll:clip(rateGain*((rollTest?.12/1.8:0)-f.angularVelocityBody[0]))};
}

// An independent UDP client; no Simulation or PylonProtocol reference is allowed here.
export class DemoController{
  commandPort:number;telemetryPort:number;host:string;duration:number;running=false;phase='';port:number|null=null;
  sent=0;sequence=0;session:Session|null=null;flight:Flight|null=null;authority:Authority|null=null;
  engines:string[]=[];rcs:string[]=[];separators:string[]=[];engineStates:Record<string,Actuator>={};separationStates:Record<string,Actuator>={};
  observation=-1;manifestObservation=-1;stage=1;stageCount:number|null=null;pendingSeparation:PendingSeparation|null=null;
  stageIgnited=false;events:{elapsed:number;text:string}[]=[];timeScale=1;acquired=false;requested=false;
  guidanceState:{coasting?:boolean}={};command:ReturnType<typeof guidance>|null=null;elapsed=0;
  controller='';lease='';started=0;lastRenew=0;lastFlight=0;lastHeartbeat=0;requestedAt=0;startTime=0;
  socket:dgram.Socket|null=null;timer:ReturnType<typeof setInterval>|undefined;
  pendingSends=new Map<dgram.Socket,number>();closingSockets=new Set<dgram.Socket>();

  constructor({commandPort=49011,telemetryPort=49010,host='127.0.0.1',duration=240}={}){this.commandPort=commandPort;this.telemetryPort=telemetryPort;this.host=host;this.duration=duration;this.running=false;this.phase='デモ待機中';this.port=null;this.resetFlight();}
  snapshot(){return {running:this.running,phase:this.phase,sent:this.sent,port:this.port,elapsed:this.elapsed||0,command:this.command||null,
    stage:this.stage||1,stageCount:this.stageCount||null,events:this.events||[]};}
  resetFlight(){
    this.sent=0;this.sequence=0;this.session=null;this.flight=null;this.authority=null;
    this.engines=[];this.rcs=[];this.separators=[];this.engineStates={};this.separationStates={};this.observation=-1;this.manifestObservation=-1;
    this.stage=1;this.stageCount=null;this.pendingSeparation=null;this.stageIgnited=false;this.events=[];this.timeScale=1;
    this.acquired=false;this.requested=false;this.guidanceState={};this.command=null;this.elapsed=0;
    this.controller='astroforge-udp-demo';this.lease=randomUUID();this.started=performance.now()/1000;this.lastRenew=0;
  }
  async start(){
    if(this.running)throw Error('UDPデモはすでに実行中です');
    this.resetFlight();this.running=true;this.phase='テレメトリ受信・制御権取得';
    const socket=this.socket=dgram.createSocket('udp4');
    socket.on('message',data=>this.receive(data));
    try{
      await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(this.telemetryPort,'127.0.0.1',()=>{socket.off('error',reject);resolve();});});
    }catch(e){this.running=false;this.socket=null;socket.close();this.phase='UDPデモを起動できませんでした';throw e;}
    socket.on('error',()=>this.stop('UDP通信エラー'));
    this.port=socket.address().port;this.timer=setInterval(()=>this.tick(),50);
  }
  receive(data: Buffer | string){
    if(!this.running)return;
    let p: Telemetry;try{p=JSON.parse(data.toString()) as Telemetry;}catch{return;}
    if(!p||p.version!==1)return;
    const now=performance.now()/1000;
    if(p.type==='pylon_session'){
      if(!p.available){if(this.session){this.acquired=false;this.stop('飛行終了');}return;}
      if(IDENTITY.some(k=>p[k]===undefined))return;
      const session=Object.fromEntries(IDENTITY.map(k=>[k,p[k]])) as Session;
      if(this.session&&IDENTITY.some(k=>p[k]!==this.session![k])){this.acquired=false;this.stop('セッションが変更されました');return;}
      if(!this.session)this.lastFlight=now;
      this.session=session;this.lastHeartbeat=now;
      if(Number.isFinite(p.warpRate)&&p.warpRate>=1)this.timeScale=p.warpRate;
    }else if(!this.session||IDENTITY.some(k=>p[k]!==this.session![k]))return;
    if(p.type==='pylon_actuator_manifest'&&Array.isArray(p.actuators)&&p.observationSequence>this.manifestObservation){
      this.manifestObservation=p.observationSequence;
      this.rcs=p.actuators.filter(a=>a.actuatorType==='rcs').map(a=>a.name);
    }
    // One coherent observation prevents late lower-stage packets from triggering
    // another separation or igniting an upper engine before the split is confirmed.
    if(p.type==='pylon_control_snapshot'&&Number.isSafeInteger(p.observationSequence)&&p.observationSequence>this.observation&&
      p.flight&&Array.isArray(p.engines)&&Array.isArray(p.separations)){
      const members=[p.flight,...p.engines,...p.separations];
      if(members.some(m=>!m||IDENTITY.some(k=>m[k]!==this.session![k])||m.observationSequence!==p.observationSequence||m.universalTime!==p.universalTime))return;
      this.observation=p.observationSequence;this.flight=p.flight;this.lastFlight=now;
      this.engines=p.engines.map(a=>a.name);this.engineStates=Object.fromEntries(p.engines.map(a=>[a.name,a]));
      this.separators=p.separations.filter(a=>!a.separated).map(a=>a.name);
      this.separationStates=Object.fromEntries(p.separations.map(a=>[a.name,a]));
    }
    if(p.type==='pylon_control_authority_state')this.authority=p;
  }
  send(type: string,fields: Record<string,unknown>){
    if(!this.session||!this.socket)return;
    const packet={type,version:1,...this.session,controllerId:this.controller,leaseId:this.lease,sequence:++this.sequence,...fields};
    const socket=this.socket;
    this.pendingSends.set(socket,(this.pendingSends.get(socket)??0)+1);
    socket.send(Buffer.from(JSON.stringify(packet)),this.commandPort,this.host,error=>{
      if(!error)this.sent++;
      const remaining=(this.pendingSends.get(socket)??1)-1;
      if(remaining)this.pendingSends.set(socket,remaining);
      else{
        this.pendingSends.delete(socket);
        if(this.closingSockets.delete(socket))socket.close();
      }
    });
  }
  leaseCommand(action: string){this.send('pylon_control_authority_command',{action,priority:1,leaseDurationSeconds:2,suppressSas:true});}
  event(text: string){this.events.push({elapsed:this.elapsed,text});}
  actuators(thrust: number,rcs: boolean){
    for(const name of this.engines){
      if(this.engineStates[name]?.available!==true)continue;
      this.send('pylon_actuator_command',{actuatorType:'engine',name,enabled:thrust>0,targetThrust:thrust,hasGimbalCommand:false,timeoutSeconds:.4});
    }
    if(this.manifestObservation>=this.observation)for(const name of this.rcs)this.send('pylon_actuator_command',{actuatorType:'rcs',name,enabled:rcs,thrustLimit:250,timeoutSeconds:.4});
  }
  holdAttitude(){
    const c=this.command=guidance(this.flight!,this.elapsed,{coasting:true},this.timeScale);
    this.send('pylon_flight_control_command',{pitch:c.pitch,yaw:c.yaw,roll:c.roll,landingGear:false,timeoutSeconds:.4});
  }
  stageTransition(now: number,active: Actuator[]){
    const pending=this.pendingSeparation;
    if(!pending)return false;
    if(now-pending.started>5){this.stop('段の分離・上段の準備を確認できませんでした');return true;}
    this.holdAttitude();
    if(this.observation>pending.observation&&this.separationStates[pending.name]?.separated&&
      active.length&&active.every(p=>!pending.engines.includes(p.name))){
      if(pending.confirmedAt===null){
        pending.confirmedAt=this.flight!.universalTime;this.stage++;
        this.event(`第${this.stage-1}段 分離確認 · ${pending.name}`);
      }
      this.phase=`第${this.stage-1}段 分離完了 · 第${this.stage}段 点火待機`;
      if(this.flight!.universalTime-pending.confirmedAt!>=SEPARATION_DELAY){
        this.pendingSeparation=null;this.guidanceState={};this.stageIgnited=false;return false;
      }
    }else{
      this.phase=`第${this.stage}段 燃料切れ · ${pending.name} 分離確認待ち`;
      if(now-pending.lastSent>=.5){
        this.send('pylon_actuator_command',{actuatorType:'separation',name:pending.name,separate:true});pending.lastSent=now;
      }
    }
    return true;
  }
  tick(){
    if(!this.running)return;
    const now=performance.now()/1000;
    if(this.session&&(now-this.lastHeartbeat>1||now-(this.lastFlight??this.started)>.75)){this.stop('テレメトリが途絶えました');return;}
    if(!this.session||!this.flight||!this.engines.length||this.manifestObservation<0||!this.authority)return;
    if(this.requested&&!this.acquired&&now-this.requestedAt>3){this.stop('制御権を取得できませんでした');return;}
    const owned=this.authority.state===1&&this.authority.leaseId===this.lease;
    if(!this.acquired){
      if(owned){
        this.acquired=true;this.startTime=this.flight!.universalTime;
        const completed=Object.values(this.separationStates).filter(s=>s.separated).length;
        this.stage=completed+1;this.stageCount=this.stage+this.separators.length;
      }
      else if(this.authority.state!==0){this.stop('別のコントローラが制御中です');return;}
      else{if(!this.requested){this.leaseCommand('acquire');this.requested=true;this.requestedAt=now;}return;}
    }else if(!owned){this.stop('制御権が移りました');return;}
    if(now-this.lastRenew>.5){this.leaseCommand('renew');this.lastRenew=now;}
    this.elapsed=this.flight!.universalTime-this.startTime;
    if(this.elapsed>=this.duration){this.stop('デモ完了 · 弾道飛行を継続');return;}
    const active=this.engines.map(id=>this.engineStates[id]).filter(p=>p.available===true);
    this.drive(now,active);
  }
  drive(now: number,active: Actuator[]){
    if(this.stageTransition(now,active))return;
    if(!active.length){this.stop('使用できるエンジンがありません');return;}
    if(this.separators.length&&active.every(p=>p.flameout)&&!this.flight!.landed){
      // The manifest/snapshot preserves stack order, nose first: drop the bottom ring.
      const name=this.separators.at(-1)!;
      if(!this.separationStates[name]?.available){this.stop('分離機構を使用できません');return;}
      this.actuators(0,false);
      this.pendingSeparation={name,engines:active.map(p=>p.name),observation:this.observation,started:now,lastSent:-Infinity,confirmedAt:null};
      this.event(`第${this.stage}段 燃焼終了 · ${name} 切り離し指令`);
      this.stageTransition(now,active);return;
    }
    const guidanceFlight=this.separators.length?{...this.flight!,apoapsis:-Infinity}:this.flight!;
    if(!this.separators.length&&active.every(p=>p.flameout))this.guidanceState.coasting=true;
    const previousThrust=this.command?.thrust||0;
    const c=this.command=guidance(guidanceFlight,this.elapsed,this.guidanceState,this.timeScale);this.phase=`第${this.stage}段 · ${c.phase}`;
    if(c.thrust>0&&!this.stageIgnited){this.stageIgnited=true;this.event(`第${this.stage}段 点火 · ${active.map(p=>p.name).join(', ')}`);}
    if(c.thrust===0&&previousThrust>0)this.event(`第${this.stage}段 推力停止 · 惰性飛行へ`);
    this.send('pylon_flight_control_command',{pitch:c.pitch,yaw:c.yaw,roll:c.roll,landingGear:false,timeoutSeconds:.4});
    this.actuators(c.thrust,c.rcs);
  }
  stop(reason='デモ停止 · 推力OFF'){
    if(!this.running)return;
    clearInterval(this.timer);this.running=false;this.phase=reason;this.port=null;
    if(this.acquired&&this.authority?.state===1&&this.authority.leaseId===this.lease){
      // While awaiting a split, the old actuator IDs may already be detached.
      if(!this.pendingSeparation)this.actuators(0,false);
      this.leaseCommand('release');
    }
    if(this.command)this.command={...this.command,thrust:0,rcs:false};
    // send() may still be resolving its destination. Wait for its callbacks so
    // the final cutoff/release packets reach UDP before closing the socket.
    const socket=this.socket;this.socket=null;
    if(socket){if(this.pendingSends.has(socket))this.closingSockets.add(socket);else socket.close();}
  }
}
