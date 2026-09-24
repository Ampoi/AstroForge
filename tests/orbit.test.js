import test from 'node:test';
import assert from 'node:assert/strict';
import {predictOrbit} from '../shared/orbit.ts';
import {EARTH,orbitalElements,gravity,rk4} from '../server/physics.ts';
import {norm,sub,dot,cross} from '../shared/math.ts';
const {radius:R,mu}=EARTH;

test('circular map prediction starts at the craft and closes one inclined revolution',()=>{
  const r=R+400000,speed=Math.sqrt(mu/r),position=[r,0,0],velocity=[0,speed*.6,speed*.8];
  const points=predictOrbit(position,velocity),normal=cross(position,velocity);
  assert.equal(points.length,385);assert.deepEqual(points[0],position);assert.ok(norm(sub(points.at(-1),position))<1e-6);
  for(const p of points){assert.ok(Math.abs(norm(p)-r)<1e-6);assert.ok(Math.abs(dot(p,normal))/norm(normal)<1e-6);}
  assert.ok(points[1][1]>0&&points[1][2]>0);
});
test('elliptic prediction reproduces apsides in either direction',()=>{
  const rp=R+200000,ra=R+3000000,a=(rp+ra)/2;
  for(const sign of [-1,1]){
    const points=predictOrbit([rp,0,0],[0,sign*Math.sqrt(mu*(2/rp-1/a)),0]);
    assert.ok(Math.abs(Math.max(...points.map(norm))-ra)<1e-6);assert.ok(points[1][1]*sign>0);
  }
});
test('suborbital prediction stops at the future surface impact and matches vacuum integration',()=>{
  const position=[R+90000,0,0],velocity=[900,600,130],points=predictOrbit(position,velocity);
  assert.ok(Math.abs(norm(points.at(-1))-R)<1e-6);assert.ok(points.every(p=>norm(p)>=R-.001));
  let state=[...position,...velocity];
  for(let i=0;i<20000&&norm(state.slice(0,3))>R;i++)state=rk4(state,.02,s=>[...s.slice(3),...gravity(s.slice(0,3))]);
  assert.ok(norm(sub(points.at(-1),state.slice(0,3)))<40);
  const inbound=predictOrbit([R+90000,0,0],[-900,600,130]);
  assert.ok(Math.abs(norm(inbound.at(-1))-R)<1e-6);assert.ok(inbound.every(p=>norm(p)<=R+90000.001));
});
test('parabolic and hyperbolic paths stay finite, open, and end at the escape boundary',()=>{
  const r=R+400000;
  for(const factor of [2,3]){
    const points=predictOrbit([r,0,0],[0,Math.sqrt(factor*mu/r),0]);
    assert.ok(points.length>100);assert.ok(points.flat().every(Number.isFinite));
    assert.ok(Math.abs(norm(points.at(-1))-R*40)<.01);assert.ok(norm(sub(points.at(-1),points[0]))>R);
  }
});
test('radial and stationary predictions remain finite and end at ground',()=>{
  for(const speed of [0,1000,-1000]){
    const points=predictOrbit([R+100000,0,0],[speed,0,0]);
    assert.ok(points.flat().every(Number.isFinite));assert.equal(norm(points.at(-1)),R);
    if(speed>0)assert.ok(points[1][0]>R+100000);
  }
  assert.deepEqual(predictOrbit([NaN,0,0],[0,0,0]),[]);assert.deepEqual(predictOrbit([0,0,0],[0,0,0]),[]);
});
test('near-radial launch retains its small angular motion without drawing a spurious full orbit',()=>{
  const position=[R+100,0,0],velocity=[10,465,0],points=predictOrbit(position,velocity);
  assert.ok(points.every(p=>norm(p)<R+110));assert.ok(points.at(-1)[1]>0);assert.ok(Math.abs(norm(points.at(-1))-R)<.01);
  assert.ok(orbitalElements(position,velocity).periapsis<0);
});
