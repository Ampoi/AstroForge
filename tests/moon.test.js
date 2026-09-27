import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import * as THREE from 'three';
import {moonNormals} from '../scripts/moon-model.ts';
import {moonSurface,moonGeometry} from '../src/moon.ts';

test('normal map encodes outward normals and slopes with correct east/north signs',()=>{
  const width=64,height=32,radius=1737400,heights=new Float32Array(width*height);
  const dy=Math.PI*radius/height,dx=2*Math.PI*radius/width;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)heights[y*width+x]=x*dx*.2-y*dy*.3;
  const normal=moonNormals(heights,width,height),i=(16*width+32)*3;
  assert.ok(normal[i]<128,'uphill to east tilts normal west');
  assert.ok(normal[i+1]<128,'uphill to north tilts normal south');
  assert.ok(normal[i+2]>240);
  assert.deepEqual([...moonNormals(new Float32Array(width*height),width,height).slice(i,i+3)],[128,128,255]);
  assert.throws(()=>moonNormals(new Float32Array(1),width,height));
});

function readAtlas(name){
  const data=readFileSync(new URL(`../public/assets/moon/${name}.png`,import.meta.url));
  assert.deepEqual([...data.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(data.readUInt32BE(16),4096);assert.equal(data.readUInt32BE(20),2048);
  assert.equal(data[24],8);assert.equal(data[25],2);
  const chunks=[];
  for(let at=8;at<data.length;){
    const size=data.readUInt32BE(at),type=data.toString('ascii',at+4,at+8);
    if(type==='IDAT')chunks.push(data.subarray(at+8,at+8+size));
    at+=size+12;
  }
  const rows=inflateSync(Buffer.concat(chunks)),stride=4096*3;
  assert.equal(rows.length,(stride+1)*2048);
  const pixels=new Uint8Array(stride*2048);
  for(let y=0;y<2048;y++){
    assert.equal(rows[y*(stride+1)],2);
    for(let x=0;x<stride;x++)pixels[y*stride+x]=(rows[y*(stride+1)+1+x]+(y?pixels[(y-1)*stride+x]:0))&255;
  }
  return pixels;
}

test('bundled 4K atlases decode, contain fine detail and valid unit normals',()=>{
  const color=readAtlas('color'),normal=readAtlas('normal');
  const at=(lon,lat)=>color[(Math.floor((.5-lat/180)*2048)*4096+Math.floor((lon/360+.5)*4096))*3];
  assert.ok(at(20,25)<at(120,-20)-40,'Mare Serenitatis is darker than far-side highlands');
  assert.ok(at(-11.36,-43.31)>200,'Tycho bright ejecta remain in the southern near side');
  let relief=0,dark=0,bright=0;
  for(let i=0;i<normal.length;i+=3*17){
    const x=normal[i]/127.5-1,y=normal[i+1]/127.5-1,z=normal[i+2]/127.5-1;
    assert.ok(Math.abs(Math.hypot(x,y,z)-1)<.014);assert.ok(z>0);
    relief+=Math.hypot(x,y)>.08;dark+=color[i]<110;bright+=color[i]>140;
  }
  assert.ok(relief>1000);assert.ok(dark>1000);assert.ok(bright>1000);
});

const image=()=>({width:4096,height:2048});
test('local lunar images use sRGB albedo, linear normals, filtering and dispose once',async()=>{
  const urls=[],surface=moonSurface(async url=>{urls.push(url);return image();});
  assert.equal(surface.material.map,null);await surface.ready;
  assert.equal(surface.loaded,true);assert.equal(surface.error,undefined);
  assert.deepEqual(urls,['/assets/moon/color.png','/assets/moon/normal.png']);
  const {map,normalMap}=surface.material;let disposals=0;
  assert.equal(map.colorSpace,THREE.SRGBColorSpace);assert.equal(normalMap.colorSpace,THREE.NoColorSpace);
  for(const texture of [map,normalMap]){
    assert.equal(texture.wrapS,THREE.RepeatWrapping);assert.equal(texture.wrapT,THREE.ClampToEdgeWrapping);
    assert.equal(texture.minFilter,THREE.LinearMipmapLinearFilter);
    texture.addEventListener('dispose',()=>disposals++);
  }
  surface.material.addEventListener('dispose',()=>disposals++);
  surface.dispose();surface.dispose();assert.equal(disposals,3);
});

test('disposing during load settles readiness and prevents late texture uploads',async()=>{
  const callbacks=[],surface=moonSurface(()=>new Promise(resolve=>callbacks.push(resolve)));
  surface.dispose();await surface.ready;
  for(const resolve of callbacks)resolve(image());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(surface.loaded,false);assert.equal(surface.material.map,null);assert.equal(surface.material.normalMap,null);
});

test('missing or malformed images leave an explicit error and a usable untextured material',async t=>{
  t.mock.method(console,'warn',()=>{});
  for(const loader of [async()=>{throw Error('HTTP 404');},async()=>({width:32,height:16})]){
    const surface=moonSurface(loader);await surface.ready;
    assert.ok(surface.error instanceof Error);assert.equal(surface.loaded,false);
    assert.equal(surface.material.map,null);assert.equal(surface.material.normalMap,null);surface.dispose();
  }
});

test('lunar atlas centre faces Earth and north is upright',()=>{
  const geometry=moonGeometry(2),uv=geometry.attributes.uv,p=geometry.attributes.position;
  let found=false;
  for(let i=0;i<uv.count;i++)if(Math.abs(uv.getX(i)-.5)<1e-6&&Math.abs(uv.getY(i)-.5)<1e-6){
    found=true;
    assert.ok(Math.abs(p.getX(i))<1e-6);assert.ok(Math.abs(p.getY(i))<1e-6);assert.ok(p.getZ(i)>1.999);
  }
  assert.ok(found);assert.ok(p.getY(0)>1.999);geometry.dispose();
});
