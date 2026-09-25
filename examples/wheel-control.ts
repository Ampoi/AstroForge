/** Standalone UDP client: every wheel name and input is supplied by the user. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {UdpDashboardClient} from './udp-dashboard/client.ts';

export function options(args: string[]){
  const result={host:'127.0.0.1',commandPort:49011,telemetryPort:49010,seconds:10,wheels:[] as {name:string;targetAngularVelocity:number;steeringAngle:number;maxDriveTorque:number;brake:number}[]};
  for(let i=0;i<args.length;i+=2){
    const [key,value]=[args[i],args[i+1]];if(!value)throw Error(`Missing value: ${key}`);
    if(key==='--wheel'){
      const fields=value.split(','),[name]=fields,[targetAngularVelocity,steeringAngle,maxDriveTorque,brake]=fields.slice(1).map(Number);
      if(fields.length!==5||!name||fields.slice(1).some(v=>!v.trim())||![targetAngularVelocity,steeringAngle,maxDriveTorque,brake].every(Number.isFinite)||maxDriveTorque<0||brake<0||brake>1)throw Error('--wheel name,targetAngularVelocity[rad/s],steeringAngle[rad],maxDriveTorque[N*m],brake[0..1]');
      if(result.wheels.some(w=>w.name===name))throw Error(`Duplicate wheel: ${name}`);
      result.wheels.push({name,targetAngularVelocity,steeringAngle,maxDriveTorque,brake});
    }else if(key==='--host')result.host=value;
    else if(key==='--command-port')result.commandPort=Number(value);
    else if(key==='--telemetry-port')result.telemetryPort=Number(value);
    else if(key==='--seconds')result.seconds=Number(value);
    else throw Error(`Unknown option: ${key}`);
  }
  if(!result.wheels.length)throw Error('Specify at least one --wheel name,targetAngularVelocity,steeringAngle,maxDriveTorque,brake (repeat for each wheel).');
  if(!Number.isFinite(result.seconds)||result.seconds<=0||result.seconds>3600)throw Error('--seconds must be 0 < seconds <= 3600');
  return result;
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function run(input:ReturnType<typeof options>){
  const client=new UdpDashboardClient();client.controllerId='wheel-control';
  let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  async function waitFor(ready:()=>boolean){
    const deadline=Date.now()+4000;
    while(!ready()){if(stopping||Date.now()>deadline)throw Error('UDP session or control authority unavailable');client.touch();await pause(50);}
  }
  try{
    await client.connect({...input,renewLease:true});await waitFor(()=>!!client.session);
    await client.command({command:{type:'pylon_control_authority_command',action:'acquire',priority:1,leaseDurationSeconds:2,suppressSas:false}});
    await waitFor(()=>client.owns());
    const deadline=Date.now()+input.seconds*1000;
    while(!stopping&&Date.now()<deadline){
      if(!client.owns()||Date.now()-client.lastReceive>1500)throw Error('UDP connection or control authority lost');
      client.touch();
      for(const wheel of input.wheels)await client.send({type:'pylon_actuator_command',actuatorType:'wheel',...wheel,enabled:true,timeoutSeconds:.3});
      await pause(50);
    }
  }finally{
    try{if(client.owns())for(const wheel of input.wheels)await client.send({type:'pylon_actuator_command',actuatorType:'wheel',name:wheel.name,enabled:false,targetAngularVelocity:0,steeringAngle:0,maxDriveTorque:wheel.maxDriveTorque,brake:1,timeoutSeconds:.3});}
    finally{await client.disconnect();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await run(options(process.argv.slice(2)));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
