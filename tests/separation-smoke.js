// Real UDP separation check against an idle, disposable local test server.
// Usage: node tests/separation-smoke.js http://127.0.0.1:3002
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {setTimeout as delay} from 'node:timers/promises';
import {twoStageCraft} from '../shared/craft.ts';

const base=process.argv[2]||'http://127.0.0.1:3002';
async function api(path,data){
  const response=await fetch(base+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function until(predicate){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const state=await api('/api/state');if(predicate(state))return state;await delay(50);}
  throw Error('Timed out waiting for the expected simulation state');
}
const original=await api('/api/state');assert.equal(original.mode,'editor','Return the test server to the editor first');
const socket=dgram.createSocket('udp4');let sequence=0;
try{
  const placed=await api('/api/launch',twoStageCraft());
  const launch=await api('/api/control',{vehicleId:placed.activeVehicleId,enabled:true});
  const send=(type,fields)=>new Promise((resolve,reject)=>socket.send(Buffer.from(JSON.stringify({type,...launch.connection.session,controllerId:'separation-smoke',leaseId:'smoke',sequence:++sequence,...fields})),launch.connection.commandPort,'127.0.0.1',error=>error?reject(error):resolve()));
  const engine=(name,thrust)=>send('pylon_actuator_command',{actuatorType:'engine',name,enabled:true,targetThrust:thrust,timeoutSeconds:5});
  await send('pylon_control_authority_command',{action:'acquire',priority:10,leaseDurationSeconds:10,suppressSas:true});
  await until(s=>s.connection.authority.controllerId==='separation-smoke');
  await engine('engine_1',60000);await until(s=>s.flight.altitude>5);
  const before=await api('/api/state');
  await send('pylon_actuator_command',{actuatorType:'separation',name:'separator_1',separate:true});
  const separated=await until(s=>s.flight.separations.length===1);
  assert.equal(separated.flight.debris.length,1);assert.ok(separated.flight.mass<before.flight.mass);
  assert.ok(!separated.craft.parts.some(p=>p.id==='engine_1'||p.id==='tank_2'));
  assert.equal(separated.flight.fuel,1200);
  await engine('upper_engine',60000);await until(s=>s.flight.thrust>59000&&s.flight.fuel<1200);
  await send('pylon_actuator_command',{actuatorType:'separation',name:'separator_1',separate:true});
  const duplicate=await until(s=>s.connection.lastCommand.reason==='unknown_actuator');assert.equal(duplicate.flight.separations.length,1);
  console.log('PASS: real UDP liftoff, separation, detached-body telemetry, upper-stage ignition, and duplicate rejection.');
}finally{
  socket.close();await api('/api/revert',{});
  // Restore the test server's original craft without writing the saved slot.
  await api('/api/launch',original.craft);await api('/api/revert',{});
}
