import {DemoController, type Actuator} from './demo-controller.ts';

// The dashboard drives this client through HTTP. Flight commands and observations
// still cross real UDP sockets; this module never reads the simulation directly.
export class ManualController extends DemoController {
  throttle=0;
  lastBrowser=performance.now()/1000;
  override resetFlight(){super.resetFlight();this.controller='astroforge-dashboard';}
  ready(){
    const now=performance.now()/1000;
    return this.running&&this.acquired&&this.authority?.state===1&&this.authority.leaseId===this.lease&&
      now-this.lastFlight<.75&&now-this.lastHeartbeat<1;
  }
  touch(){this.lastBrowser=performance.now()/1000;}
  setThrottle(value: unknown){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('出力は0〜100%で指定してください');
    if(!this.ready())throw Error('手動デモの制御権取得を待ってください');
    if(this.pendingSeparation&&value>0)throw Error('切り離し確認中です');
    this.throttle=value;this.touch();
  }
  separate(){
    if(!this.ready())throw Error('手動デモの制御権取得を待ってください');
    if(this.pendingSeparation)throw Error('切り離し確認中です');
    const name=this.separators.at(-1);
    if(!name||!this.separationStates[name]?.available)throw Error('切り離せる段がありません');
    this.throttle=0;this.actuators(0,false);this.touch();
    this.pendingSeparation={name,engines:[],observation:this.observation,started:performance.now()/1000,lastSent:-Infinity,confirmedAt:null};
    this.event(`${name} 切り離し指令`);
  }
  manualSnapshot(){
    const engines=Object.values(this.engineStates).filter(e=>e.available);
    const next=this.separators.at(-1);
    return {...this.snapshot(),ready:this.ready(),throttle:this.throttle,
      actualThrust:engines.reduce((sum,e)=>sum+(e.thrust||0),0),
      maxThrust:engines.reduce((sum,e)=>sum+(e.maxThrust||0),0),
      nextSeparator:next??null,canSeparate:this.ready()&&!this.pendingSeparation&&!!next&&!!this.separationStates[next]?.available,
      separating:!!this.pendingSeparation};
  }
  override tick(){
    if(this.running&&performance.now()/1000-this.lastBrowser>3){this.stop('画面との接続が途絶えたため停止');return;}
    if(this.running&&!this.acquired&&performance.now()/1000-this.started>5){this.stop('テレメトリ・制御権を取得できませんでした');return;}
    super.tick();
  }
  override drive(now: number,active: Actuator[]){
    // Keep attitude stable for the demo; throttle and staging are always manual.
    this.holdAttitude();
    const pending=this.pendingSeparation;
    if(pending){
      if(this.observation>pending.observation&&this.separationStates[pending.name]?.separated){
        this.pendingSeparation=null;this.stage++;this.event(`${pending.name} 分離確認`);
        this.phase='切り離し完了 · 出力0% · スライダーで上段を点火';
      }else if(now-pending.started>3){this.stop('切り離しを確認できませんでした');return;}
      else{
        this.phase=`${pending.name} 切り離し確認中`;
        if(now-pending.lastSent>=.5){
          this.send('pylon_actuator_command',{actuatorType:'separation',name:pending.name,separate:true});pending.lastSent=now;
        }
        return;
      }
    }else this.phase=this.throttle>0?`手動操縦 · 出力${this.throttle}%`:'手動操縦 · 出力0%';
    let thrust=0;
    for(const engine of active){
      const targetThrust=engine.maxThrust*this.throttle/100;
      if(!Number.isFinite(targetThrust))continue;
      thrust+=targetThrust;
      this.send('pylon_actuator_command',{actuatorType:'engine',name:engine.name,enabled:targetThrust>0,targetThrust,hasGimbalCommand:false,timeoutSeconds:.4});
    }
    if(this.command)this.command={...this.command,thrust};
  }
  override stop(reason='手動デモ停止 · 推力OFF・制御権解放'){
    this.throttle=0;super.stop(reason);
  }
}
