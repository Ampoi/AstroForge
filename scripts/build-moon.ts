import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {moonNormals} from './moon-model.ts';

// Minimal lossless RGB PNG encoder: filter each row against its predecessor.
// No network access at build time; Python/Pillow decodes the source TIFFs only.
function png(data:Uint8Array,width:number,height:number){
  const crcTable=Uint32Array.from({length:256},(_,n)=>{
    for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;
  });
  const chunk=(type:string,data:Uint8Array)=>{
    const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(body.length+8);
    out.writeUInt32BE(data.length);body.copy(out,4);
    let crc=0xffffffff;for(const byte of body)crc=crcTable[(crc^byte)&255]^(crc>>>8);
    out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const stride=width*3,rows=Buffer.alloc((stride+1)*height);
  for(let y=0;y<height;y++){
    rows[y*(stride+1)]=2;
    for(let x=0;x<stride;x++)rows[y*(stride+1)+1+x]=(data[y*stride+x]-(y?data[(y-1)*stride+x]:0)+256)&255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',new Uint8Array())]);
}
// Pin the NASA SVS 2019 LROC color and LOLA elevation maps. Refuse a partial
// download or silently replaced source instead of generating a wrong atlas.
const source=resolve(process.argv[2]??fileURLToPath(new URL('../artifacts/moon-source/',import.meta.url)));
const hashes={
  'lroc_color_poles_4k.tif':'918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f',
  'ldem_16_uint.tif':'45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62',
};
for(const [name,expected] of Object.entries(hashes)){
  const actual=createHash('sha256').update(readFileSync(resolve(source,name))).digest('hex');
  if(actual!==expected)throw Error(`Moon source checksum mismatch: ${name}`);
}
const decoded=spawnSync('python3',[fileURLToPath(new URL('./decode-moon.py',import.meta.url)),source],{maxBuffer:80*1024*1024});
if(decoded.error)throw decoded.error;
if(decoded.status!==0)throw Error(`Moon TIFF decoding failed (Python 3 + Pillow required): ${decoded.stderr}`);
const width=4096,height=2048,count=width*height;
if(decoded.stdout.length!==count*7)throw Error('Moon decoder: unexpected output size');
const color=decoded.stdout.subarray(0,count*3),elevation=new Float32Array(count);
for(let i=0;i<count;i++)elevation[i]=decoded.stdout.readFloatLE(count*3+i*4);
const surface={color,normal:moonNormals(elevation,width,height)};
const dir=new URL('../public/assets/moon/',import.meta.url);
mkdirSync(dir,{recursive:true});
for(const name of ['color','normal'] as const){
  const bytes=png(surface[name],width,height);writeFileSync(new URL(`${name}.png`,dir),bytes);
  console.log(`Moon ${name}: ${width} × ${height}, ${bytes.length} bytes`);
}
console.log('Built from NASA SVS / LROC color and LOLA measured elevation (source checksums verified).');
