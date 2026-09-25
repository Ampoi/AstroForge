// Application-side flight fixture. This is not imported by the ROS2 demo.
// It prepares an isolated application instance; all in-flight guidance uses ROS/UDP.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {pathfinder3Craft} from '../shared/craft.ts';
const data=await mkdtemp('/tmp/astroforge-pathfinder3-');
await writeFile(`${data}/craft.json`,JSON.stringify(pathfinder3Craft()));
const port=Number(process.env.PORT||3033),scale=Number(process.argv[2]||1);
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{stdio:'inherit',env:{...process.env,PORT:String(port),UDP_COMMAND_PORT:process.env.UDP_COMMAND_PORT||'49311',UDP_TELEMETRY_PORT:process.env.UDP_TELEMETRY_PORT||'49310',ASTROFORGE_DATA_DIR:data}});
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code??0));
for(let i=0;i<100;i++){
  await new Promise(r=>setTimeout(r,100));
  try{const res=await fetch(`http://127.0.0.1:${port}/api/time-scale`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scale})});if(res.ok){console.log(`Pathfinder3 flight fixture: http://localhost:${port}, scale ${scale}, isolated data ${data}`);break;}}catch{}
}
