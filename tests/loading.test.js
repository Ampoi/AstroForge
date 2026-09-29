import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingProgress, loadingStages} from '../src/loading.ts';
import {planetTexture} from '../src/terrain.ts';
import {weatherTexture} from '../src/weather.ts';

test('startup progress waits for every asset and GPU stage, even when tasks finish out of order', () => {
  const update=createLoadingProgress();
  update('planet',.5);
  let result;
  for(const stage of Object.keys(loadingStages).filter(stage=>stage!=='planet' && stage!=='gpu')) result=update(stage,1);
  assert.match(result.label,/地形/);
  const before=result.progress;
  assert.equal(update('planet',.1).progress,before);
  assert.equal(update('planet',1).progress,85);
  assert.equal(update('gpu',.5).progress,92);
  assert.equal(update('gpu',1).progress,100);
});

test('terrain progress messages cannot resolve readiness or replace texture pixels', async t => {
  let worker;
  class FakeWorker {constructor(){worker=this;} terminate(){}}
  const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  Object.defineProperty(globalThis,'Worker',{value:FakeWorker,configurable:true,writable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else delete globalThis.Worker;});
  const progress=[],planet=planetTexture(value=>progress.push(value)),initial=planet.map.image;
  let ready=false;
  planet.ready.then(()=>{ready=true;});
  worker.onmessage({data:{progress:.5}});
  await Promise.resolve();
  assert.equal(ready,false);assert.equal(planet.map.image,initial);assert.deepEqual(progress,[.5]);
  worker.onmessage({data:{data:new Uint8Array(4),width:1,height:1}});
  await planet.ready;
  assert.equal(ready,true);assert.deepEqual(progress,[.5,1]);
  planet.dispose();planet.map.dispose();
});

test('weather HTTP and invalid-data failures reject readiness rather than revealing a clear-sky placeholder', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  let weather=weatherTexture();
  await assert.rejects(weather.ready,/HTTP 503/);weather.dispose();
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(4)));
  weather=weatherTexture();
  await assert.rejects(weather.ready,/invalid dimensions/);weather.dispose();
});
