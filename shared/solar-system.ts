import {add,sub,mul,cross,unit} from './math.ts';

export const EARTH_RADIUS=6371000;
export const EARTH_SPIN=7.292115e-5;
export const SUN_RADIUS=696340000;
export const SUN_DISTANCE=149597870700;
export const MOON_RADIUS=1737400;
export const MOON_DISTANCE=384400000;
export const EARTH_YEAR=365.256363004*86400;
export const MOON_MONTH=27.321661*86400;
export const SUN_ROTATION=25.38*86400;
export type CelestialId='sun'|'earth'|'moon';

// Scenario ephemeris: circular, prograde orbits with a fixed inclined plane.
// The epoch preserves the simulator's original solar bearing; it is not a
// calendar ephemeris. Vehicle dynamics use Earth-centred coordinates.
const x=unit([-.3,.8,-.5]);
const y=unit(cross([0,0,1],x));
const normal=unit(cross(x,y));
const lunarY=add(mul(y,Math.cos(5.145*Math.PI/180)),mul(normal,Math.sin(5.145*Math.PI/180)));
const angle=(time:number,period:number)=>2*Math.PI*(time%period)/period;
function circle(time:number,period:number,radius:number,a=x,b=y){
  const phase=angle(time,period);
  return add(mul(a,radius*Math.cos(phase)),mul(b,radius*Math.sin(phase)));
}
export function earthPosition(time:number){return circle(time,EARTH_YEAR,SUN_DISTANCE);}
export function moonRelativePosition(time:number){return circle(time,MOON_MONTH,MOON_DISTANCE,x,lunarY);}
export function celestialPositions(time:number){
  const earth=earthPosition(time);
  return {sun:[0,0,0],earth,moon:add(earth,moonRelativePosition(time))};
}
export function sunDirection(time:number,observer:number[]=[0,0,0]){return unit(sub(mul(earthPosition(time),-1),observer));}
export function celestialOrbit(body:'earth'|'moon',segments=512){
  return Array.from({length:segments+1},(_,i)=>body==='earth'
    ?earthPosition(EARTH_YEAR*i/segments):moonRelativePosition(MOON_MONTH*i/segments));
}
export function bodySpin(body:CelestialId,time:number){
  return body==='earth'?(EARTH_SPIN*time)%(2*Math.PI):angle(time,body==='moon'?MOON_MONTH:SUN_ROTATION);
}
export const lunarOrbitNormal=unit(cross(x,lunarY));
