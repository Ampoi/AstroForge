import type {FlightSnapshot} from '../server/types.ts';
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {predictOrbit} from '../shared/orbit.ts';

import {EARTH_RADIUS,EARTH_SPIN,earthFixed,SunBody} from './celestial.ts';
import {cloudNoise,cloudShader,cloudRenderSize} from './clouds.ts';
import {weatherTexture} from './weather.ts';
import {planetTexture} from './terrain.ts';
import {makeStarField} from './stars.ts';
export {EARTH_RADIUS,earthFixed} from './celestial.ts';

const fragmentShader=`
precision highp float;
uniform sampler2D earthMap;
uniform vec3 observer;
uniform vec3 sunDirection;
uniform vec3 sunPosition;
uniform float sunRadius;
uniform mat3 cameraRotation;
uniform mat4 viewProjection;
uniform vec3 flightCameraPosition;
uniform float pixelAngle;
uniform float aspect;
uniform float tanFov;
uniform float globe;
varying vec2 vUv;
const float PI=3.14159265359;
const float ATM=1.01256;
// The closest approach avoids subtracting AU-scale squared distances when the
// solar map focuses the Sun or Moon. The ray direction is always normalized.
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d);vec3 closest=cross(o,d);float h=r*r-dot(closest,closest);if(h<0.)return vec2(-1.);h=sqrt(h);return vec2(-b-h,-b+h);}
vec2 uv(vec3 n){return vec2(atan(n.x,n.y)/(2.*PI)+.5,asin(clamp(-n.z,-1.,1.))/PI+.5);}
${cloudShader}
void main(){
  vec2 screen=vUv*2.-1.;
  vec3 d=normalize(cameraRotation*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
  vec2 ground=sphere(observer,d,1.);
  float hit=ground.x>0.?ground.x:-1.;
  float skyDay=smoothstep(-.10,.15,dot(normalize(observer),sunDirection));
  float starVisibility=1.-skyDay*exp(-max(0.,length(observer)-1.)/.008);
  // Carry sky transmission in alpha; composite the stars at display resolution.
  float starTransmission=hit>0.?0.:starVisibility;
  vec3 color=vec3(0.);
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
    vec2 mapSize=vec2(textureSize(earthMap,0));
    float surfaceFootprint=max(length(dFdx(n)),length(dFdy(n)))*mapSize.y/(PI*max(.15,length(n.xy)));
    vec3 surface=textureLod(earthMap,uv(n),max(0.,log2(max(1.,surfaceFootprint)))).rgb;
    // Height-derived relief from the same seeded elevation field as collisions.
    vec2 texel=1./mapSize,coord=uv(n);
    float east=(textureLod(earthMap,coord+vec2(texel.x,0.),0.).a-textureLod(earthMap,coord-vec2(texel.x,0.),0.).a)*8000.;
    float north=(textureLod(earthMap,coord+vec2(0.,texel.y),0.).a-textureLod(earthMap,coord-vec2(0.,texel.y),0.).a)*8000.;
    vec3 e=vec3(n.y,-n.x,0.)/max(.000001,length(n.xy)),pole=cross(n,e);
    vec3 normal=normalize(n-e*east/(2.*6371000.*2.*PI*texel.x*max(.05,length(n.xy)))-pole*north/(2.*6371000.*PI*texel.y));
    float light=dot(normal,sunDirection);
    float day=smoothstep(-.08,.12,light);
    float shadow=light>0.?cloudShadow(n,hit*pixelAngle):1.;
    float ocean=1.-smoothstep(.01,.12,surface.r-surface.b+.12);
    float shine=pow(max(dot(reflect(-sunDirection,n),-d),0.),70.)*ocean*.15*shadow;
    color=surface*(.045+max(0.,light)*1.05*shadow)+shine*vec3(1.,.85,.61)*day;
    if(globe>.5){vec4 clip=viewProjection*vec4(n*10.,1.);gl_FragDepth=clip.z/clip.w*.5+.5;}
  }
  float cloudDistance;
  vec4 cloud=traceClouds(observer,d,hit,cloudDistance);
  color=color*cloud.a+cloud.rgb;
  starTransmission*=cloud.a;
  // Resolve substantial cloud cover before local terrain is drawn. Nearby
  // vehicles and hills still pass the depth test; thin wisps retain terrain detail.
  if(globe<.5&&cloud.a<.8){
    vec4 clip=viewProjection*vec4(flightCameraPosition+d*cloudDistance*6371000.,1.);
    gl_FragDepth=clamp(clip.z/clip.w*.5+.5,0.,1.);
  }
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
    starTransmission*=exp(-optical.y);
  }
  gl_FragColor=vec4(color,starTransmission);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeUniforms(map: THREE.Texture,weather: THREE.Texture){return {cloudWeather:{value:weather},earthMap:{value:map},cloudNoise:{value:cloudNoise()},sunPosition:{value:new THREE.Vector3()},sunRadius:{value:0},observer:{value:new THREE.Vector3(0,1.001,0)},sunDirection:{value:new THREE.Vector3(-.8,.3,-.5).normalize()},cameraRotation:{value:new THREE.Matrix3()},viewProjection:{value:new THREE.Matrix4()},pixelAngle:{value:.001},aspect:{value:1},tanFov:{value:Math.tan(17*Math.PI/180)},globe:{value:0}};}

export class EarthEnvironment{
  readonly sun=new SunBody();
  private readonly weather=weatherTexture();
  private readonly planet=planetTexture();
  private readonly background=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthTexture:new THREE.DepthTexture(1,1)});
  private readonly flightCameraPosition={value:new THREE.Vector3()};
  private readonly composite=new THREE.Scene();
  private readonly starScene=new THREE.Scene();
  private readonly stars:ReturnType<typeof makeStarField>;
  private readonly renderSize=new THREE.Vector2();
  private readonly skyTexel=new THREE.Vector2(1,1);
  private readonly mapCamera=new THREE.PerspectiveCamera();
  scene: THREE.Scene; camera: THREE.OrthographicCamera; ready: Promise<void>;
  uniforms: ReturnType<typeof makeUniforms>; overlay: THREE.Scene;
  trail: THREE.Line<THREE.BufferGeometry,THREE.LineBasicMaterial>; prediction: Line2;
  marker: THREE.Sprite; position: THREE.Vector3; time=0; destroyed=false;

  constructor(){
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const {map,ready}=this.planet;this.ready=Promise.all([ready,this.weather.ready]).then(()=>{});
    this.uniforms=makeUniforms(map,this.weather.map);
    this.stars=makeStarField(this.background.texture,this.uniforms.cameraRotation,this.uniforms.aspect,this.uniforms.tanFov);
    this.starScene.add(this.stars);
    this.uniforms.sunPosition.value=this.sun.position;this.uniforms.sunRadius.value=this.sun.radius;
    const material=new THREE.ShaderMaterial({uniforms:{...this.uniforms,flightCameraPosition:this.flightCameraPosition},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);plane.frustumCulled=false;this.scene.add(plane);
    const copy=new THREE.ShaderMaterial({
      uniforms:{background:{value:this.background.texture},backgroundDepth:{value:this.background.depthTexture},texel:{value:this.skyTexel},
        observer:this.uniforms.observer,cameraRotation:this.uniforms.cameraRotation,aspect:this.uniforms.aspect,
        tanFov:this.uniforms.tanFov,viewProjection:this.uniforms.viewProjection,globe:this.uniforms.globe},
      depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D background; uniform highp sampler2D backgroundDepth; uniform vec2 texel; varying vec2 vUv;
        uniform vec3 observer; uniform mat3 cameraRotation; uniform mat4 viewProjection;
        uniform float aspect; uniform float tanFov; uniform float globe;
        void main(){
          vec2 screen=vUv*2.-1.;
          vec3 d=normalize(cameraRotation*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
          // Reconstruct planet depth at display resolution so orbit tracks are
          // occluded correctly even though cloud colour uses a bounded buffer.
          gl_FragDepth=1.;
          if(globe<.5){
            // Manual bilinear depth avoids nearest-neighbour block edges and
            // keeps integer depth textures compatible with WebGL implementations
            // that cannot linearly filter this format. Keep full depth precision.
            vec2 grid=vUv/texel-.5,f=fract(grid);ivec2 cell=ivec2(floor(grid));
            ivec2 hi=textureSize(backgroundDepth,0)-ivec2(1);
            float a=texelFetch(backgroundDepth,clamp(cell,ivec2(0),hi),0).r;
            float b=texelFetch(backgroundDepth,clamp(cell+ivec2(1,0),ivec2(0),hi),0).r;
            float c=texelFetch(backgroundDepth,clamp(cell+ivec2(0,1),ivec2(0),hi),0).r;
            float e=texelFetch(backgroundDepth,clamp(cell+ivec2(1),ivec2(0),hi),0).r;
            gl_FragDepth=mix(mix(a,b,f.x),mix(c,e,f.x),f.y);
          }
          if(globe>.5){
            vec3 closest=cross(observer,d);
            float b=dot(observer,d),h=1.-dot(closest,closest);
            if(h>=0.){
              float t=-b-sqrt(h);
              if(t>0.){vec4 clip=viewProjection*vec4(normalize(observer+d*t)*10.,1.);gl_FragDepth=clip.z/clip.w*.5+.5;}
            }
          }
          vec3 center=texture2D(background,vUv).rgb;
          vec3 a=texture2D(background,vUv+vec2(texel.x,0.)).rgb,b=texture2D(background,vUv-vec2(texel.x,0.)).rgb;
          vec3 c=texture2D(background,vUv+vec2(0.,texel.y)).rgb,e=texture2D(background,vUv-vec2(0.,texel.y)).rgb;
          // Bounded sharpening replaces the old blur. Clamp to local extrema
          // to avoid bright halos at cloud silhouettes and the planet limb.
          vec3 lo=min(center,min(min(a,b),min(c,e))),hi=max(center,max(max(a,b),max(c,e)));
          gl_FragColor=vec4(clamp(center+(center-(a+b+c+e)*.25)*.55,lo,hi),1.);
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
    for(const scene of [this.scene,this.overlay,this.composite,this.starScene])scene.traverse(o=>{
      if(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Sprite || o instanceof THREE.Points){
        if('geometry' in o)o.geometry.dispose();
        for(const m of Array.isArray(o.material)?o.material:[o.material]){if('map' in m && m.map instanceof THREE.Texture)m.map.dispose();m.dispose();}
      }
    });
    this.background.dispose();this.weather.dispose();this.planet.dispose();
    this.uniforms.earthMap.value.dispose();this.uniforms.cloudNoise.value.dispose();
  }
  /** The solar map uses inertial axes and a floating origin. Transform only the
   * camera into the rotating Earth frame; the very same weather, shading and
   * bounded render pass then serve both views. Depth is invariant under this
   * rigid transform, so other bodies and orbit tracks can use the result. */
  renderMap(renderer: THREE.WebGLRenderer,camera: THREE.PerspectiveCamera,earthPosition: THREE.Vector3,time: number){
    const local=this.mapCamera,rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),EARTH_SPIN*time);
    local.position.copy(camera.position).sub(earthPosition).applyQuaternion(rotation);
    local.quaternion.copy(rotation).multiply(camera.quaternion);
    local.projectionMatrix.copy(camera.projectionMatrix);local.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    local.fov=camera.fov;local.aspect=camera.aspect;
    this.sun.update(time);this.uniforms.sunDirection.value.copy(this.sun.position).normalize();
    this.render(renderer,local,true,new THREE.Vector3(),false);
  }
  render(renderer: THREE.WebGLRenderer,camera: THREE.PerspectiveCamera,globe: boolean,rocketCenter: THREE.Vector3,showOverlay=true){
    camera.updateMatrixWorld();this.flightCameraPosition.value.copy(camera.position);
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
    this.stars.material.uniforms.resolution.value.copy(this.renderSize);
    this.stars.material.uniforms.pixelRatio.value=Math.min(2,renderer.getPixelRatio());
    renderer.render(this.starScene,this.camera);
    if(globe&&showOverlay){
      const toMarker=this.position.clone().sub(u.observer.value),distance=toMarker.length(),direction=toMarker.normalize();
      const b=u.observer.value.dot(direction),c=u.observer.value.lengthSq()-1,disc=b*b-c,hit=disc>=0?-b-Math.sqrt(disc):-1;
      this.marker.visible=!this.destroyed&&(hit<0||hit>=distance-1e-5);
      renderer.render(this.overlay,camera);
    }
  }
}
