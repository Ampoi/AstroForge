import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SunBody,SceneLighting,EARTH_RADIUS,EARTH_SPIN,SUN_DISTANCE} from '../src/celestial.ts';

const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('the finite solar sphere retains its distance and apparent size as Earth rotates',()=>{
  const sun=new SunBody(),start=sun.position.clone();
  close(start.length()*EARTH_RADIUS/SUN_DISTANCE,1);
  const diameter=2*Math.asin(sun.radius/start.length())*180/Math.PI;
  assert.ok(diameter>.52&&diameter<.54);
  sun.update(Math.PI/EARTH_SPIN);
  close(sun.position.x,-start.x,1e-7);close(sun.position.y,-start.y,1e-7);close(sun.position.z,start.z,1e-7);
  sun.update(2*Math.PI/EARTH_SPIN);assert.ok(sun.position.distanceTo(start)<1e-7);
});

test('Earth blocks sunlight at night but allows sunlight above the depressed orbital horizon',()=>{
  const sun=new SunBody(),day=sun.position.clone().normalize();
  close(sun.visibilityFrom(day),1);close(sun.visibilityFrom(day.clone().negate()),0);
  const tangent=new THREE.Vector3().crossVectors(day,new THREE.Vector3(0,0,1)).normalize();
  const beyondTerminator=tangent.clone().addScaledVector(day,-.15).normalize();
  close(sun.visibilityFrom(beyondTerminator),0);
  close(sun.visibilityFrom(beyondTerminator.clone().multiplyScalar(1+400000/EARTH_RADIUS)),1);
  close(sun.visibilityFrom(day.clone().multiplyScalar(-1.1)),0);
  const edge=sun.visibilityFrom(tangent);
  assert.ok(edge>.4&&edge<.6,'the finite solar disc produces twilight at the horizon');
});

test('flight lighting follows the same solar bearing, fades in eclipse and restores editor lighting',()=>{
  const scene=new THREE.Scene(),lighting=new SceneLighting(scene),sun=new SunBody();
  const observer=new THREE.Vector3(0,1,0),center=new THREE.Vector3(0,12,0);
  lighting.flight(sun,observer,center);
  const direction=lighting.sun.position.clone().sub(lighting.sun.target.position).normalize();
  assert.ok(direction.distanceTo(sun.directionFrom(observer))<1e-12);
  assert.deepEqual(lighting.sun.target.position.toArray(),center.toArray());
  assert.ok(lighting.sun.intensity>3.9);close(lighting.rim.intensity,0);
  sun.update(Math.PI/EARTH_SPIN);lighting.flight(sun,observer,center);
  close(lighting.sun.intensity,0);assert.ok(lighting.sky.intensity<.04);
  lighting.editor();close(lighting.sun.intensity,4);close(lighting.rim.intensity,2.5);close(lighting.sky.intensity,2.4);
  lighting.dispose();
});
