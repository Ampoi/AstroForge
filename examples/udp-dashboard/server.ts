import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {UdpDashboardClient,object} from './client.ts';

// This HTTP server belongs exclusively to the demo, on its own port/process.
// AstroForge is neither imported, launched, queried over HTTP, nor modified.
const port=Number(process.env.UDP_DASHBOARD_PORT||3018);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid UDP_DASHBOARD_PORT');
const client=new UdpDashboardClient();
let queue=Promise.resolve();
const root=new URL('./',import.meta.url);
const files:Record<string,[string,string]>={
  '/':['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8'],
};
const server=http.createServer(async(req,res)=>{
  const json=(code:number,value:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const hosts=[`localhost:${port}`,`127.0.0.1:${port}`];
  if(!hosts.includes(req.headers.host??'')||req.headers.origin&&!hosts.some(host=>req.headers.origin===`http://${host}`)){json(403,{error:'Local same-origin requests only'});return;}
  const path=new URL(req.url??'/',`http://localhost:${port}`).pathname;
  try{
    if(req.method==='GET'&&path==='/api/state'){json(200,client.snapshot());return;}
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(!req.headers['content-type']?.startsWith('application/json')){json(415,{error:'JSON required'});return;}
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('Request too large');chunks.push(chunk);}
      const input=object(JSON.parse(Buffer.concat(chunks).toString()||'{}'));
      const operation=queue.then(async()=>{
        if(path==='/api/connect')await client.connect(input);
        else if(path==='/api/disconnect')await client.disconnect();
        else if(path==='/api/heartbeat')client.touch();
        else if(path==='/api/session')client.setSession(input.session);
        else if(path==='/api/send')await client.command(input);
        else if(path==='/api/raw')await client.raw(input.text);
        else if(path==='/api/stop-repeat')client.repeat=null;
        else throw Error('Unknown endpoint');
      });
      queue=operation.catch(()=>{});await operation;json(200,client.snapshot());return;
    }
    const file=files[path];
    if(req.method!=='GET'||!file){json(404,{error:'Not found'});return;}
    res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(await readFile(new URL(file[0],root)));
  }catch(error){json(400,{error:error instanceof Error?error.message:String(error)});}
});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(`UDP Command Desk  http://localhost:${port}\nStandalone demo · UDP only · ${fileURLToPath(root)}`);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await queue;await client.disconnect();server.close();}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
