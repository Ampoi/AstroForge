import type {Craft, Design, LibraryEntry, Mode} from '../shared/types.ts';
import {record, errorMessage, errorCode} from '../shared/errors.ts';
import type {ServerResponse, IncomingMessage} from 'node:http';
import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname,isAbsolute,relative} from 'node:path';
import {StateStreamEncoder} from '../shared/state-stream.ts';
import type {Simulation} from './physics.ts';
import type {FlightSnapshot} from './types.ts';
import {FlightWorld} from './world.ts';
import {physicsKernel} from './physics-kernel.ts';
import {randomUUID} from 'node:crypto';
import {VehicleUdp} from './vehicle-udp.ts';
import {pathfinder3Craft,starterCraft,twoStageCraft,roverCraft,validateCraft,launchIssues} from '../shared/craft.ts';
import {emptyAssembly} from '../shared/assembly.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function port(name: string,fallback: number){const v=Number(process.env[name]||fallback);if(!Number.isInteger(v)||v<1||v>65535)throw Error(`Invalid ${name}`);return v;}
const config={httpPort:port('PORT',3000),commandPort:port('UDP_COMMAND_PORT',49011),telemetryPort:port('UDP_TELEMETRY_PORT',49010),telemetryHost:process.env.UDP_TELEMETRY_HOST||'127.0.0.1',physicsHz:120,telemetryHz:20};
const dataDir=resolve(process.env.ASTROFORGE_DATA_DIR||resolve(root,'data'));
let craft: Design=twoStageCraft();
try{craft=validateCraft(JSON.parse(await readFile(resolve(dataDir,'craft.json'),'utf8')));}catch(e){if(errorCode(e)!=='ENOENT')console.warn('Saved craft could not be loaded:',errorMessage(e));}
let savedCrafts: LibraryEntry[]=[];
try{savedCrafts=JSON.parse(await readFile(resolve(dataDir,'crafts.json'),'utf8')).map((value: unknown)=>{const entry=record(value);if(typeof entry.id!=='string')throw Error('Invalid library id');return {id:entry.id,craft:validateCraft(entry.craft)};});}catch(e){if(errorCode(e)!=='ENOENT')console.warn('Craft library could not be loaded:',errorMessage(e));}
if(savedCrafts.length)craft=structuredClone(savedCrafts.at(-1)!.craft);
else if(![starterCraft(),twoStageCraft(),roverCraft(),pathfinder3Craft()].some(p=>p.name===craft.name&&JSON.stringify(p.parts)===JSON.stringify(craft.parts)))savedCrafts=[{id:randomUUID(),craft:structuredClone(craft)}];
let world=new FlightWorld(launchIssues(craft as Craft).length?twoStageCraft():craft as Craft),sim=world.active;
const udp=new VehicleUdp(config),clients=new Map<ServerResponse,{compact:boolean;revision:number}>();
const streamEncoder=new StateStreamEncoder();
let mode: Mode='flight',physicsMs=0;
let controlQueue=Promise.resolve();
function changeControl(operation: ()=>Promise<void>){const pending=controlQueue.then(operation);controlQueue=pending.catch(()=>{});return pending;}
const presets=[{id:'starter',craft:starterCraft()},{id:'two-stage',craft:twoStageCraft()},{id:'rover',craft:roverCraft()},{id:'pathfinder3',craft:pathfinder3Craft()}];
const library=()=>[...presets,...savedCrafts];
let saveQueue=Promise.resolve();
function saveCraft(input: Record<string, unknown>){
  const operation=saveQueue.then(async()=>{
    const next=validateCraft(input),existing=savedCrafts.find(entry=>entry.id===input.libraryId);
    if(input.libraryId&&!existing&&!presets.some(entry=>entry.id===input.libraryId))throw Error('保存先の機体が見つかりません');
    const entry={id:existing?.id||randomUUID(),craft:next};
    if(!existing&&savedCrafts.length>=100)throw Error('保存できる機体は100機までです');
    const nextSaved=[...savedCrafts.filter(item=>item.id!==entry.id),entry];
    await mkdir(dataDir,{recursive:true});
    await writeFile(resolve(dataDir,'crafts.tmp'),JSON.stringify(nextSaved,null,2));
    await rename(resolve(dataDir,'crafts.tmp'),resolve(dataDir,'crafts.json'));
    savedCrafts=nextSaved;craft=next;return {ok:true,libraryId:entry.id,library:library()};
  });
  saveQueue=operation.then(()=>{},()=>{});return operation;
}
export function state(){const snapshots=new Map<Simulation,FlightSnapshot>();return {mode,craft:sim.craft,draft:craft,library:library(),activeVehicleId:world.activeId,vehicles:world.snapshots(snapshots).map(v=>({...v,udp:udp.snapshot(v.id)})),timeScale:world.timeScale,simulationTime:world.time,utc:new Date().toISOString(),flight:sim.snapshot(snapshots),trail:sim.trail.filter((_,i)=>i%Math.max(1,Math.floor(sim.trail.length/360))===0),
  connection:{...config,...udp.snapshot(sim.id),physicsMs,physicsBackend:physicsKernel.name,slowFrames:world.slowFrames}};}
const json=(res: ServerResponse,code: number,value: unknown)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req: IncomingMessage): Promise<unknown>{
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Error('リクエストが大きすぎます');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString()||'{}');
}
const mime: Record<string,string>={'.wasm':'application/wasm','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.md':'text/plain; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
let vite: import('vite').ViteDevServer | null=null;
const server=http.createServer(async(req,res)=>{
  const allowedHosts=[`localhost:${config.httpPort}`,`127.0.0.1:${config.httpPort}`];
  if(!allowedHosts.includes(req.headers.host ?? '')){json(res,403,{error:'Local host required'});return;}
  if(req.headers.origin&&!allowedHosts.some(h=>req.headers.origin===`http://${h}`)){json(res,403,{error:'Same origin required'});return;}
  try{
    const url=new URL(req.url ?? '/',`http://${req.headers.host}`),path=url.pathname;
    if(req.method==='GET'&&path==='/api/state'){json(res,200,state());return;}
    if(req.method==='GET'&&path==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const compact=url.searchParams.get('compact')==='1',current=state();
      const encoded=compact?streamEncoder.encode(current):null;
      res.write(encoded?encoded.configuration+encoded.frame:`data: ${JSON.stringify(current)}\n\n`);
      clients.set(res,{compact,revision:encoded?.revision??0});req.on('close',()=>clients.delete(res));return;
    }
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'JSON required'});return;}
      const input=record(await body(req));
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('JSON object required');
      if(path==='/api/craft'){json(res,200,await saveCraft(input));return;}
      if(path==='/api/editor'){
        const entry=input.libraryId?library().find(item=>item.id===input.libraryId):null;
        if(input.libraryId&&!entry)throw Error('機体が見つかりません');
        craft=structuredClone(entry?.craft||emptyAssembly());mode='editor';json(res,200,state());return;
      }
      if(path==='/api/flight'){mode='flight';json(res,200,state());return;}
      if(path==='/api/launch'){
        const next=validateCraft(input),issues=launchIssues(next);if(issues.length)throw Error(issues.join(' / '));
        await changeControl(async()=>{sim=world.add(next);craft=next;await udp.retain(world.vehicles);mode='flight';});json(res,200,state());return;
      }
      if(path==='/api/control'){
        const enabled=input.enabled??true;
        if(typeof enabled!=='boolean'||input.enabled===null)throw Error('enabledはtrueまたはfalseを指定してください');
        await changeControl(async()=>{
          const target=world.vehicles.find(v=>v.id===input.vehicleId);
          if(!target||enabled&&['destroyed','crashed','landed'].includes(target.status))throw Error('この機体は制御対象にできません');
          if(enabled)await udp.enable(target);else await udp.disable(target.id);
          sim=target;world.activeId=target.id;
        });json(res,200,state());return;
      }
      if(path==='/api/time-scale'){world.setTimeScale(input.scale);json(res,200,state());return;}
      if(path==='/api/revert'){
        // Explicit legacy reset endpoint. Opening the VAB uses /api/editor instead.
        await changeControl(async()=>{await udp.close();world=new FlightWorld(craft.assemblyVersion?sim.craft:craft);sim=world.active;mode='editor';});json(res,200,state());return;
      }
      json(res,404,{error:'Unknown endpoint'});return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Method not allowed'});return;}
    let file;
    if(path==='/docs/protocol.md')file=resolve(root,'docs/protocol.md');
    else if(path==='/docs'||path.startsWith('/docs/')){
      let relative=path.slice(5)||'/';if(relative.endsWith('/'))relative+='index.html';else if(!extname(relative))relative+='.html';
      file=resolve(root,'docs/.vitepress/dist',`.${relative}`);
    }
    else if(vite){vite.middlewares(req,res,(error: unknown)=>json(res,error?500:404,{error:error?errorMessage(error):'Not found'}));return;}
    else file=resolve(root,'dist',path==='/'?'index.html':`.${path}`);
    const relativeFile=relative(root,file);
    if(relativeFile.startsWith('..')||isAbsolute(relativeFile)||path.includes('..')){json(res,403,{error:'Forbidden'});return;}
    const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){json(res,errorCode(e)==='ENOENT'?404:400,{error:errorCode(e)==='ENOENT'?'Not found':errorMessage(e)});}
});
if(process.argv.includes('--dev'))vite=await (await import('vite')).createServer({server:{middlewareMode:true,hmr:{server}},appType:'spa'});
await udp.enable(sim);
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.httpPort,'127.0.0.1',()=>resolve());});
console.log(`AstroForge  http://localhost:${config.httpPort}\nUDP commands 127.0.0.1:${udp.snapshot(sim.id).commandPort} → telemetry ${config.telemetryHost}:${udp.snapshot(sim.id).telemetryPort}\n120 Hz physics (${physicsKernel.name}) · 20 Hz PyLoN v1 telemetry per enabled vehicle`);
let last=performance.now();
const physicsTimer=setInterval(()=>{
  const begin=performance.now(),elapsed=(begin-last)/1000;last=begin;udp.expire();
  world.advance(elapsed,begin/1000);
  physicsMs=physicsMs*.95+(performance.now()-begin)*.05;
},1000/120);
const telemetryTimer=setInterval(()=>udp.telemetry(world.timeScale),50);
const browserTimer=setInterval(()=>{
  if(!clients.size)return;const current=state();
  let legacy: string | undefined,compact: ReturnType<StateStreamEncoder['encode']> | undefined;
  for(const [client,session] of clients){
    if(client.writableLength>512000){client.end();clients.delete(client);continue;}
    if(session.compact){
      compact??=streamEncoder.encode(current);
      if(session.revision!==compact.revision){client.write(compact.configuration);session.revision=compact.revision;}
      client.write(compact.frame);
    }else{legacy??=`data: ${JSON.stringify(current)}\n\n`;client.write(legacy);}
  }
},100);
function stop(){clearInterval(physicsTimer);clearInterval(telemetryTimer);clearInterval(browserTimer);for(const c of clients.keys())c.end();server.close();void vite?.close();changeControl(()=>udp.close());}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
