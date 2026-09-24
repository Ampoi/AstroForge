import {errorMessage} from '../shared/errors.ts';
// Standalone PyLoN client. All flight data and guidance stay in this process.
import {parseArgs} from 'node:util';
import {DemoController} from './demo-controller.ts';

let demo: DemoController | undefined;
try{
  const {values}=parseArgs({options:{host:{type:'string',default:'127.0.0.1'},'command-port':{type:'string',default:process.env.UDP_COMMAND_PORT||'49011'},'telemetry-port':{type:'string',default:process.env.UDP_TELEMETRY_PORT||'49010'},duration:{type:'string',default:'240'},help:{type:'boolean',short:'h'}}});
  if(values.help){console.log('npm run demo -- [--host 127.0.0.1] [--command-port 49011] [--telemetry-port 49010] [--duration 240]');process.exit(0);}
  const commandPort=Number(values['command-port']),telemetryPort=Number(values['telemetry-port']),duration=Number(values.duration);
  if(![commandPort,telemetryPort].every(p=>Number.isInteger(p)&&p>0&&p<=65535)||!Number.isFinite(duration)||duration<=0||duration>3600)throw Error('ポートは1〜65535、durationは0より大きく3600以下で指定してください');
  demo=new DemoController({host:values.host,commandPort,telemetryPort,duration});
  await demo.start();
  console.log(`UDP ${values.host}:${commandPort} / telemetry :${telemetryPort}\nテレメトリを受信し、制御権を取得すると自動点火します。多段機体は燃料切れ → 切り離し → 上段点火まで自動制御。Ctrl+Cで停止。`);
  let reportedEvents=0;
  const output=setInterval(()=>{
    const s=demo!.snapshot(),f=demo!.flight;
    for(const event of s.events.slice(reportedEvents))console.log(`T+ ${event.elapsed.toFixed(1)} s | ${event.text}`);
    reportedEvents=s.events.length;
    console.log(`T+ ${s.elapsed.toFixed(1)} s | ${s.phase} | h=${f?.altitudeAgl?.toFixed(0)??'—'} m | ${s.command?.thrust??0} N | ${s.sent} UDP commands`);
    if(!s.running){clearInterval(output);if(!s.phase.startsWith('デモ完了'))process.exitCode=1;}
  },1000);
  const stop=()=>{demo?.stop();clearInterval(output);console.log('推力OFF・制御権解放。');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}catch(error){demo?.stop();console.error(`UDPデモ: ${errorMessage(error)}`);process.exitCode=1;}
