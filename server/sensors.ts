import type {Simulation} from './physics.ts';
import type {LayoutPart} from '../shared/types.ts';
import type {Packet} from './types.ts';
import {createHash} from 'node:crypto';
import {EARTH} from './physics-reference.ts';
import {GROUND_ALTITUDE,sensorName} from '../shared/craft.ts';
import {add,sub,mul,dot,norm,unit,rotate,qmul,axisAngle} from '../shared/math.ts';
import {PartIdentity} from './part-identity.ts';

export const SENSOR_TYPES=['lidar2d','lidar3d','camera','startracker'];
export const SUN=unit([.3,-.8,.5]);
export function sensorMount(p:LayoutPart){
  const angle=p.angle??0;
  return {framePosition:[0,.16*Math.cos(angle),.16*Math.sin(angle)],frameRotation:qmul(axisAngle([1,0,0],angle),axisAngle([0,0,1],Math.PI/2))};
}
export function sensorPose(sim:Simulation,p:LayoutPart){
  const mount=sensorMount(p);
  return {...mount,origin:add(sim.position,rotate(sim.quaternion,sub(add(p.position,rotate(p.rotation??[0,0,0,1],mount.framePosition)),sim.props.com))),rotation:qmul(sim.quaternion,qmul(p.rotation??[0,0,0,1],mount.frameRotation))};
}
export function raySphere(origin:number[],direction:number[],center:number[],radius:number){
  const offset=sub(origin,center),b=dot(offset,direction),c=dot(offset,offset)-radius*radius,disc=b*b-c;
  if(disc<0)return Infinity;
  const root=Math.sqrt(disc),near=-b-root,far=-b+root;
  return near>1e-5?near:far>1e-5?far:Infinity;
}
export function sceneRays(observer:Simulation,includeSelf=false,excludePart=''){
  // Build immutable geometry once per sample. Every ray observes the same epoch.
  const spheres=observer.environmentBodies().filter(b=>b.status!=='destroyed'&&(includeSelf||b!==observer)).flatMap(b=>b.props.parts.filter(p=>b!==observer||p.id!==excludePart).flatMap(p=>{
    const radius=p.def.radial?Math.max(.1,p.def.height/2):Math.min(.625,p.def.height/2);
    const half=p.def.radial?0:Math.max(0,p.def.height/2-radius),count=Math.max(1,Math.ceil(half*2/.4));
    return Array.from({length:count+1},(_,i)=>({center:add(b.position,rotate(b.quaternion,sub(add(p.position,rotate(p.rotation??[0,0,0,1],[-half+2*half*i/count,0,0])),b.props.com))),radius,color:p.def.color}));
  }));
  return (origin:number[],direction:number[],maxDistance=2000)=>{
    let distance=raySphere(origin,direction,[0,0,0],EARTH.radius+GROUND_ALTITUDE),color='#617454';
    for(const shape of spheres){const d=raySphere(origin,direction,shape.center,shape.radius);if(d<distance){distance=d;color=shape.color;}}
    return distance<=maxDistance?{distance,color}:null;
  };
}
export function fibonacciDirections(count:number){
  return Array.from({length:count},(_,i)=>{const x=(i+.5)/count,r=Math.sqrt(1-x*x),a=i*2.3999632;return [x,-Math.cos(a)*r,Math.sin(a)*r];});
}
export class Sensors{
  private next=new Map<string,number>();
  private acquired=new Map<string,number>();
  private sequence=0;
  private rng=123456789;
  constructor(private ids:PartIdentity){}
  reset(){this.next.clear();this.acquired.clear();}
  private gaussian(){const uniform=()=>{this.rng^=this.rng<<13;this.rng^=this.rng>>>17;this.rng^=this.rng<<5;return ((this.rng>>>0)+1)/4294967297;};return Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());}
  sample(sim:Simulation,sessionId:string,packet:(type:string,fields:Record<string,unknown>)=>Packet){
    const packets:Packet[]=[];
    if(sim.status==='destroyed')return packets;
    for(const p of sim.props.parts.filter(p=>SENSOR_TYPES.includes(p.type)||(p.type==='docking'&&sim.selectedDockingCamera===p.id))){
      if(sim.time<(this.next.get(p.id)??-Infinity))continue;
      this.next.set(p.id,sim.time+.2);
      const pose=sensorPose(sim,p),metadata={sensorId:sensorName(p.id),partFlightId:this.ids.get(p.id),vessel:sim.craft.name,sessionId,sequence:++this.sequence,coordinateFrame:'ros_sensor',framePosition:pose.framePosition,frameRotation:pose.frameRotation};
      if(p.type==='startracker'){
        const forward=rotate(pose.rotation,[1,0,0]),rate=norm(sim.omega)*180/Math.PI,altitude=norm(pose.origin)-EARTH.radius;
        let reason=sim.charge<=0?'no_power':altitude<80000?'atmosphere':dot(forward,SUN)>Math.cos(35*Math.PI/180)?'sun_exclusion':rate>5?'slew_rate_exceeded':'tracking';
        // Body limb plus a 10 degree half field of view.
        if(reason==='tracking'&&dot(forward,mul(unit(pose.origin),-1))>Math.cos(Math.asin(Math.min(1,EARTH.radius/norm(pose.origin)))+10*Math.PI/180))reason='body_in_fov';
        if(reason==='tracking'&&sceneRays(sim,true,p.id)(pose.origin,forward,10000))reason='occluded';
        if(reason!=='tracking')this.acquired.delete(p.id);
        else{if(!this.acquired.has(p.id))this.acquired.set(p.id,sim.time);if(sim.time-this.acquired.get(p.id)!<1)reason='acquiring';}
        const sigma=.0001,noise=[this.gaussian(),this.gaussian(),this.gaussian()];
        packets.push(packet('pylon_star_tracker',{...metadata,referenceFrame:'kerbol_inertial',measuredFrame:'base_link',valid:reason==='tracking',reason,orientation:reason==='tracking'?qmul(sim.quaternion,axisAngle(unit(noise),norm(noise)*sigma)):null,noiseStdRad:sigma,angularRateDegSec:rate}));
        continue;
      }
      if(sim.charge<=0)continue;
      const ray=sceneRays(sim,p.type==='camera'||p.type==='docking',p.id),cast=(direction:number[])=>ray(pose.origin,rotate(pose.rotation,direction),(p.type==='camera'||p.type==='docking')?Infinity:2000);
      if(p.type==='camera'||p.type==='docking'){
        const width=64,height=48,data=Buffer.alloc(width*height*3),tan=Math.tan(Math.PI/6);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const hit=cast(unit([1,-(2*(x+.5)/width-1)*tan*width/height,-(2*(y+.5)/height-1)*tan]));
          const rgb=hit?hit.color.slice(1).match(/../g)!.map(v=>parseInt(v,16)):[15,23,38];
          const shade=hit?.distance?Math.max(.3,1-hit.distance/2500):1;
          for(let c=0;c<3;c++)data[(y*width+x)*3+c]=Math.round(rgb[c]*shade);
        }
        packets.push(packet('pylon_camera_frame_chunk',{...metadata,source:p.type==='docking'?'docking_port':'rgb_camera',width,height,step:width*3,encoding:'rgb8',verticalFovDeg:60,frameBytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),chunkIndex:0,chunkCount:1,data:data.toString('base64')}));
      }else{
        const mode=p.type==='lidar2d'?'2D':'3D',directions=mode==='2D'?Array.from({length:360},(_,i)=>{const angle=-Math.PI+i*2*Math.PI/360;return [Math.cos(angle),Math.sin(angle),0];}):fibonacciDirections(512);
        const ranges=directions.map(d=>cast(d)?.distance??null);
        packets.push(packet('pylon_lidar_scan',{...metadata,mode,rayCount:directions.length,horizontalCount:mode==='2D'?360:512,verticalCount:1,horizontalFovDeg:360,verticalFovDeg:mode==='3D'?180:0,scanRateHz:5,maxDistance:2000,layout:mode==='3D'?'fibonacci-hemisphere':'vertical-major',origin:[0,0,0],ranges,hitMask:ranges.map(v=>v!==null),hitCount:ranges.filter(v=>v!==null).length}));
      }
    }
    return packets;
  }
}
