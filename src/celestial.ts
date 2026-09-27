import * as THREE from 'three';

import {EARTH_RADIUS,EARTH_SPIN,SUN_RADIUS,earthPosition} from '../shared/solar-system.ts';
export {EARTH_RADIUS,EARTH_SPIN,SUN_RADIUS,SUN_DISTANCE} from '../shared/solar-system.ts';

// Inertial metres -> Earth-fixed Three coordinates (north = -Z, launch zenith = +Y).
export function earthFixed(position: number[],time: number){
  const c=Math.cos(EARTH_SPIN*time),s=Math.sin(EARTH_SPIN*time),[x,y,z]=position;
  return new THREE.Vector3(-s*x+c*y,c*x+s*y,-z);
}

// The same scenario ephemeris drives flight lighting, power, sensors and the map.
export class SunBody{
  readonly radius=SUN_RADIUS/EARTH_RADIUS;
  readonly position=new THREE.Vector3();
  constructor(){this.update(0);}
  update(time: number){this.position.copy(earthFixed(earthPosition(time).map(v=>-v),time)).divideScalar(EARTH_RADIUS);}
  directionFrom(observer: THREE.Vector3){return this.position.clone().sub(observer).normalize();}
  visibilityFrom(observer: THREE.Vector3){
    const distance=observer.length(),direction=this.directionFrom(observer);
    // Compare solar elevation with the depressed horizon, including the solar disc.
    const elevation=Math.asin(THREE.MathUtils.clamp(observer.dot(direction)/Math.max(distance,1e-8),-1,1));
    const horizon=-Math.acos(1/Math.max(1,distance));
    const radius=Math.asin(this.radius/observer.distanceTo(this.position));
    return THREE.MathUtils.smoothstep(elevation-horizon,-radius,radius);
  }
}

export class SceneLighting{
  readonly sky=new THREE.HemisphereLight('#bddeef','#32464b',2.4);
  readonly sun=new THREE.DirectionalLight('#ffedda',4);
  readonly rim=new THREE.DirectionalLight('#6cb8e3',2.5);
  // A visual fill keeps all sides of the vehicle readable in eclipse.
  readonly fill=new THREE.AmbientLight('#c6d5ef',0);
  constructor(scene: THREE.Scene){
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-32,right:32,top:40,bottom:-32,near:.5,far:220});
    this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0001;
    scene.add(this.sky,this.sun,this.sun.target,this.rim,this.fill);this.editor();
  }
  editor(){
    this.fill.intensity=0;
    this.sky.intensity=2.4;this.sky.position.set(0,1,0);
    this.sun.position.set(8,18,12);this.sun.target.position.set(0,0,0);
    this.sun.color.set('#ffedda');this.sun.intensity=4;this.rim.intensity=2.5;this.rim.position.set(-10,10,-10);
  }
  flight(body: SunBody,observer: THREE.Vector3,center: THREE.Vector3){
    const direction=body.directionFrom(observer),height=Math.max(0,(observer.length()-1)*EARTH_RADIUS);
    const elevation=observer.clone().normalize().dot(direction),air=Math.exp(-height/18000);
    const daylight=THREE.MathUtils.smoothstep(elevation,-.10,.18);
    this.sun.target.position.copy(center);this.sun.position.copy(center).addScaledVector(direction,100);
    this.sun.intensity=4*body.visibilityFrom(observer);
    this.sun.color.set('#fff4e3').lerp(new THREE.Color('#ff9c59'),air*(1-THREE.MathUtils.smoothstep(elevation,0,.35)));
    this.sky.position.copy(observer).normalize();this.sky.intensity=.18+air*daylight*1.5;
    this.fill.intensity=.22;
    this.rim.intensity=0;
  }
  dispose(){this.sun.shadow.dispose();}
}
