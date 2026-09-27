import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {enhanceLand,enhancePlanet,enhanceWeather,detailNoise,cubeDirection,sampleWeather,WEATHER_DETAIL_SIZE} from '../src/texture-detail.ts';
import {planetPixels,PLANET_MAP_WIDTH,PLANET_MAP_HEIGHT} from '../src/terrain-map.ts';
import {starCatalogue,makeStarField} from '../src/stars.ts';
import {weatherTexture} from '../src/weather.ts';
import {planetTexture} from '../src/terrain.ts';

test('land detail is repeatable, preserves elevation/ocean and changes only albedo',()=>{
  const source=planetPixels(128,64),a=enhanceLand(source.slice(),128,64),b=enhanceLand(source.slice(),128,64);
  assert.deepEqual(a,b);assert.notDeepEqual(a,enhanceLand(source.slice(),128,64,99));
  let changed=0;
  for(let i=0;i<a.length;i+=4){
    assert.equal(a[i+3],source[i+3]);
    if(!source[i+3])assert.deepEqual(a.slice(i,i+4),source.slice(i,i+4));
    else for(let c=0;c<3;c++){assert.ok(Math.abs(a[i+c]-source[i+c])<=source[i+c]*.12+1);changed+=a[i+c]!==source[i+c];}
  }
  assert.ok(changed>500);assert.equal(PLANET_MAP_WIDTH,4096);assert.equal(PLANET_MAP_HEIGHT,2048);
});

test('sphere detail is continuous through date line, poles and cube edges',()=>{
  const at=(lon,lat)=>detailNoise(Math.cos(lat)*Math.cos(lon)*380,Math.cos(lat)*Math.sin(lon)*380,Math.sin(lat)*380);
  for(const lat of [-1.2,0,.7])assert.ok(Math.abs(at(-Math.PI,lat)-at(Math.PI,lat))<1e-10);
  for(const lat of [-Math.PI/2,Math.PI/2])assert.ok(Math.abs(at(-2,lat)-at(1,lat))<1e-10);
  for(const v of [-1,-.3,0,.6,1])assert.deepEqual(cubeDirection(0,1,v),cubeDirection(5,-1,v));
});

test('planet upscaling wraps longitude, clamps poles and interpolates elevation without synthetic noise',()=>{
  const source=new Uint8Array([10,20,30,0, 110,120,130,100, 50,60,70,200, 150,160,170,240]);
  const before=source.slice(),a=enhancePlanet(source,2,2),b=enhancePlanet(source,2,2,99);
  assert.equal(a.length,4*4*4);assert.deepEqual(source,before);
  assert.equal(a[3],25);assert.equal(a[4*3+3],75);
  assert.equal(a[(3*4)*4+3],210);assert.equal(a[(3*4+3)*4+3],230);
  for(let i=3;i<a.length;i+=4)assert.equal(a[i],b[i]);
  assert.throws(()=>enhancePlanet(new Uint8Array(4),2,2));
});

test('weather enhancement creates fine structure but preserves clear/opaque sky and cloud type',()=>{
  const size=8,source=new Uint8Array(size*size*6*4);
  for(let i=0;i<source.length;i+=4)source.set([128,0,255,93],i);
  const a=enhanceWeather(source,size,32),b=enhanceWeather(source,size,32);
  assert.deepEqual(a,b);assert.notDeepEqual(a,enhanceWeather(source,size,32,99));
  const values=new Set();let sum=0;
  for(let i=0;i<a.length;i+=4){values.add(a[i]);sum+=a[i];assert.equal(a[i+1],0);assert.equal(a[i+2],255);assert.equal(a[i+3],93);}
  assert.ok(values.size>30);assert.ok(Math.abs(sum/(a.length/4)-128)<3);
  assert.equal(WEATHER_DETAIL_SIZE,512);assert.throws(()=>enhanceWeather(new Uint8Array(4)));
});

test('weather interpolation reaches the adjacent face instead of making a clamped border',()=>{
  const size=8,source=new Uint8Array(size*size*6*4),a=[0,0,0,0],b=[0,0,0,0];
  source.fill(200,5*size*size*4);
  sampleWeather(source,size,1,0,-1+1e-8,a);sampleWeather(source,size,1,0,-1-1e-8,b);
  assert.ok(Math.abs(a[0]-100)<1e-4);assert.ok(Math.abs(a[0]-b[0])<1e-4);
});

test('star catalogue stays fixed, covers the sphere and replaces the large image with bounded geometry',()=>{
  const a=starCatalogue(),b=starCatalogue();assert.deepEqual(a,b);assert.notDeepEqual(a,starCatalogue(5000,412));
  let north=0,large=0;
  for(let i=0;i<a.sizes.length;i++){
    assert.ok(Math.abs(Math.hypot(...a.directions.slice(i*3,i*3+3))-1)<1e-6);
    north+=a.directions[i*3+2]>0;large+=a.sizes[i]>3;
  }
  assert.ok(north>2300&&north<2700);assert.ok(large>15&&large<80);
  assert.ok(a.directions.byteLength+a.colors.byteLength+a.sizes.byteLength<150000);
  const stars=makeStarField(new THREE.Texture(),{value:new THREE.Matrix3()},{value:1},{value:.3});
  assert.equal(stars.geometry.getAttribute('position').count,5000);assert.equal(stars.material.depthWrite,false);
  stars.geometry.dispose();stars.material.dispose();
});

test('disposing a running weather detail worker settles initialization and blocks late uploads',async t=>{
  let worker;
  class FakeWorker{constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}}
  const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  Object.defineProperty(globalThis,'Worker',{value:FakeWorker,configurable:true,writable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else delete globalThis.Worker;});
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(128**2*6*4)));
  const weather=weatherTexture(),initial=weather.map.images;
  await new Promise(resolve=>setImmediate(resolve));assert.ok(worker);
  weather.dispose();await weather.ready;
  worker.onmessage({data:new Uint8Array(512**2*6*4)});
  assert.ok(worker.terminated);assert.equal(weather.map.images,initial);
});

test('disposing a planet worker settles initialization and blocks late uploads',async t=>{
  let worker;
  class FakeWorker{constructor(){worker=this;}terminate(){this.terminated=true;}}
  const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  Object.defineProperty(globalThis,'Worker',{value:FakeWorker,configurable:true,writable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else delete globalThis.Worker;});
  const planet=planetTexture(),initial=planet.map.image;planet.dispose();await planet.ready;
  worker.onmessage({data:{data:new Uint8Array(4),width:1,height:1}});
  assert.ok(worker.terminated);assert.equal(planet.map.image,initial);planet.map.dispose();
});
