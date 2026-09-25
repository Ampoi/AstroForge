import * as THREE from 'three';
import {EARTH_RADIUS} from './celestial.ts';

// Representative fair-weather layers, not a meteorological simulation. Cloud
// bases vary with latitude/weather; cumulus can develop well above its base.
// https://www.weather.gov/lmk/cloud_classification
export const CLOUD_LAYERS={
  low:{base:900,top:3000,type:'cumulus / stratocumulus'},
  middle:{base:5000,top:5700,type:'altocumulus'},
  high:{base:9500,top:10500,type:'cirrus'},
} as const;
export const CLOUD_BASE=CLOUD_LAYERS.low.base;
export const CLOUD_TOP=CLOUD_LAYERS.high.top;
export const CLOUD_RENDER_BUDGET={scale:.35,maxPixels:160000,volumeSamples:4} as const;

export function cloudRenderSize(width: number,height: number){
  const scale=Math.min(CLOUD_RENDER_BUDGET.scale,Math.sqrt(CLOUD_RENDER_BUDGET.maxPixels/Math.max(1,width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}

// Bake three noise octaves and their surface normals once. The shader needs
// one filtered lookup for shape + shading instead of sampling noise octaves
// again for every step along both the view ray and the light ray.
export function cloudNoise(){
  const size=64,latticeSize=16,lattice=new Float32Array(latticeSize**3);let seed=92731;
  for(let i=0;i<lattice.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;lattice[i]=(seed>>>0)/4294967296;}
  const index=(x: number,y: number,z: number,n: number)=>((z+n)%n*n+(y+n)%n)*n+(x+n)%n;
  const smooth=(v: number)=>v*v*(3-2*v);
  const noise=(x: number,y: number,z: number)=>{
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz);
    let value=0;
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)value+=lattice[index(ix+i,iy+j,iz+k,latticeSize)]*(i?fx:1-fx)*(j?fy:1-fy)*(k?fz:1-fz);
    return value;
  };
  const field=new Float32Array(size**3),data=new Uint8Array(size**3*4);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)field[index(x,y,z,size)]=noise(x/4,y/4,z/4)*.6+noise(x/2,y/2,z/2)*.28+noise(x,y,z)*.12;
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=index(x,y,z,size)*4;
    const dx=field[index(x-1,y,z,size)]-field[index(x+1,y,z,size)],dy=field[index(x,y-1,z,size)]-field[index(x,y+1,z,size)],dz=field[index(x,y,z-1,size)]-field[index(x,y,z+1,size)];
    const length=Math.hypot(dx,dy,dz)||1;
    data[i]=Math.round(field[i/4]*255);data[i+1]=Math.round((dx/length*.5+.5)*255);data[i+2]=Math.round((dy/length*.5+.5)*255);data[i+3]=Math.round((dz/length*.5+.5)*255);
  }
  const map=new THREE.Data3DTexture(data,size,size,size);
  map.format=THREE.RGBAFormat;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;
  map.wrapS=map.wrapT=map.wrapR=THREE.RepeatWrapping;map.unpackAlignment=1;map.needsUpdate=true;
  return map;
}
const radius=(height: number)=>(1+height/EARTH_RADIUS).toFixed(10);
export const cloudShader=`
uniform highp sampler3D cloudNoise;
const float LOW_BASE=${radius(CLOUD_LAYERS.low.base)};
const float LOW_TOP=${radius(CLOUD_LAYERS.low.top)};
const float MIDDLE_RADIUS=${radius((CLOUD_LAYERS.middle.base+CLOUD_LAYERS.middle.top)/2)};
const float HIGH_RADIUS=${radius((CLOUD_LAYERS.high.base+CLOUD_LAYERS.high.top)/2)};
vec4 cloudField(vec3 p,float footprint){return textureLod(cloudNoise,p/64.,max(0.,log2(max(1.,footprint))));}
float weather(vec3 p,float footprint){return cloudField(normalize(p)*80.+vec3(6.,1.,9.),footprint*80.).r;}
vec3 cloudColor(vec3 p,float shade){
  float elevation=dot(normalize(p),sunDirection),day=smoothstep(-.035,.055,elevation);
  vec3 sunlight=mix(vec3(1.,.48,.24),vec3(1.,.96,.87),smoothstep(0.,.3,elevation));
  return vec3(.004,.007,.014)+day*(vec3(.15,.21,.30)+sunlight*shade);
}
float lowDensity(float weatherValue,float shape,float height){
  // Flat condensation base, rounded tops, eroded gaps between cloud cells.
  float body=smoothstep(.46,.67,weatherValue*.48+shape*.52);
  float profile=smoothstep(0.,.10,height)*(1.-smoothstep(.45,1.,height));
  return max(0.,body*profile-.06)*1.6;
}
vec4 lowClouds(vec3 origin,vec3 direction,float start,float end,out float distance){
  distance=(start+end)*.5;
  if(end<=start)return vec4(0.,0.,0.,1.);
  float ds=(end-start)/float(${CLOUD_RENDER_BUDGET.volumeSamples}),transmission=1.;vec3 radiance=vec3(0.);
  for(int i=0;i<${CLOUD_RENDER_BUDGET.volumeSamples};i++){
    float t=start+(float(i)+.5)*ds;vec3 p=origin+direction*t;
    float footprint=max(ds*.4,t*pixelAngle);
    vec4 shape=cloudField(p*12000.,footprint*12000.);
    float h=clamp((length(p)-LOW_BASE)/(LOW_TOP-LOW_BASE),0.,1.);
    float density=lowDensity(weather(p,footprint),shape.r,h);
    float alpha=1.-exp(-density*ds*4200.);
    // Baked normal and cloud depth approximate self-shadowing without a
    // secondary light march. Sun position still drives the lit side.
    float facing=clamp(dot(shape.gba*2.-1.,sunDirection)*.5+.5,0.,1.);
    float shade=(.4+.65*facing)*exp(-density*(1.-h)*1.8);
    radiance+=transmission*alpha*cloudColor(p,shade);transmission*=1.-alpha;
  }
  return vec4(radiance,transmission);
}
vec4 cloudSheet(vec3 origin,vec3 direction,float t,float groundHit,bool high){
  if(t<=0.||(groundHit>0.&&t>=groundHit))return vec4(0.,0.,0.,1.);
  vec3 p=origin+direction*t;float footprint=t*pixelAngle;
  float coverage=weather(p+(high?vec3(.1,0.,.05):vec3(.1,.03,0.)),footprint);
  // Mid-level small patches vs high, optically thin, elongated ice streaks.
  vec3 frequency=high?vec3(2500.,6500.,65000.):vec3(22000.);
  vec3 q=p*frequency;if(high)q.z+=sin(p.x*1700.+p.y*800.)*10.;
  float shape=cloudField(q,footprint*(high?65000.:22000.)).r;
  float density=high?smoothstep(.47,.68,shape)*smoothstep(.44,.66,coverage):smoothstep(.45,.67,shape*.6+coverage*.4);
  float slant=1./max(.18,abs(dot(normalize(p),direction)));
  float alpha=1.-exp(-density*slant*(high?.16:.9));
  return vec4(cloudColor(p,high?.85:.65)*alpha,1.-alpha);
}
float cloudShadow(vec3 p,float footprint){
  // A single broad weather lookup replaces four additional light-ray samples.
  return 1.-smoothstep(.46,.68,weather(p,footprint))*.3;
}
vec4 traceClouds(vec3 origin,vec3 direction,float groundHit,out float cloudDistance){
  vec2 outer=sphere(origin,direction,LOW_TOP),inner=sphere(origin,direction,LOW_BASE);
  float start=max(0.,outer.x),end=outer.y;
  if(groundHit>0.)end=min(end,groundHit);
  float firstEnd=end,secondStart=end;
  if(inner.y>start&&inner.x<end){firstEnd=clamp(inner.x,start,end);secondStart=clamp(inner.y,start,end);}
  vec4 layers[6];float distances[6];
  layers[0]=lowClouds(origin,direction,start,firstEnd,distances[0]);
  layers[1]=lowClouds(origin,direction,secondStart,end,distances[1]);
  vec2 middle=sphere(origin,direction,MIDDLE_RADIUS),high=sphere(origin,direction,HIGH_RADIUS);
  distances[2]=middle.x;distances[3]=middle.y;distances[4]=high.x;distances[5]=high.y;
  layers[2]=cloudSheet(origin,direction,middle.x,groundHit,false);layers[3]=cloudSheet(origin,direction,middle.y,groundHit,false);
  layers[4]=cloudSheet(origin,direction,high.x,groundHit,true);layers[5]=cloudSheet(origin,direction,high.y,groundHit,true);
  // Only six entries, sorted without further noise/lighting work. Both sides
  // of a shell remain ordered correctly at the planet's limb and in ascent.
  vec3 radiance=vec3(0.);float transmission=1.,weighted=0.,weight=0.;
  for(int i=0;i<6;i++){
    int nearest=0;for(int j=1;j<6;j++)if(distances[j]<distances[nearest])nearest=j;
    vec4 layer=layers[nearest];float contribution=transmission*(1.-layer.a);
    radiance+=transmission*layer.rgb;weighted+=max(0.,distances[nearest])*contribution;weight+=contribution;transmission*=layer.a;
    distances[nearest]=1e10;
  }
  cloudDistance=weight>0.?weighted/weight:1e10;
  return vec4(radiance,transmission);
}
`;
