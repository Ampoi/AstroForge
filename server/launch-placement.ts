import {Simulation, EARTH} from './physics.ts';
import {WHEEL} from './rover.ts';
import type {Craft} from '../shared/types.ts';
import {RUNWAY, LAUNCH_SITES, launchSiteId} from '../shared/launch-sites.ts';
import type {LaunchSiteId} from '../shared/launch-sites.ts';
import {SITE_GROUND} from '../shared/terrain.ts';
import {add, sub, rotate, axisAngle, qmul, qconj, cross} from '../shared/math.ts';

/** Conservative world-space part bounds, including wheel suspension. */
export function fixedBounds(body: Simulation, time: number) {
  const rotation = axisAngle([0,0,1], -EARTH.spin*time);
  const position = rotate(rotation, body.position), q = qmul(rotation, body.quaternion);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const part of body.props.parts) {
    const half = [part.def.height/2, (part.def.width??1.25)/2, (part.def.depth??1.25)/2];
    if (part.type === 'wheel') half[2] += WHEEL.extension + WHEEL.radius;
    for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) {
      const local = add(part.position, rotate(part.rotation??[0,0,0,1], [x*half[0],y*half[1],z*half[2]]));
      const point = add(position, rotate(q, sub(local,body.props.com)));
      for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
    }
  }
  return {min,max};
}

export function launchPlacement(craft: Craft, requested: unknown, time: number) {
  const body = new Simulation(craft), site = launchSiteId(requested, body.rover);
  const horizontal = site === 'runway' || site === 'ground' && body.rover;
  body.quaternion = horizontal ? [.5,.5,.5,.5] : [0,0,0,1];
  body.position = [EARTH.radius,0,0];
  const bottom = fixedBounds(body,0).min[0] - EARTH.radius;
  // Use the same wheel rest height as the ground vehicle implementation.
  const wheelBottom = body.rover ? Math.min(...body.props.parts.filter(p=>p.type==='wheel').map(p=>p.position[2]-WHEEL.extension-WHEEL.radius)) - body.props.com[2] : bottom;
  const height = site === 'pad' ? body.props.com[0] : (site === 'runway' ? RUNWAY.height : SITE_GROUND) - (horizontal && body.rover ? wheelBottom : bottom) + .08;
  body.position = [EARTH.radius+height, site === 'runway' ? RUNWAY.spawnEast : site === 'ground' ? 200 : 0, site === 'runway' ? RUNWAY.north : 0];
  body.padHeight = Math.hypot(...body.position)-EARTH.radius;
  body.surfaceLaunch = horizontal;
  body.status = horizontal ? 'flying' : 'pad';
  const rotation = axisAngle([0,0,1], EARTH.spin*time);
  body.position = rotate(rotation,body.position);body.quaternion = qmul(rotation,body.quaternion);
  body.omega = rotate(qconj(body.quaternion),[0,0,EARTH.spin]);body.velocity = cross([0,0,EARTH.spin],body.position);
  body.createdAt=time;body.time=time;body.events=[];
  body.event(`${LAUNCH_SITES[site].label}に配置。UDPコマンドを待っています。`);
  return {body,site};
}

export function facilityBounds(site: LaunchSiteId) {
  return site === 'runway' ? {east:RUNWAY.east,north:RUNWAY.north,halfEast:RUNWAY.length/2,halfNorth:RUNWAY.width/2,height:RUNWAY.height}
    : site === 'pad' ? {east:0,north:0,halfEast:46,halfNorth:46,height:0}
    : {east:200,north:0,halfEast:25,halfNorth:25,height:SITE_GROUND};
}
