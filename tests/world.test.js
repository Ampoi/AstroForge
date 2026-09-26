import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightWorld,TIME_SCALES} from '../server/world.ts';
import {Simulation,EARTH,STEP} from '../server/physics.ts';
import {starterCraft,twoStageCraft} from '../shared/craft.ts';
import {add,sub,mul,norm,cross} from '../shared/math.ts';

function flying(craft=starterCraft(),height=1000){const s=new Simulation(craft);s.status='flying';s.position=[EARTH.radius+height,0,0];s.velocity=cross([0,0,EARTH.spin],s.position);return s;}
test('time warp advances exact fixed steps and keeps wall-clock command expiry',()=>{
  const world=new FlightWorld(starterCraft());world.setTimeScale(10);
  const s=world.active;s.engines.engine_1={enabled:true,targetThrust:60000,expires:3};
  assert.equal(world.advance(.1,1),120);assert.ok(Math.abs(world.time-1)<1e-9);assert.ok(s.last.thrust>0);
  world.advance(.1,4);assert.equal(s.last.thrust,0);assert.ok(Math.abs(world.time-2)<1e-9);
  assert.throws(()=>world.setTimeScale(11));assert.throws(()=>world.setTimeScale('10'));assert.throws(()=>world.setTimeScale(null));
});
test('all warp rates through 200 preserve fixed steps, resources and wall-clock expiry',()=>{
  for(const scale of TIME_SCALES){
    const world=new FlightWorld(starterCraft()),reference=new FlightWorld(starterCraft());
    world.setTimeScale(scale);
    for(const w of [world,reference])w.active.engines.engine_1={enabled:true,targetThrust:60000,expires:3};
    for(const now of [1,4]){
      assert.equal(world.advance(STEP,now),scale);
      for(let i=0;i<scale;i++)reference.step(STEP,now);
      assert.deepEqual(world.active.position,reference.active.position);
      assert.equal(world.active.fuel,reference.active.fuel);
    }
    assert.ok(Math.abs(world.time-2*scale*STEP)<1e-9);
    assert.equal(world.active.last.thrust,0);
    world.setTimeScale(1);assert.equal(world.advance(STEP,5),1);
  }
  const world=new FlightWorld(starterCraft());world.setTimeScale(200);
  for(const invalid of [201,1000,0,-1,NaN,Infinity,1.5,'200',null]){
    assert.throws(()=>world.setTimeScale(invalid));assert.equal(world.timeScale,200);
  }
});
test('new vessels share Earth time while earlier flights survive and pad occupancy is protected',()=>{
  const world=new FlightWorld(starterCraft()),first=world.active;first.status='flying';first.position=[EARTH.radius+1000,0,0];
  world.advance(.1,0);const second=world.add(twoStageCraft());
  assert.equal(world.vehicles.length,2);assert.equal(second.time,world.time);assert.equal(first.status,'flying');
  second.status='flying';assert.throws(()=>world.add(starterCraft()),/発射台付近/);
});
test('strong ground impact creates finite moving pieces, preserves resources, and expires debris',()=>{
  const s=flying(starterCraft(),5);s.velocity=add(s.velocity,[-20,0,0]);
  const oldMass=s.props.mass;
  for(let i=0;i<60&&s.status!=='destroyed';i++)s.step();
  assert.equal(s.status,'destroyed');assert.equal(s.impact.kind,'ground');assert.ok(s.debris.length>=3);
  assert.ok(Math.abs(s.debris.reduce((sum,p)=>sum+p.props.mass,0)-oldMass)<1e-7);
  const positions=s.debris.map(d=>[...d.position]);s.step();assert.ok(s.debris.some((d,i)=>norm(sub(d.position,positions[i]))>0));
  for(const d of s.debris)assert.ok([...d.position,...d.velocity,...d.quaternion].every(Number.isFinite));
  for(let i=0;i<2500;i++)s.step();assert.equal(s.debris.length,0);
});
test('extreme ground impact removes the vehicle and clears its engine',()=>{
  const s=flying(starterCraft(),5);s.velocity=add(s.velocity,[-90,0,0]);s.engines.engine_1={enabled:true,targetThrust:60000,expires:100};
  for(let i=0;i<60&&s.status!=='destroyed';i++)s.step();
  assert.equal(s.status,'destroyed');assert.equal(s.debris.length,0);assert.equal(s.last.thrust,0);assert.deepEqual(s.engines,{});
});
test('gentle upright ground contact remains landable',()=>{
  const s=flying(starterCraft(),3.5);s.velocity=add(s.velocity,[-1,0,0]);
  for(let i=0;i<60&&s.status==='flying';i++)s.step();assert.equal(s.status,'landed');assert.equal(s.debris.length,0);
});
test('head-on vehicle collision breaks both craft, including high speed tunneling',()=>{
  for(const speed of [20,1000]){
    const world=new FlightWorld(starterCraft());const a=flying(),b=flying();
    a.position[1]=-2;b.position[1]=2;a.velocity[1]+=speed;b.velocity[1]-=speed;
    world.vehicles=[a,b];world.activeId=a.id;
    for(let i=0;i<30&&a.status!=='destroyed';i++)world.step();
    assert.equal(a.status,'destroyed');assert.equal(b.status,'destroyed');assert.equal(a.impact.kind,'vehicle');
    if(speed===20)assert.ok(a.debris.length>0);else assert.equal(a.debris.length,0);
  }
});
test('near-miss vessels and normal stage separation do not trigger damage',()=>{
  const world=new FlightWorld(twoStageCraft()),a=world.active;a.status='flying';a.position=[EARTH.radius+10000,0,0];a.separate('separator_1');
  for(let i=0;i<180;i++)world.step();assert.equal(a.status,'flying');assert.equal(a.debris[0].status,'flying');
  const b=flying();b.position[2]=20;world.vehicles.push(b);
  for(let i=0;i<120;i++)world.step();assert.equal(b.status,'flying');
});
