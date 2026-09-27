// Browser regression runner for the real WebGL render paths. No physics server
// or dashboard is started. CHROME can select another Chromium executable.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(join(tmpdir(),'astroforge-cloud-check-'));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,open:false}});
try{
  await server.listen();
  const url=server.resolvedUrls!.local[0];
  for(const [page,count] of [['map-clouds',22],['flight-clouds',9],['texture-loading',11]] as const){
    const profile=join(output,`${page}-profile`);
    try{
      const {stdout,stderr}=await run(process.env.CHROME||'google-chrome',[
        '--headless','--no-sandbox','--disable-dev-shm-usage',
        // These are trusted, local test pages. Pin software WebGL so headless
        // hosts without a display/GPU can execute the shaders reproducibly.
        '--use-angle=swiftshader','--enable-unsafe-swiftshader',
        `--user-data-dir=${profile}`,'--window-size=1280,1400',
        '--virtual-time-budget=30000',`--screenshot=${join(output,`${page}.png`)}`,
        '--dump-dom',`${url}tests/${page}.html`,
      ],{timeout:120000,maxBuffer:4*1024*1024});
      await writeFile(join(output,`${page}.html`),stdout);
      await writeFile(join(output,`${page}.log`),stderr);
      const result=stdout.match(/<pre id="status">([\s\S]*?)<\/pre>/)?.[1]||'Missing browser results';
      console.log(`${page}:\n${result}`);
      const lines=result.split('\n');
      if(lines.length!==count||lines.some(line=>!line.startsWith('PASS ')))throw Error(`${page}: incomplete or failed WebGL checks`);
    }finally{await rm(profile,{recursive:true,force:true});}
  }
  console.log('PASS all 42 WebGL checks (Chromium / SwiftShader; not a hardware GPU benchmark).');
}finally{
  await server.close();
  console.log(`Browser results and screenshots: ${output}`);
}
