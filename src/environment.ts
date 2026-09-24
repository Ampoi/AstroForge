import type {FlightSnapshot} from '../server/types.ts';
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {predictOrbit} from '../shared/orbit.ts';

export const EARTH_RADIUS=6371000;
const SPIN=7.292115e-5;
// Inertial metres -> Earth-fixed Three coordinates (north = -Z, launch zenith = +Y).
export function earthFixed(position: number[],time: number){
  const c=Math.cos(SPIN*time),s=Math.sin(SPIN*time),[x,y,z]=position;
  return new THREE.Vector3(-s*x+c*y,c*x+s*y,-z);
}
function seeded(seed: number){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function texture(canvas: HTMLCanvasElement){const t=new THREE.CanvasTexture(canvas);t.wrapS=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t;}

function earthTexture(){
  const c=document.createElement('canvas');c.width=2048;c.height=1024;const ctx=c.getContext('2d')!;
  ctx.fillStyle='#123f65';ctx.fillRect(0,0,c.width,c.height);
  const t=texture(c);
  const ready=fetch('/assets/land.json').then(r=>{if(!r.ok)throw Error('地形データを読み込めません');return r.json();}).then((data: {features:{geometry:{type:'Polygon';coordinates:number[][][]} | {type:'MultiPolygon';coordinates:number[][][][]}}[]})=>{
    const land=document.createElement('canvas');land.width=c.width;land.height=c.height;const lc=land.getContext('2d')!;
    lc.fillStyle='#84966b';
    for(const feature of data.features){
      const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
      for(const polygon of polygons){
        lc.beginPath();
        for(const ring of polygon){ring.forEach(([lon,lat],i)=>{const x=(lon+180)/360*c.width,y=(90-lat)/180*c.height;if(i)lc.lineTo(x,y);else lc.moveTo(x,y);});lc.closePath();}
        lc.fill('evenodd');
      }
    }
    lc.globalCompositeOperation='source-atop';
    const terrain=lc.createLinearGradient(0,0,0,c.height);
    for(const [p,color] of [[0,'#e4edf0'],[.1,'#bbc6b1'],[.2,'#78906c'],[.33,'#b6aa7a'],[.42,'#608166'],[.5,'#406f5a'],[.6,'#9d9569'],[.7,'#7c976f'],[.88,'#dfe7df'],[1,'#eef2ef']] as [number,string][])terrain.addColorStop(p,color);
    lc.fillStyle=terrain;lc.fillRect(0,0,c.width,c.height);
    const random=seeded(731);
    for(let i=0;i<24000;i++){lc.fillStyle=random()>.5?'#183e2410':'#e4d5ad12';lc.fillRect(random()*c.width,random()*c.height,random()*12+1,random()*4+1);}
    ctx.drawImage(land,0,0);
    const ice=ctx.createLinearGradient(0,0,0,100);ice.addColorStop(0,'#dbe9ee');ice.addColorStop(.5,'#dbe9eea0');ice.addColorStop(1,'#dbe9ee00');ctx.fillStyle=ice;ctx.fillRect(0,0,c.width,100);
    t.needsUpdate=true;
  }).catch(error=>console.warn('Earth texture:',error.message));
  return {map:t,ready};
}
function starTexture(){
  const c=document.createElement('canvas');c.width=2048;c.height=1024;const ctx=c.getContext('2d')!,random=seeded(411);
  ctx.fillStyle='#010208';ctx.fillRect(0,0,c.width,c.height);
  for(let i=0;i<5000;i++){
    const x=random()*c.width,y=Math.acos(2*random()-1)/Math.PI*c.height,r=random(),size=r>.992?.7:r>.93?.5:.3;
    ctx.fillStyle=`rgba(${random()>.3?'191,216,244':'242,217,184'},${.25+random()*.65})`;ctx.beginPath();ctx.arc(x,y,size,0,2*Math.PI);ctx.fill();
    if(r>.997){ctx.fillStyle='#aecfff0a';ctx.beginPath();ctx.arc(x,y,2,0,2*Math.PI);ctx.fill();}
  }
  return texture(c);
}

const fragmentShader=`
precision highp float;
uniform sampler2D earthMap;
uniform sampler2D stars;
uniform vec3 observer;
uniform vec3 sunDirection;
uniform mat3 cameraRotation;
uniform mat4 viewProjection;
uniform float aspect;
uniform float tanFov;
uniform float globe;
varying vec2 vUv;
const float PI=3.14159265359;
const float ATM=1.01256;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d);float c=dot(o,o)-r*r;float h=b*b-c;if(h<0.)return vec2(-1.);h=sqrt(h);return vec2(-b-h,-b+h);}
vec2 uv(vec3 n){return vec2(atan(n.x,n.y)/(2.*PI)+.5,asin(clamp(-n.z,-1.,1.))/PI+.5);}
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float clouds(vec3 n){vec3 p=n*18.;p+=vec3(sin(n.z*27.),cos(n.x*21.),sin(n.y*24.))*.9;return smoothstep(.48,.73,noise(p)*.57+noise(p*2.1)*.28+noise(p*4.3)*.15);}
void main(){
  vec2 screen=vUv*2.-1.;
  vec3 d=normalize(cameraRotation*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
  vec2 ground=sphere(observer,d,1.);
  float hit=ground.x>0.?ground.x:-1.;
  vec3 color=texture2D(stars,uv(d)).rgb*.85;
  float sunDot=dot(d,sunDirection);
  color+=vec3(1.,.85,.63)*(.07*pow(max(0.,sunDot),120.)+8.*smoothstep(.99997,.99999,sunDot));
  gl_FragDepth=1.;
  if(hit>0.){
    vec3 n=normalize(observer+d*hit);
    vec3 surface=texture2D(earthMap,uv(n)).rgb;
    float light=dot(n,sunDirection);
    float day=smoothstep(-.08,.12,light);
    float cloud=clouds(n)*.58;
    surface=mix(surface,vec3(.78,.86,.91),cloud);
    float ocean=1.-smoothstep(.01,.12,surface.r-surface.b+.12);
    float shine=pow(max(dot(reflect(-sunDirection,n),-d),0.),70.)*ocean*.15*(1.-cloud);
    color=surface*(.012+max(0.,light)*1.05)+shine*vec3(1.,.85,.61)*day;
    if(globe>.5){vec4 clip=viewProjection*vec4(n*10.,1.);gl_FragDepth=clip.z/clip.w*.5+.5;}
  }
  // Six samples of exponential atmospheric density. Visual scattering approximation.
  vec2 air=sphere(observer,d,ATM);
  if(air.y>0.){
    float start=max(0.,air.x),end=hit>0.?min(hit,air.y):air.y;
    float ds=max(0.,end-start)/6.;
    vec3 optical=vec3(0.),scatter=vec3(0.);
    vec3 beta=vec3(5.8,13.5,33.1);
    float phase=.75*(1.+sunDot*sunDot);
    for(int i=0;i<6;i++){
      vec3 point=observer+d*(start+(float(i)+.5)*ds);
      float height=max(0.,length(point)-1.);
      float density=exp(-height/.001255);
      float lighting=smoothstep(-.10,.12,dot(normalize(point),sunDirection));
      vec3 extinction=beta*density*ds*3.5;
      scatter+=exp(-optical)*(1.-exp(-extinction))*lighting*phase;
      optical+=extinction;
    }
    color=color*exp(-optical)+scatter*vec3(.18,.36,.70);
  }
  gl_FragColor=vec4(color,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeUniforms(map: THREE.Texture){return {earthMap:{value:map},stars:{value:starTexture()},observer:{value:new THREE.Vector3(0,1.001,0)},sunDirection:{value:new THREE.Vector3(-.8,.3,-.5).normalize()},cameraRotation:{value:new THREE.Matrix3()},viewProjection:{value:new THREE.Matrix4()},aspect:{value:1},tanFov:{value:Math.tan(17*Math.PI/180)},globe:{value:0}};}

export class EarthEnvironment{
  scene: THREE.Scene; camera: THREE.OrthographicCamera; ready: Promise<void>;
  uniforms: ReturnType<typeof makeUniforms>; overlay: THREE.Scene;
  trail: THREE.Line<THREE.BufferGeometry,THREE.LineBasicMaterial>; prediction: Line2;
  marker: THREE.Sprite; position: THREE.Vector3; time=0; destroyed=false;

  constructor(){
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const {map,ready}=earthTexture();this.ready=ready;
    this.uniforms=makeUniforms(map);
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);plane.frustumCulled=false;this.scene.add(plane);
    this.overlay=new THREE.Scene();
    this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#f4b582',transparent:true,opacity:.85}));this.trail.frustumCulled=false;this.overlay.add(this.trail);
    this.prediction=new Line2(new LineGeometry(),new LineMaterial({color:'#87e6dd',linewidth:2.2,dashed:true,dashSize:.4,gapSize:.2,transparent:true,opacity:.95,depthWrite:false}));this.prediction.frustumCulled=false;this.overlay.add(this.prediction);
    const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!;
    ctx.strokeStyle='#ffb781';ctx.lineWidth=3;ctx.beginPath();ctx.arc(32,32,22,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff4d9';ctx.beginPath();ctx.arc(32,32,7,0,Math.PI*2);ctx.fill();
    this.marker=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false,depthWrite:false}));this.marker.scale.set(1.05,1.05,1);this.overlay.add(this.marker);
    this.position=new THREE.Vector3(0,1,0);this.time=0;
  }
  update(f: FlightSnapshot,trail: number[][]=[]){
    this.destroyed=f.status==='destroyed';this.time=f.time;this.position.copy(earthFixed(f.position,f.time)).divideScalar(EARTH_RADIUS);
    this.uniforms.sunDirection.value.copy(earthFixed([.3,-.8,.5],f.time)).normalize();
    this.marker.position.copy(this.position).multiplyScalar(10.002);
    const points=trail.map(p=>earthFixed(p,f.time).multiplyScalar(10.002/EARTH_RADIUS));
    if(points.length){points.push(this.position.clone().multiplyScalar(10.002));const old=this.trail.geometry;this.trail.geometry=new THREE.BufferGeometry().setFromPoints(points);old.dispose();}
    this.trail.visible=points.length>1;
    const orbit=['crashed','landed','destroyed'].includes(f.status)?[]:predictOrbit(f.position,f.velocity);
    const predicted=orbit.map(p=>earthFixed(p,f.time).multiplyScalar(10.002/EARTH_RADIUS));
    if(predicted.length>1){const old=this.prediction.geometry;this.prediction.geometry=new LineGeometry().setFromPoints(predicted);old.dispose();this.prediction.computeLineDistances();}
    this.prediction.visible=predicted.length>1;
  }
  dispose(){
    for(const scene of [this.scene,this.overlay])scene.traverse(o=>{
      if(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite){
        if('geometry' in o)o.geometry.dispose();
        for(const m of Array.isArray(o.material)?o.material:[o.material]){if('map' in m && m.map instanceof THREE.Texture)m.map.dispose();m.dispose();}
      }
    });
    this.uniforms.earthMap.value.dispose();this.uniforms.stars.value.dispose();
  }
  render(renderer: THREE.WebGLRenderer,camera: THREE.PerspectiveCamera,globe: boolean,rocketCenter: THREE.Vector3){
    camera.updateMatrixWorld();
    const u=this.uniforms;
    u.observer.value.copy(globe?camera.position.clone().divideScalar(10):this.position.clone().add(camera.position.clone().sub(rocketCenter).divideScalar(EARTH_RADIUS)));
    u.cameraRotation.value.setFromMatrix4(camera.matrixWorld);u.aspect.value=camera.aspect;u.tanFov.value=Math.tan(camera.fov*Math.PI/360);u.globe.value=globe?1:0;
    u.viewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    renderer.render(this.scene,this.camera);
    if(globe){
      const toMarker=this.position.clone().sub(u.observer.value),distance=toMarker.length(),direction=toMarker.normalize();
      const b=u.observer.value.dot(direction),c=u.observer.value.lengthSq()-1,disc=b*b-c,hit=disc>=0?-b-Math.sqrt(disc):-1;
      this.marker.visible=!this.destroyed&&(hit<0||hit>=distance-1e-5);
      renderer.render(this.overlay,camera);
    }
  }
}
