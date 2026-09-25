import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cloudNoise,cloudRenderSize} from '../src/clouds.ts';

test('atmosphere pixel work stays bounded on landscape, portrait and high-DPI displays',()=>{
  for(const [width,height] of [[1280,720],[1920,1080],[3840,2160],[7680,4320],[2160,3840],[1,1],[0,0]]){
    const size=cloudRenderSize(width,height);
    assert.ok(Number.isInteger(size.width)&&size.width>=1);
    assert.ok(Number.isInteger(size.height)&&size.height>=1);
    assert.ok(size.width*size.height<=160000,`${width}x${height} exceeded atmosphere budget`);
    if(width>1&&height>1){
      assert.ok(size.width<=width&&size.height<=height);
      assert.ok(Math.abs(size.width/size.height-width/height)<.03);
    }
  }
});

test('baked cloud volume is repeatable and contains usable density and lighting normals',()=>{
  const first=cloudNoise(),second=cloudNoise(),data=first.image.data;
  assert.deepEqual(data,second.image.data);
  assert.ok(data.byteLength<=1024*1024,'baked field must remain small');
  let min=255,max=0,total=0;
  for(let i=0;i<data.length;i+=4){
    min=Math.min(min,data[i]);max=Math.max(max,data[i]);total+=data[i];
    const normal=[data[i+1],data[i+2],data[i+3]].map(v=>v/255*2-1);
    assert.ok(Math.abs(Math.hypot(...normal)-1)<.015,'invalid baked surface normal');
  }
  assert.ok(min<50&&max>200,'density field must contain both gaps and cloud bodies');
  assert.ok(total/(data.length/4)>90&&total/(data.length/4)<165);
  assert.equal(first.wrapS,THREE.RepeatWrapping);assert.equal(first.wrapT,THREE.RepeatWrapping);assert.equal(first.wrapR,THREE.RepeatWrapping);
  assert.ok(first.generateMipmaps,'distant cloud cells need filtering');
  first.dispose();second.dispose();
});
