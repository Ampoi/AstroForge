import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {cloudFormation,weatherAt,landMask,weatherDirection,buildWeatherMap,WEATHER_FACE_SIZE} from '../scripts/weather-model.ts';
import {weatherTexture} from '../src/weather.ts';

const land=JSON.parse(readFileSync(new URL('../public/assets/land.json',import.meta.url),'utf8'));
const at=(lon,lat,isLand=0)=>weatherAt(lon*Math.PI/180,lat*Math.PI/180,isLand);
const fraction=([low,middle,high])=>1-(1-low)*(1-middle)*(1-high);

test('cloud formation responds to moist ascent and suppresses dry or descending air',()=>{
  const baseline=cloudFormation(.8,0,0);
  assert.ok(cloudFormation(.8,.6,0)>baseline);
  assert.ok(cloudFormation(.8,0,.6)<baseline);
  assert.equal(cloudFormation(.3,.6,0),0);
  assert.equal(cloudFormation(1,1,0),1);
});

test('weather has coherent clear regions, multi-level fronts and low marine decks',()=>{
  // Several hundred kilometres around a subtropical high remain mostly clear.
  let clear=0;
  for(let lat=25;lat<=29;lat++)for(let lon=-42;lon<=-38;lon++)clear+=fraction(at(lon,lat));
  assert.ok(clear/25<.15);
  const front=at(-52,57);
  assert.ok(front.slice(0,3).every(v=>v>.6),'front should connect all cloud layers');
  assert.ok(fraction(front)>.9);
  const marine=at(-86,-19),inland=at(-86,-19,1);
  assert.ok(marine[0]>.6&&marine[1]<.05&&marine[2]<.05,'marine deck belongs at low altitude');
  assert.ok(inland[0]<marine[0]-.4,'coastal deck must use the land mask');
  assert.ok(marine[3]<front[3],'marine clouds must be shallower than frontal clouds');
});

test('cube directions join across edges and put the polar caps on the correct faces',()=>{
  for(const v of [-1,-.5,0,.5,1]){
    assert.deepEqual(weatherDirection(0,1,v),weatherDirection(5,-1,v));
    assert.deepEqual(weatherDirection(0,-1,v),weatherDirection(4,1,v));
    assert.deepEqual(weatherDirection(2,v,1),weatherDirection(4,v,-1));
  }
  assert.equal(weatherDirection(4,0,0)[2],1);
  assert.equal(weatherDirection(5,0,0)[2],-1);
});

test('spherical weather is continuous at the date line and well behaved at the poles',()=>{
  for(let lat=-90;lat<=90;lat+=5){
    const left=at(-180+.000001,lat),right=at(180-.000001,lat);
    left.forEach((value,c)=>assert.ok(Math.abs(value-right[c])<.00001));
  }
  for(const lat of [-90,90])for(let lon=-180;lon<=180;lon+=30){
    at(lon,lat).forEach((value,c)=>assert.ok(Math.abs(value-at(0,lat)[c])<.00001));
  }
});

test('coastline rasterization retains polygon holes, islands and latitude orientation',()=>{
  const ring=(left,bottom,right,top)=>[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]];
  const mask=landMask({features:[
    {geometry:{type:'Polygon',coordinates:[ring(-40,10,40,60),ring(-10,25,10,45)]}},
    {geometry:{type:'MultiPolygon',coordinates:[[ring(80,-50,110,-20)],[ring(-110,-50,-80,-20)]]}},
  ]},360,180);
  const sample=(lon,lat)=>mask[Math.floor(lat+90)*360+Math.floor(lon+180)];
  assert.equal(sample(25,35),1);assert.equal(sample(0,35),0);
  assert.equal(sample(95,-35),1);assert.equal(sample(-95,-35),1);
  assert.equal(sample(95,35),0);assert.equal(sample(0,-70),0);
});

test('committed atlas matches its generator and has both sunny and dense cloudy regions within budget',()=>{
  const data=buildWeatherMap(land),saved=readFileSync(new URL('../public/assets/cloud-weather.rgba',import.meta.url));
  assert.deepEqual(data,new Uint8Array(saved),'run npm run build:weather after changing the model');
  assert.equal(data.byteLength,WEATHER_FACE_SIZE**2*6*4);
  assert.ok(data.byteLength<=512*1024);
  let total=0,clear=0,overcast=0;
  for(let face=0;face<6;face++)for(let y=0;y<WEATHER_FACE_SIZE;y++)for(let x=0;x<WEATHER_FACE_SIZE;x++){
    const u=(x+.5)/WEATHER_FACE_SIZE*2-1,v=(y+.5)/WEATHER_FACE_SIZE*2-1;
    const weight=1/(1+u*u+v*v)**1.5,i=((face*WEATHER_FACE_SIZE+y)*WEATHER_FACE_SIZE+x)*4;
    const value=fraction([data[i]/255,data[i+1]/255,data[i+2]/255]);
    total+=weight;clear+=weight*(value<.08);overcast+=weight*(value>.65);
  }
  // Broad regression bounds for diversity, not a climatological cloud-cover target.
  assert.ok(clear/total>.2&&clear/total<.7);
  assert.ok(overcast/total>.05&&overcast/total<.5);
});

test('weather texture loads once, filters distant regions and disposes its GPU resource',async t=>{
  const bytes=readFileSync(new URL('../public/assets/cloud-weather.rgba',import.meta.url));
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(bytes));
  const weather=weatherTexture();await weather.ready;
  assert.equal(fetch.mock.callCount(),1);
  assert.equal(fetch.mock.calls[0].arguments[0],'/assets/cloud-weather.rgba');
  assert.ok(weather.map.isCubeTexture);assert.equal(weather.map.images.length,6);
  for(const face of weather.map.images){assert.equal(face.image.width,WEATHER_FACE_SIZE);assert.equal(face.image.height,WEATHER_FACE_SIZE);}
  assert.equal(weather.map.wrapS,THREE.ClampToEdgeWrapping);assert.equal(weather.map.wrapT,THREE.ClampToEdgeWrapping);
  assert.equal(weather.map.minFilter,THREE.LinearMipmapLinearFilter);assert.ok(weather.map.generateMipmaps);
  let disposed=false;weather.map.addEventListener('dispose',()=>{disposed=true;});weather.dispose();assert.ok(disposed);
});

test('missing or invalid atlas keeps a valid clear texture and resolves initialization',async t=>{
  const warnings=t.mock.method(console,'warn',()=>{});
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:404}));
  for(const response of [new Response(null,{status:404}),new Response(new Uint8Array(12))]){
    fetch.mock.mockImplementation(async()=>response);
    const weather=weatherTexture();await weather.ready;
    for(const face of weather.map.images){assert.equal(face.image.width,1);assert.deepEqual(face.image.data,new Uint8Array(4));}weather.dispose();
  }
  assert.equal(warnings.mock.callCount(),2);
});

test('disposal while an atlas is loading cannot upload into the discarded texture',async t=>{
  let complete;
  t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{complete=resolve;}));
  const weather=weatherTexture();weather.dispose();
  complete(new Response(new Uint8Array(WEATHER_FACE_SIZE**2*6*4)));
  await weather.ready;assert.ok(weather.map.images.every(face=>face.image.width===1));
});
