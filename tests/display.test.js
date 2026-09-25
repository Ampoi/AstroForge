import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameClock, frameRate} from '../src/display.ts';
import {FlightMotion} from '../src/flight-motion.ts';

const pose = (time, fields = {}) => ({id:'vehicle', craft:{name:'test',parts:[]}, status:'flying',
  time, position:[time * 100, 0, 0], quaternion:[0,0,0,1], com:[1,0,0], altitude:time * 100,
  debris:[], ...fields});
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);

test('frame caps retain their cadence across common display refresh rates', () => {
  for (const hz of [60,120,144,165,240]) for (const rate of ['display','30','60','120']) {
    const clock = new FrameClock(); clock.setRate(rate);
    let frames = 0;
    for (let i=0;i<hz*10;i++) if(clock.tick(i*1000/hz)!==null)frames++;
    assert.ok(Math.abs(frames/10-Math.min(hz,rate==='display'?hz:Number(rate)))<.2, `${hz} Hz / ${rate}: ${frames}`);
    assert.ok(Math.abs(clock.fps-Math.min(hz,rate==='display'?hz:Number(rate)))<=1);
  }
});
test('frame rate changes and tab resumes render immediately without catching up missed frames', () => {
  const clock = new FrameClock();clock.setRate('30');
  assert.notEqual(clock.tick(0),null);assert.equal(clock.tick(10),null);
  clock.setRate('display');assert.notEqual(clock.tick(11),null);
  clock.setRate('30');assert.notEqual(clock.tick(12),null);
  clock.reset();assert.equal(clock.fps,0);assert.notEqual(clock.tick(60000),null);
  assert.equal(clock.tick(60001),null);assert.notEqual(clock.tick(60100),null);
  assert.equal(clock.tick(60101),null);
  for(const value of [null,undefined,'0','144','bogus',60])assert.equal(frameRate(value),'display');
});
test('flight display smoothly interpolates position and shortest-path normalized orientation', () => {
  const motion = new FlightMotion(), a = pose(1), b = pose(2,{quaternion:[0,0,1,0]});
  motion.push(a,0);assert.equal(motion.sample(0),a);
  motion.push(b,100);near(motion.sample(150).position[0],150);
  near(motion.sample(150).quaternion[2],Math.SQRT1_2);
  near(motion.sample(150).quaternion[3],Math.SQRT1_2);
  assert.equal(motion.sample(1000),b);assert.deepEqual(a.position,[100,0,0]);
  motion.push(pose(3,{quaternion:[0,0,-1,0]}),200);
  near(Math.abs(motion.sample(250).quaternion[2]),1);
});
test('irregular arrivals stay continuous, duplicates do not restart interpolation, and time warp uses simulation time', () => {
  const motion = new FlightMotion();motion.push(pose(0),0);motion.push(pose(1),100);
  const halfway = motion.sample(150).position[0];
  motion.push(pose(2),150);near(motion.sample(150).position[0],halfway);
  motion.push(pose(2),175);near(motion.sample(200).position[0],200);
  motion.push(pose(12),250);near(motion.sample(300).position[0],700);
  assert.equal(motion.sample(10000).time,12);
});
test('switches, staging, impacts, resets and reconnections snap instead of blending unrelated poses', () => {
  for (const fields of [{id:'another'}, {craft:{name:'test',parts:[{id:'stage'}]}},
    {status:'destroyed'}, {status:'landed'}, {time:0}]) {
    const motion = new FlightMotion();motion.push(pose(1),0);
    const next=pose(2,fields);motion.push(next,100);assert.equal(motion.sample(100),next);
  }
  const motion=new FlightMotion();motion.push(pose(1),0);
  const next=pose(3);motion.push(next,1000);assert.equal(motion.sample(1000),next);
  motion.push(pose(4),1100);motion.snap();assert.equal(motion.sample(1100).time,4);
  motion.clear();assert.equal(motion.sample(1200),null);
});
test('other vehicles interpolate by identity and new or destroyed fragments take effect immediately', () => {
  const motion=new FlightMotion();motion.push(pose(1,{debris:[pose(1,{id:'old'}),pose(1,{id:'removed'})]}),0);
  motion.push(pose(2,{debris:[pose(2,{id:'new'}),pose(2,{id:'old'})]}),100);
  const sample=motion.sample(150);
  assert.deepEqual(sample.debris.map(d=>d.id),['new','old']);
  near(sample.debris[0].time,2);near(sample.debris[1].time,1.5);
  motion.push(pose(3,{debris:[pose(3,{id:'old',status:'destroyed'})]}),200);
  assert.equal(motion.sample(200).debris[0].status,'destroyed');
});
