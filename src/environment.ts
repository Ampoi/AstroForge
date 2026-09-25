import type {FlightSnapshot} from '../server/types.ts';
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {predictOrbit} from '../shared/orbit.ts';

import {EARTH_RADIUS,earthFixed,SunBody} from './celestial.ts';
import {cloudNoise,cloudShader,cloudRenderSize} from './clouds.ts';
import {weatherTexture} from './weather.ts';
export {EARTH_RADIUS,earthFixed} from './celestial.ts';

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
uniform vec3 sunPosition;
uniform float sunRadius;
uniform mat3 cameraRotation;
uniform mat4 viewProjection;
uniform float pixelAngle;
uniform float aspect;
uniform float tanFov;
uniform float globe;
varying vec2 vUv;
const float PI=3.14159265359;
const float ATM=1.01256;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d);float c=dot(o,o)-r*r;float h=b*b-c;if(h<0.)return vec2(-1.);h=sqrt(h);return vec2(-b-h,-b+h);}
vec2 uv(vec3 n){return vec2(atan(n.x,n.y)/(2.*PI)+.5,asin(clamp(-n.z,-1.,1.))/PI+.5);}
${cloudShader}
void main(){
  vec2 screen=vUv*2.-1.;
  vec3 d=normalize(cameraRotation*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
  vec2 ground=sphere(observer,d,1.);
  float hit=ground.x>0.?ground.x:-1.;
  float skyDay=smoothstep(-.10,.15,dot(normalize(observer),sunDirection));
  float starVisibility=1.-skyDay*exp(-max(0.,length(observer)-1.)/.008);
  vec3 color=texture2D(stars,uv(d)).rgb*.85*starVisibility;
  vec3 toSun=sunPosition-observer;
  vec3 solarBearing=normalize(toSun);
  float sunDot=dot(d,solarBearing);
  // Finite solar sphere, evaluated angularly to avoid subtracting AU-scale
  // squared distances in float32. Its apparent diameter is about 0.53 degrees.
  float angularRadius=asin(sunRadius/length(toSun));
  float angle=atan(length(cross(d,solarBearing)),sunDot);
  float edge=max(fwidth(angle),.000015);
  float disc=1.-smoothstep(angularRadius-edge,angularRadius+edge,angle);
  float limb=sqrt(max(0.,1.-pow(angle/angularRadius,2.)));
  color+=vec3(1.,.89,.69)*(disc*(9.+7.*limb)+.24*exp(-angle*angle/.00022)+.035*exp(-angle*18.));
  gl_FragDepth=1.;
  if(hit>0.){
    vec3 n=normalize(observer+d*hit);
    // Measure the footprint on the sphere, not across the UV date-line seam.
    // Bound the polar stretch so longitude's singularity cannot blur the whole
    // latitude range into alternating radial streaks at the ice cap.
    float surfaceFootprint=max(length(dFdx(n)),length(dFdy(n)))*1024./(PI*max(.15,length(n.xy)));
    vec3 surface=textureLod(earthMap,uv(n),max(0.,log2(max(1.,surfaceFootprint)))).rgb;
    float light=dot(n,sunDirection);
    float day=smoothstep(-.08,.12,light);
    float shadow=light>0.?cloudShadow(n,hit*pixelAngle):1.;
    float ocean=1.-smoothstep(.01,.12,surface.r-surface.b+.12);
    float shine=pow(max(dot(reflect(-sunDirection,n),-d),0.),70.)*ocean*.15*shadow;
    color=surface*(.012+max(0.,light)*1.05*shadow)+shine*vec3(1.,.85,.61)*day;
    if(globe>.5){vec4 clip=viewProjection*vec4(n*10.,1.);gl_FragDepth=clip.z/clip.w*.5+.5;}
  }
  float cloudDistance;
  vec4 cloud=traceClouds(observer,d,hit,cloudDistance);
  color=color*cloud.a+cloud.rgb;
  // Six samples of exponential atmospheric density. Visual scattering approximation.
  vec2 air=sphere(observer,d,ATM);
  if(air.y>0.){
    float start=max(0.,air.x),end=hit>0.?min(hit,air.y):air.y;
    // Apply only the air in front of opaque clouds, so nearby white tops and
    // dark bases are not washed out by the entire atmospheric column.
    end=mix(min(end,max(start,cloudDistance)),end,cloud.a);
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

function makeUniforms(map: THREE.Texture,weather: THREE.Texture){return {cloudWeather:{value:weather},earthMap:{value:map},stars:{value:starTexture()},cloudNoise:{value:cloudNoise()},sunPosition:{value:new THREE.Vector3()},sunRadius:{value:0},observer:{value:new THREE.Vector3(0,1.001,0)},sunDirection:{value:new THREE.Vector3(-.8,.3,-.5).normalize()},cameraRotation:{value:new THREE.Matrix3()},viewProjection:{value:new THREE.Matrix4()},pixelAngle:{value:.001},aspect:{value:1},tanFov:{value:Math.tan(17*Math.PI/180)},globe:{value:0}};}

export class EarthEnvironment{
  readonly sun=new SunBody();
  private readonly weather=weatherTexture();
  private readonly background=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
  private readonly composite=new THREE.Scene();
  private readonly renderSize=new THREE.Vector2();
  private readonly skyTexel=new THREE.Vector2(1,1);
  scene: THREE.Scene; camera: THREE.OrthographicCamera; ready: Promise<void>;
  uniforms: ReturnType<typeof makeUniforms>; overlay: THREE.Scene;
  trail: THREE.Line<THREE.BufferGeometry,THREE.LineBasicMaterial>; prediction: Line2;
  marker: THREE.Sprite; position: THREE.Vector3; time=0; destroyed=false;

  constructor(){
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const {map,ready}=earthTexture();this.ready=Promise.all([ready,this.weather.ready]).then(()=>{});
    this.uniforms=makeUniforms(map,this.weather.map);
    this.uniforms.sunPosition.value=this.sun.position;this.uniforms.sunRadius.value=this.sun.radius;
    const material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);plane.frustumCulled=false;this.scene.add(plane);
    const copy=new THREE.ShaderMaterial({
      uniforms:{background:{value:this.background.texture},texel:{value:this.skyTexel},
        observer:this.uniforms.observer,cameraRotation:this.uniforms.cameraRotation,aspect:this.uniforms.aspect,
        tanFov:this.uniforms.tanFov,viewProjection:this.uniforms.viewProjection,globe:this.uniforms.globe},
      depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D background; uniform vec2 texel; varying vec2 vUv;
        uniform vec3 observer; uniform mat3 cameraRotation; uniform mat4 viewProjection;
        uniform float aspect; uniform float tanFov; uniform float globe;
        void main(){
          // Reconstruct planet depth at display resolution so orbit tracks are
          // occluded correctly even though cloud colour uses a bounded buffer.
          gl_FragDepth=1.;
          if(globe>.5){
            vec2 screen=vUv*2.-1.;
            vec3 d=normalize(cameraRotation*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
            float b=dot(observer,d),h=b*b-dot(observer,observer)+1.;
            if(h>=0.){
              float t=-b-sqrt(h);
              if(t>0.){vec4 clip=viewProjection*vec4(normalize(observer+d*t)*10.,1.);gl_FragDepth=clip.z/clip.w*.5+.5;}
            }
          }
          gl_FragColor=texture2D(background,vUv);
          if(globe<.5){
            gl_FragColor*=.5;
            gl_FragColor+=(texture2D(background,vUv+vec2(texel.x,0.))+texture2D(background,vUv-vec2(texel.x,0.))
              +texture2D(background,vUv+vec2(0.,texel.y))+texture2D(background,vUv-vec2(0.,texel.y)))*.125;
          }
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.composite.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),copy));
    this.overlay=new THREE.Scene();
    this.trail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#f4b582',transparent:true,opacity:.85}));this.trail.frustumCulled=false;this.overlay.add(this.trail);
    this.prediction=new Line2(new LineGeometry(),new LineMaterial({color:'#87e6dd',linewidth:2.2,dashed:true,dashSize:.4,gapSize:.2,transparent:true,opacity:.95,depthWrite:false}));this.prediction.frustumCulled=false;this.overlay.add(this.prediction);
    const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!;
    ctx.strokeStyle='#ffb781';ctx.lineWidth=3;ctx.beginPath();ctx.arc(32,32,22,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff4d9';ctx.beginPath();ctx.arc(32,32,7,0,Math.PI*2);ctx.fill();
    this.marker=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false,depthWrite:false}));this.marker.scale.set(1.05,1.05,1);this.overlay.add(this.marker);
    this.position=new THREE.Vector3(0,1,0);this.time=0;
  }
  updatePose(f: FlightSnapshot){
    this.destroyed=f.status==='destroyed';this.time=f.time;this.position.copy(earthFixed(f.position,f.time)).divideScalar(EARTH_RADIUS);
    this.sun.update(f.time);this.uniforms.sunDirection.value.copy(this.sun.position).normalize();
    this.marker.position.copy(this.position).multiplyScalar(10.002);
  }
  update(f: FlightSnapshot,trail: number[][]=[]){
    this.updatePose(f);
    const points=trail.map(p=>earthFixed(p,f.time).multiplyScalar(10.002/EARTH_RADIUS));
    if(points.length){points.push(this.position.clone().multiplyScalar(10.002));const old=this.trail.geometry;this.trail.geometry=new THREE.BufferGeometry().setFromPoints(points);old.dispose();}
    this.trail.visible=points.length>1;
    const orbit=['crashed','landed','destroyed'].includes(f.status)?[]:predictOrbit(f.position,f.velocity);
    const predicted=orbit.map(p=>earthFixed(p,f.time).multiplyScalar(10.002/EARTH_RADIUS));
    if(predicted.length>1){const old=this.prediction.geometry;this.prediction.geometry=new LineGeometry().setFromPoints(predicted);old.dispose();this.prediction.computeLineDistances();}
    this.prediction.visible=predicted.length>1;
  }
  dispose(){
    for(const scene of [this.scene,this.overlay,this.composite])scene.traverse(o=>{
      if(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite){
        if('geometry' in o)o.geometry.dispose();
        for(const m of Array.isArray(o.material)?o.material:[o.material]){if('map' in m && m.map instanceof THREE.Texture)m.map.dispose();m.dispose();}
      }
    });
    this.background.dispose();this.weather.dispose();
    this.uniforms.earthMap.value.dispose();this.uniforms.stars.value.dispose();this.uniforms.cloudNoise.value.dispose();
  }
  render(renderer: THREE.WebGLRenderer,camera: THREE.PerspectiveCamera,globe: boolean,rocketCenter: THREE.Vector3){
    camera.updateMatrixWorld();
    const u=this.uniforms;
    u.observer.value.copy(globe?camera.position.clone().divideScalar(10):this.position.clone().add(camera.position.clone().sub(rocketCenter).divideScalar(EARTH_RADIUS)));
    u.cameraRotation.value.setFromMatrix4(camera.matrixWorld);u.aspect.value=camera.aspect;u.tanFov.value=Math.tan(camera.fov*Math.PI/360);u.globe.value=globe?1:0;
    u.viewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    renderer.getDrawingBufferSize(this.renderSize);u.pixelAngle.value=2*u.tanFov.value/this.renderSize.y;
    // Both flight and globe views have the same bounded atmosphere cost.
    // Composite reconstructs exact globe depth; vehicle geometry stays sharp.
    const size=cloudRenderSize(this.renderSize.x,this.renderSize.y);
    this.background.setSize(size.width,size.height);
    this.skyTexel.set(1/this.background.width,1/this.background.height);
    u.pixelAngle.value=2*u.tanFov.value/size.height;
    const target=renderer.getRenderTarget();renderer.setRenderTarget(this.background);
    renderer.render(this.scene,this.camera);renderer.setRenderTarget(target);
    renderer.render(this.composite,this.camera);
    if(globe){
      const toMarker=this.position.clone().sub(u.observer.value),distance=toMarker.length(),direction=toMarker.normalize();
      const b=u.observer.value.dot(direction),c=u.observer.value.lengthSq()-1,disc=b*b-c,hit=disc>=0?-b-Math.sqrt(disc):-1;
      this.marker.visible=!this.destroyed&&(hit<0||hit>=distance-1e-5);
      renderer.render(this.overlay,camera);
    }
  }
}
