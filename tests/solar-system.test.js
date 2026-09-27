import test from 'node:test';
import assert from 'node:assert/strict';
import {celestialPositions,earthPosition,moonRelativePosition,bodySpin,celestialOrbit,EARTH_YEAR,MOON_MONTH,EARTH_SPIN,SUN_DISTANCE,MOON_DISTANCE} from '../shared/solar-system.ts';
import {norm,sub} from '../shared/math.ts';
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
test('Earth orbits a stationary Sun and Moon follows Earth at every epoch',()=>{
  for(const time of [0,86400,EARTH_YEAR/4,EARTH_YEAR/2,EARTH_YEAR*10]){
    const bodies=celestialPositions(time);
    assert.deepEqual(bodies.sun,[0,0,0]);close(norm(bodies.earth),SUN_DISTANCE,.0001);
    close(norm(sub(bodies.moon,bodies.earth)),MOON_DISTANCE,.0001);
  }
  close(norm(sub(earthPosition(EARTH_YEAR),earthPosition(0))),0);
  close(norm(sub(moonRelativePosition(MOON_MONTH),moonRelativePosition(0))),0);
  close(norm(sub(earthPosition(EARTH_YEAR/2),earthPosition(0))),2*SUN_DISTANCE,.001);
});
test('spin and closed orbit paths use simulation time, with synchronous lunar rotation',()=>{
  close(bodySpin('earth',2*Math.PI/EARTH_SPIN),0);
  close(bodySpin('moon',MOON_MONTH/4),Math.PI/2);
  close(bodySpin('moon',MOON_MONTH),0);
  for(const id of ['earth','moon']){const points=celestialOrbit(id);close(norm(sub(points[0],points.at(-1))),0);}
});
