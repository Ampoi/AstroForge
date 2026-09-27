import test from 'node:test';
import assert from 'node:assert/strict';
import { partInfoRows, partApiLink, restorePartInfoSettings, defaultPartInfoSettings, layoutPartCallouts } from '../src/part-info.ts';
const engine = {id:'engine_a',type:'engine'};
const values = rows => Object.fromEntries(rows.map(r => [r.key,r.value]));

test('engine inspection uses identity, converts normalized gimbals, and separates actual output from availability', () => {
  const flight = {engines:[{id:'other',thrust:900}, {id:engine.id,thrust:12345,available:true,gimbalPitch:1,gimbalYaw:-1}],wheels:[],joints:[]};
  assert.deepEqual(values(partInfoRows(engine,flight)), {id:'engine_a',name:'液体燃料エンジン',status:'ON',angle:'6° / -6°',output:'12,345 N'});
  flight.engines[1].thrust=0;
  assert.equal(values(partInfoRows(engine,flight)).status,'OFF');
  flight.engines[1].available=false;
  assert.equal(values(partInfoRows(engine,flight)).status,'使用不可');
  flight.engines=[];
  assert.equal(values(partInfoRows(engine,flight)).status,'未取得');
  assert.equal(values(partInfoRows(engine)).status,'組立中');
  assert.equal(partInfoRows(engine).find(r=>r.key==='output').label,'定格推力');
});
test('wheel/joint units and unobserved RCS states do not fabricate enabled telemetry', () => {
  const flight={engines:[],wheels:[{id:'w',driveTorque:-12,steering:Math.PI/6}],joints:[{id:'s',position:Math.PI/2},{id:'l',position:.1234}]};
  const wheel=values(partInfoRows({id:'w',type:'wheel'},flight));
  assert.equal(wheel.status,'ON');assert.equal(wheel.output,'-12 N·m');assert.equal(wheel.angle,'30°');
  assert.equal(values(partInfoRows({id:'s',type:'servo'},flight)).angle,'90°');
  assert.equal(values(partInfoRows({id:'l',type:'linear'},flight)).angle,'0.123 m');
  const rcs=partInfoRows({id:'r',type:'rcs'},flight);
  assert.equal(values(rcs).status,'未取得');assert.equal(rcs.find(r=>r.key==='output').label,'定格推力');
});
test('settings restore only booleans and links direct engine variants to the engine API', () => {
  assert.deepEqual(restorePartInfoSettings(null),defaultPartInfoSettings);
  assert.deepEqual(restorePartInfoSettings({enabled:true,id:false,output:'false',unknown:true}),{...defaultPartInfoSettings,enabled:true,id:false});
  for(const type of ['engine','booster_engine','vacuum_engine'])assert.equal(partApiLink({id:'a',type}),'/docs/udp/commands#エンジンを点火・停止する'.normalize('NFKD'));
  assert.equal(partApiLink({id:'w',type:'wheel'}),'/docs/rover#pylon互換udp');
});
test('crowded callouts stay in bounds, never overlap and always reserve room for the selected part', () => {
  for(const width of [250,500,1200])for(const height of [570,800,1080])for(const flying of [false,true]) {
    const anchors=Array.from({length:80},(_,i)=>({id:`p${i}`,x:width/2+(i%3-1)*10,y:height/2+i}));
    const heights=new Map(anchors.map(a=>[a.id,a.id==='p79'?252:96]));
    const labels=layoutPartCallouts({width,height,anchors},heights,'p79',flying);
    assert.ok(labels.some(l=>l.id==='p79'));
    for(const a of labels){
      assert.ok(a.top>=(flying?120:195));assert.ok(a.top+a.height<=height-100);
      assert.ok(a.left>=0&&a.left+a.width<=width);
      for(const b of labels)if(a!==b)assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);
    }
  }
});
test('hidden/offscreen or filtered anchors never create labels', () => {
  assert.deepEqual(layoutPartCallouts({width:1000,height:800,anchors:[]},new Map([['a',80]]),'a',true),[]);
  assert.deepEqual(layoutPartCallouts({width:1000,height:800,anchors:[{id:'a',x:500,y:400}]},new Map(),null,false),[]);
});

test('scene anchors follow world transforms and hide on the map, during placement and outside the camera', async () => {
  const {Group,PerspectiveCamera}=await import('three');
  const {RocketScene}=await import('../src/scene.ts');
  const camera=new PerspectiveCamera(45,1,.1,100);camera.position.z=10;
  const rocket=new Group(),part=new Group();rocket.add(part);
  let projection;
  const scene=Object.assign(Object.create(RocketScene.prototype),{
    camera,rocket,groups:new Map([['part',part]]),showPartInfo:true,selected:null,globe:false,placing:null,
    element:{clientWidth:800,clientHeight:800},onPartProjection:p=>projection=p,
  });
  scene.projectParts();assert.equal(projection.anchors[0].x,400);assert.equal(projection.anchors[0].y,400);
  rocket.position.x=1;scene.projectParts();assert.ok(projection.anchors[0].x>400);
  scene.showPartInfo=false;scene.projectParts();assert.equal(projection.anchors.length,0);
  scene.selected='part';scene.projectParts();assert.equal(projection.anchors.length,1);
  for(const field of ['globe','placing']){
    scene[field]=true;scene.projectParts();assert.equal(projection.anchors.length,0);scene[field]=false;
  }
  for(const z of [20,-200]){rocket.position.z=z;scene.projectParts();assert.equal(projection.anchors.length,0);}
  rocket.position.z=0;rocket.visible=false;scene.projectParts();assert.equal(projection.anchors.length,0);
});
