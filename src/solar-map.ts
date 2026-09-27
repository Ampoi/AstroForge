import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import type {FlightSnapshot} from '../server/types.ts';
import type {NumericalOrbit} from '../shared/nbody-orbit.ts';
import {EARTH_RADIUS,SUN_RADIUS,SUN_DISTANCE,MOON_RADIUS,earthPosition,moonRelativePosition,celestialOrbit,bodySpin,lunarOrbitNormal,type CelestialId} from '../shared/solar-system.ts';

export type MapFocus=CelestialId|`vehicle:${string}`;
export const MAP_SCALE=10/EARTH_RADIUS;
export const mapVector=(p:number[])=>new THREE.Vector3(p[1],p[0],-p[2]).multiplyScalar(MAP_SCALE);
const bodyNames={sun:'太陽',earth:'地球',moon:'月'};
const bodyRadii={sun:SUN_RADIUS*MAP_SCALE,earth:10,moon:MOON_RADIUS*MAP_SCALE};
const bodyColors={sun:'#ffd486',earth:'#79c7ef',moon:'#c9cbd5'};
type Vessel=Pick<FlightSnapshot,'id'|'position'|'velocity'|'status'|'craft'>;
type Track={marker:THREE.Sprite;label:THREE.Sprite|null;orbit:Line2;position:THREE.Vector3;prediction?:NumericalOrbit};

function line(color:string){
  const result=new Line2(new LineGeometry(),new LineMaterial({color,linewidth:1.6,dashed:true,dashSize:1,gapSize:1,transparent:true,opacity:.75,depthWrite:false}));
  result.frustumCulled=false;return result;
}
function setPoints(path:Line2,points:THREE.Vector3[]){
  path.visible=points.length>1;
  if(!path.visible)return;
  const old=path.geometry;path.geometry=new LineGeometry().setFromPoints(points);old.dispose();path.computeLineDistances();
}
function label(text:string,color:string){
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=64;
  const ctx=canvas.getContext('2d')!;
  ctx.font='500 26px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=6;
  ctx.strokeStyle='#070e19';ctx.strokeText(text,192,32,375);ctx.fillStyle=color;ctx.fillText(text,192,32,375);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,depthWrite:false}));
  sprite.center.set(.5,-.25);return sprite;
}
function surfaceTexture(sun:boolean){
  const width=512,height=256,data=new Uint8Array(width*height*4);
  let seed=713;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const spots=Array.from({length:sun?14:110},()=>({u:random(),v:.12+random()*.76,r:.006+random()*(sun?.015:.045)}));
  const values=new Float32Array(width*height);
  for(let i=0;i<values.length;i++)values[i]=(sun?.9:.6)+random()*.1;
  // Rasterize only each spot's bounding box, keeping startup work bounded.
  for(const spot of spots){
    const rx=spot.r/Math.cos((spot.v-.5)*Math.PI),extent=1.18;
    for(let y=Math.max(0,Math.floor((spot.v-spot.r*extent)*height));y<Math.min(height,(spot.v+spot.r*extent)*height);y++){
      for(let x=Math.floor((spot.u-rx*extent)*width);x<(spot.u+rx*extent)*width;x++){
        const distance=Math.hypot((x/width-spot.u)/rx,(y/height-spot.v)/spot.r),index=y*width+(x%width+width)%width;
        if(distance<1)values[index]*=sun?.42:.64+.26*distance;
        else if(!sun&&distance<extent)values[index]=Math.min(1,values[index]+.12);
      }
    }
  }
  for(let i=0;i<values.length;i++){
    data[i*4]=255*values[i];data[i*4+1]=(sun?181:250)*values[i];data[i*4+2]=(sun?72:245)*values[i];data[i*4+3]=255;
  }
  const map=new THREE.DataTexture(data,width,height);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;return map;
}
function earthGeometry(){
  const geometry=new THREE.SphereGeometry(10,96,64),positions=geometry.attributes.position;
  // Match the terrain texture's longitude/latitude convention exactly.
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);positions.setXYZ(i,-z,x,-y);
  }
  geometry.computeVertexNormals();return geometry;
}

/** Map coordinates are non-rotating ECI axes, translated to the selected target.
 * CPU-side subtraction keeps metre-scale vehicle motion stable at one AU.
 * The heliocentric translation is common to Earth and all Earth-relative craft. */
export class SolarMap{
  readonly scene=new THREE.Scene();
  readonly bodies=new Map<CelestialId,THREE.Mesh>();
  readonly labels=new Map<CelestialId,THREE.Sprite>();
  readonly bodyMarkers=new Map<CelestialId,THREE.Sprite>();
  readonly tracks=new Map<string,Track>();
  readonly earthOrbit=line('#79c7ef');
  readonly moonOrbit=line('#c9cbd5');
  readonly trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#f4b582',transparent:true,opacity:.7,depthWrite:false}));
  readonly origin=new THREE.Vector3();
  readonly positions={sun:new THREE.Vector3(),earth:new THREE.Vector3(),moon:new THREE.Vector3()};
  private readonly sunlight=new THREE.DirectionalLight('#fff1d7',2.8);
  private readonly sunTexture:THREE.DataTexture;
  private readonly moonTexture:THREE.DataTexture;
  private trailPoints:THREE.Vector3[]=[];
  private trailId:string|null=null;
  focus:MapFocus='earth';time=0;
  private worker:Worker|null=null;
  private busy=false;private requestedAt=-Infinity;
  private generation=0;private flying=new Set<string>();
  predictionError=false;
  requestPredictions(vehicles:FlightSnapshot[],now:number){
    if(this.busy||now-this.requestedAt<1000)return;
    this.worker??=new Worker(new URL('./orbit-worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data}:{data:{generation:number;orbits:({id:string}&NumericalOrbit)[]}})=>{
      this.busy=false;
      if(data.generation!==this.generation)return;
      this.applyPredictions(data.orbits.filter(v=>this.flying.has(v.id)));this.predictionError=false;
    };
    this.worker.onerror=()=>{this.busy=false;this.predictionError=true;this.worker?.terminate();this.worker=null;};
    this.busy=true;this.requestedAt=now;
    this.worker.postMessage({generation:++this.generation,vehicles:vehicles.filter(v=>v.status==='flying').map(({id,position,velocity,time})=>({id,position,velocity,time}))});
  }
  constructor(earthMap:THREE.Texture,private readonly showLabels=true){
    this.scene.background=new THREE.Color('#050a13');
    this.sunTexture=surfaceTexture(true);this.moonTexture=surfaceTexture(false);
    this.bodies.set('earth',new THREE.Mesh(earthGeometry(),new THREE.MeshStandardMaterial({map:earthMap,roughness:1})));
    this.bodies.set('moon',new THREE.Mesh(new THREE.SphereGeometry(bodyRadii.moon,64,32),new THREE.MeshStandardMaterial({map:this.moonTexture,roughness:1})));
    this.bodies.set('sun',new THREE.Mesh(new THREE.SphereGeometry(bodyRadii.sun,64,32),new THREE.MeshBasicMaterial({map:this.sunTexture,toneMapped:false})));
    for(const [id,body] of this.bodies){
      this.scene.add(body);
      const marker=new THREE.Sprite(new THREE.SpriteMaterial({color:bodyColors[id],depthTest:false,depthWrite:false}));
      this.bodyMarkers.set(id,marker);this.scene.add(marker);
      if(showLabels){const text=label(bodyNames[id],bodyColors[id]);this.labels.set(id,text);this.scene.add(text);}
    }
    setPoints(this.earthOrbit,celestialOrbit('earth').map(mapVector));
    setPoints(this.moonOrbit,celestialOrbit('moon').map(mapVector));
    this.scene.add(this.earthOrbit,this.moonOrbit,this.trail,this.sunlight,this.sunlight.target,new THREE.AmbientLight('#c4d4ed',.28));
    this.updateTime(0);
  }
  setFocus(focus:MapFocus){
    this.focus=focus.startsWith('vehicle:')&&!this.tracks.has(focus.slice(8))?'earth':focus;
    this.updatePredictions();this.updateTime(this.time);
  }
  updateVehicles(vehicles:Vessel[],trailId:string,trail:number[][]=[]){
    this.flying=new Set(vehicles.filter(v=>v.status==='flying').map(v=>v.id));
    const live=new Set(vehicles.filter(v=>v.status!=='destroyed').map(v=>v.id));
    for(const [id,track] of this.tracks)if(!live.has(id)){this.disposeTrack(track);this.tracks.delete(id);}
    for(const v of vehicles){
      if(!live.has(v.id))continue;
      let track=this.tracks.get(v.id);
      if(!track){
        const marker=new THREE.Sprite(new THREE.SpriteMaterial({color:'#ffe9c0',depthTest:true,depthWrite:false}));
        const text=this.showLabels?label(v.craft.name,'#ffe9c0'):null;
        track={marker,label:text,orbit:line('#87e6dd'),position:mapVector(v.position)};
        this.tracks.set(v.id,track);this.scene.add(marker,track.orbit);if(text)this.scene.add(text);
      }
      track.position.copy(mapVector(v.position));
      if(v.status!=='flying'){track.prediction=undefined;track.orbit.visible=false;}
    }
    this.trailId=trailId;this.trailPoints=trail.map(mapVector);this.setTrailGeometry();
    if(this.focus.startsWith('vehicle:')&&!live.has(this.focus.slice(8)))this.focus='earth';
    this.updateTime(this.time);
  }
  applyPredictions(orbits:({id:string}&NumericalOrbit)[]){
    for(const orbit of orbits){const track=this.tracks.get(orbit.id);if(track)track.prediction=orbit;}
    this.updatePredictions();this.updateTime(this.time);
  }
  private updatePredictions(){
    for(const track of this.tracks.values())if(track.prediction){
      const points=track.prediction.samples.map(sample=>{
        let position=sample.position;
        if(this.focus==='sun'){const earth=earthPosition(sample.time);position=position.map((v,i)=>v+earth[i]);}
        else if(this.focus==='moon'){const moon=moonRelativePosition(sample.time);position=position.map((v,i)=>v-moon[i]);}
        return mapVector(position);
      });
      setPoints(track.orbit,points);
    }
  }
  updateTime(time:number,poses:Pick<Vessel,'id'|'position'>[]=[]){
    if(time<this.time-.001){this.generation++;this.requestedAt=-Infinity;}
    this.time=time;
    this.positions.sun.copy(mapVector(earthPosition(time))).negate();
    this.positions.moon.copy(mapVector(moonRelativePosition(time)));
    for(const pose of poses)this.tracks.get(pose.id)?.position.copy(mapVector(pose.position));
    const target=this.focus.startsWith('vehicle:')?this.tracks.get(this.focus.slice(8))?.position:this.positions[this.focus as CelestialId];
    this.origin.copy(target??this.positions.earth);
    for(const [id,body] of this.bodies){
      body.position.copy(this.positions[id]).sub(this.origin);
      this.labels.get(id)?.position.copy(body.position);this.bodyMarkers.get(id)?.position.copy(body.position);
    }
    this.bodies.get('earth')!.rotation.z=-bodySpin('earth',time);
    // Local +Z is the near side, locked towards Earth; the orbital normal is +Y.
    const moon=this.bodies.get('moon')!;
    moon.up.copy(mapVector(lunarOrbitNormal)).normalize();moon.lookAt(this.bodies.get('earth')!.position);
    const sun=this.bodies.get('sun')!;sun.rotation.set(Math.PI/2,bodySpin('sun',time),0);
    this.earthOrbit.position.copy(this.positions.sun).sub(this.origin);
    this.moonOrbit.position.copy(this.origin).negate();
    for(const [id,track] of this.tracks){
      track.marker.position.copy(track.position).sub(this.origin);track.label?.position.copy(track.marker.position);
      track.orbit.position.copy(this.focus==='sun'?this.positions.sun:this.focus==='moon'?this.positions.moon:this.positions.earth).sub(this.origin);
      track.orbit.material.opacity=this.focus===`vehicle:${id}`?.95:.4;
    }
    this.trail.visible=this.focus===`vehicle:${this.trailId}`&&this.trailPoints.length>1;
    this.trail.position.copy(this.origin).negate();
    this.sunlight.position.copy(this.positions.sun).normalize().multiplyScalar(1000).sub(this.origin);
    this.sunlight.target.position.copy(this.origin).negate();
  }
  get predictionStatus(){
    if(this.predictionError)return '軌道予測を再計算しています';
    const tracks=this.focus.startsWith('vehicle:')?[this.tracks.get(this.focus.slice(8))]:[...this.tracks.values()];
    const relevant=tracks.filter((track):track is Track=>!!track&&[...this.tracks].some(([id,t])=>t===track&&this.flying.has(id)));
    if(!relevant.length)return '飛行中の機体の軌道を表示します';
    if(relevant.some(t=>!t.prediction))return '軌道を計算中…';
    if(relevant.some(t=>t.prediction?.end==='invalid'))return '予測できない軌道があります';
    if(relevant.some(t=>t.prediction?.end==='budget'))return '計算上限までの予測を表示中';
    if(relevant.length===1){const p=relevant[0].prediction!;return `予測 ${(p.duration/3600).toFixed(1)} 時間${p.impact?` · ${bodyNames[p.impact]}表面まで`:''}`;}
    return `${relevant.length} 機の予測軌道を表示中`;
  }
  minDistance(){return this.focus.startsWith('vehicle:')?1:bodyRadii[this.focus as CelestialId]*1.12;}
  fitRadius(){return this.focus==='sun'?SUN_DISTANCE*MAP_SCALE:this.focus==='moon'?bodyRadii.moon:10.6;}
  fitDirection(){
    if(this.focus==='sun')return mapVector(lunarOrbitNormal).normalize();
    const radial=this.focus.startsWith('vehicle:')?this.origin.clone().normalize():new THREE.Vector3(0,1,0);
    return radial.addScaledVector(this.positions.sun.clone().normalize(),.65).normalize();
  }
  render(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera){
    const size=renderer.getSize(new THREE.Vector2());
    const pixel=2*Math.tan(camera.fov*Math.PI/360)/size.y;
    const dash=Math.max(.001,camera.position.length()*pixel*5);
    for(const orbit of [this.earthOrbit,this.moonOrbit,...[...this.tracks.values()].map(v=>v.orbit)]){
      orbit.material.resolution.copy(size);orbit.material.dashSize=dash;orbit.material.gapSize=dash;
    }
    const scale=(sprite:THREE.Sprite,text=false)=>{
      const unit=camera.position.distanceTo(sprite.position)*pixel;
      sprite.scale.set(unit*(text?150:6),unit*(text?25:6),1);
    };
    const earthScreen=this.bodies.get('earth')!.position.clone().project(camera),moonScreen=this.bodies.get('moon')!.position.clone().project(camera);
    const moonSeparated=Math.hypot((earthScreen.x-moonScreen.x)*size.x/2,(earthScreen.y-moonScreen.y)*size.y/2)>45;
    for(const [id,marker] of this.bodyMarkers){
      scale(marker);marker.visible=bodyRadii[id]<marker.scale.y*.5&&this.visibleFrom(camera,marker.position,id)&&(id!=='moon'||moonSeparated);
    }
    for(const [id,sprite] of this.labels){
      scale(sprite,true);sprite.center.set(.5,-.3-bodyRadii[id]/sprite.scale.y);
      sprite.visible=this.visibleFrom(camera,sprite.position,id)&&(id!=='moon'||moonSeparated||this.focus==='moon');
    }
    for(const [id,track] of this.tracks){
      scale(track.marker);
      if(track.label){scale(track.label,true);track.label.visible=this.visibleFrom(camera,track.marker.position)&&
        (this.focus===`vehicle:${id}`||camera.position.distanceTo(track.marker.position)<2000);}
      track.marker.visible=this.visibleFrom(camera,track.marker.position);
    }
    renderer.render(this.scene,camera);
  }
  private visibleFrom(camera:THREE.Camera,position:THREE.Vector3,own?:CelestialId){
    const ray=new THREE.Ray(camera.position,position.clone().sub(camera.position).normalize()),distance=camera.position.distanceTo(position);
    for(const [id,body] of this.bodies){
      if(id===own)continue;
      const hit=ray.intersectSphere(new THREE.Sphere(body.position,bodyRadii[id]),new THREE.Vector3());
      if(hit&&hit.distanceTo(camera.position)<distance-.00001)return false;
    }
    return true;
  }
  setTrailGeometry(){const old=this.trail.geometry;this.trail.geometry=new THREE.BufferGeometry().setFromPoints(this.trailPoints);old.dispose();}
  private disposeTrack(track:Track){
    for(const obj of [track.marker,track.label,track.orbit])if(obj){this.scene.remove(obj);obj.material.dispose();}
    track.label?.material.map?.dispose();track.orbit.geometry.dispose();
  }
  dispose(){
    this.worker?.terminate();
    for(const track of this.tracks.values())this.disposeTrack(track);
    for(const body of this.bodies.values()){body.geometry.dispose();(body.material as THREE.Material).dispose();}
    for(const sprite of [...this.labels.values(),...this.bodyMarkers.values()]){sprite.material.map?.dispose();sprite.material.dispose();}
    for(const path of [this.earthOrbit,this.moonOrbit,this.trail]){path.geometry.dispose();path.material.dispose();}
    this.sunTexture.dispose();this.moonTexture.dispose();
  }
}
