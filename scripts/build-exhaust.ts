import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const version=readFileSync(join(root,'.zig-version'),'utf8').trim();
const output=join(root,'build','exhaust.wasm'),stamp=output+'.sha256';
const digest=createHash('sha256');
for(const file of ['native/exhaust.zig','scripts/build-exhaust.ts','.zig-version'])digest.update(readFileSync(join(root,file)));
const sourceHash=digest.digest('hex');
const hash=(bytes: Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let current=false;
try{current=readFileSync(stamp,'utf8')===`${sourceHash}\n${hash(readFileSync(output))}\n`;}catch{}
if(current&&!process.argv.includes('--force')){
  console.log('Exhaust Wasm is up to date.');
}else{
  const zig=process.env.ZIG||'zig';
  const found=spawnSync(zig,['version'],{encoding:'utf8'});
  if(found.error||found.status!==0||found.stdout.trim()!==version){
    console.error(`Zig ${version} is required to build exhaust (found: ${found.stdout?.trim()||'not installed'}). Install it or set ZIG to its executable.`);
    process.exit(1);
  }
  mkdirSync(join(root,'build'),{recursive:true});
  const temporary=`${output}.${process.pid}.tmp`;
  const exports=['abi_version','particles_ptr','frame_ptr','emitters_ptr','obstacles_ptr','particle_count','clear','step'];
  const result=spawnSync(zig,['build-exe','native/exhaust.zig','-target','wasm32-freestanding','-O','ReleaseSafe','-fno-entry','-fstrip',
    ...exports.map(name=>`--export=${name}`),`-femit-bin=${temporary}`,'--cache-dir','.zig-cache','--global-cache-dir','.zig-cache/global'],{cwd:root,stdio:'inherit'});
  if(result.error||result.status!==0){rmSync(temporary,{force:true});console.error(result.error?.message||'Exhaust build failed.');process.exit(1);}
  const bytes=readFileSync(temporary);
  if(!WebAssembly.validate(bytes)){rmSync(temporary,{force:true});throw Error('Invalid exhaust Wasm output');}
  renameSync(temporary,output);
  writeFileSync(stamp,`${sourceHash}\n${hash(bytes)}\n`);
  console.log(`Built exhaust with Zig ${version} (${bytes.length} bytes, ReleaseSafe / f64).`);
}
