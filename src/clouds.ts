import * as THREE from 'three';

export const CLOUD_BASE=1800;
export const CLOUD_TOP=5600;

// Repeatable, filtered volume noise; one small texture replaces hundreds of
// procedural hash operations per ray step. No downloaded textures are required.
export function cloudNoise(){
  const size=64,data=new Uint8Array(size*size*size);let seed=92731;
  for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=seed>>>24;}
  const map=new THREE.Data3DTexture(data,size,size,size);
  map.format=THREE.RedFormat;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;
  map.wrapS=map.wrapT=map.wrapR=THREE.RepeatWrapping;map.unpackAlignment=1;map.needsUpdate=true;
  return map;
}

export const cloudShader=`
uniform highp sampler3D cloudNoise;
const float CLOUD_BASE=1.+${CLOUD_BASE.toFixed(1)}/6371000.;
const float CLOUD_TOP=1.+${CLOUD_TOP.toFixed(1)}/6371000.;
float volumeNoise(vec3 p,float footprint){return textureLod(cloudNoise,p/64.,max(0.,log2(max(1.,footprint)))).r;}
float cloudDensity(vec3 p,float footprint){
  float h=(length(p)-CLOUD_BASE)/(CLOUD_TOP-CLOUD_BASE);
  if(h<=0.||h>=1.)return 0.;
  vec3 weatherPoint=normalize(p)*18.+vec3(6.,1.,9.);
  weatherPoint+=vec3(sin(p.z*27.),cos(p.x*21.),sin(p.y*24.))*.9;
  float weather=volumeNoise(weatherPoint,footprint*24.)*.65+volumeNoise(weatherPoint*2.03,footprint*48.)*.25+volumeNoise(weatherPoint*4.11,footprint*96.)*.10;
  float shape=volumeNoise(p*3400.,footprint*3400.);
  float detail=volumeNoise(p*7500.,footprint*7500.)*.65+volumeNoise(p*19000.,footprint*19000.)*.35;
  float body=smoothstep(.48,.67,weather*.55+shape*.30+detail*.15);
  float profile=smoothstep(0.,.13,h)*(1.-smoothstep(.40,1.,h));
  return max(0.,body*profile-(1.-detail)*.18)*1.8;
}
float cloudSunlight(vec3 p,float footprint){
  float optical=0.;
  const float stepSize=850./6371000.;
  for(int j=0;j<4;j++)optical+=cloudDensity(p+sunDirection*(float(j)+.5)*stepSize,max(footprint,stepSize*.3))*stepSize*5500.;
  return exp(-optical);
}
// Integrate the two shell intervals without spending samples in empty space
// below the cloud base. This works below, inside and above the cloud layer.
vec4 traceClouds(vec3 origin,vec3 direction,float groundHit,out float cloudDistance){
  vec2 outer=sphere(origin,direction,CLOUD_TOP),inner=sphere(origin,direction,CLOUD_BASE);
  float start=max(0.,outer.x),end=outer.y;
  if(groundHit>0.)end=min(end,groundHit);
  cloudDistance=end;
  if(end<=start)return vec4(0.,0.,0.,1.);
  float firstEnd=end,secondStart=end;
  if(inner.y>start&&inner.x<end){firstEnd=clamp(inner.x,start,end);secondStart=clamp(inner.y,start,end);}
  float firstLength=firstEnd-start,total=firstLength+end-secondStart;
  if(total<=0.)return vec4(0.,0.,0.,1.);
  float steps=globe>.5?12.:32.;
  float ds=total/steps,transmission=1.;vec3 radiance=vec3(0.);
  float forward=pow(max(0.,dot(direction,sunDirection)),12.);
  float weightedDistance=0.,weight=0.;
  float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  for(int i=0;i<32;i++){
    if(float(i)>=steps)break;
    float along=(float(i)+jitter)*ds;
    float t=along<firstLength?start+along:secondStart+along-firstLength;
    vec3 p=origin+direction*t;
    float footprint=max(ds*.6,t*pixelAngle);
    float density=cloudDensity(p,footprint);
    if(density>.005){
      float alpha=1.-exp(-density*ds*3600.);
      float day=smoothstep(-.035,.055,dot(normalize(p),sunDirection));
      float light=day>0.?cloudSunlight(p,footprint):0.;
      float height=clamp((length(p)-CLOUD_BASE)/(CLOUD_TOP-CLOUD_BASE),0.,1.);
      vec3 ambient=mix(vec3(.09,.13,.20),vec3(.35,.43,.55),height);
      vec3 sunlight=mix(vec3(1.,.47,.20),vec3(1.,.96,.86),smoothstep(0.,.30,dot(normalize(p),sunDirection)));
      vec3 source=vec3(.004,.007,.014)+day*(ambient+sunlight*(light*1.35+forward*light*.8));
      float contribution=transmission*alpha;
      radiance+=contribution*source;
      weightedDistance+=t*contribution;weight+=contribution;
      transmission*=1.-alpha;
      if(transmission<.015)break;
    }
  }
  cloudDistance=weight>0.?weightedDistance/weight:end;
  return vec4(radiance,transmission);
}
`;
