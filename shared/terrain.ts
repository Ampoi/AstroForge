/** Fixed, Earth-sized fictional planet. Coordinates are Earth-fixed: +X is
 * launch zenith, +Y east, +Z north. All elevations are metres above sea level. */
export const PLANET_RADIUS=6371000;
export const PLANET_SPIN=7.292115e-5;
export const TERRAIN_SEED=73129;
export const TERRAIN_STEP=2*Math.PI/262144;
export const TERRAIN_MAX_HEIGHT=8000;
export const SITE_GROUND=-1.12;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function hash(x:number,y:number,z:number){
  let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^TERRAIN_SEED;
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
}
function noise(x:number,y:number,z:number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy),w=smooth(0,1,z-iz);
  const layer=(dz:number)=>mix(mix(hash(ix,iy,iz+dz),hash(ix+1,iy,iz+dz),u),mix(hash(ix,iy+1,iz+dz),hash(ix+1,iy+1,iz+dz),u),v);
  return mix(layer(0),layer(1),w);
}
function fbm(x:number,y:number,z:number,octaves:number){
  let value=0,weight=0,a=1;
  for(let i=0;i<octaves;i++){value+=a*noise(x,y,z);weight+=a;x=x*2.03+17.1;y=y*2.03-9.2;z=z*2.03+3.7;a*=.5;}
  return value/weight;
}
export function terrainDirection(lon:number,lat:number):number[]{const c=Math.cos(lat);return [c*Math.cos(lon),c*Math.sin(lon),Math.sin(lat)];}
export function fixedPosition(position:number[],time:number){const c=Math.cos(PLANET_SPIN*time),s=Math.sin(PLANET_SPIN*time);return [c*position[0]+s*position[1],-s*position[0]+c*position[1],position[2]];}
export function terrainCoordinates(position:number[]){return [Math.atan2(position[1],position[0]),Math.atan2(position[2],Math.hypot(position[0],position[1]))];}
/** Continuous spherical noise avoids a longitude seam and polar singularities. */
export function terrainSample(direction:number[]){
  const [x,y,z]=direction;
  const warp=noise(x*3+8,y*3+1,z*3-3)-.5;
  let continent=fbm(x*2.5+12+warp*.65,y*2.5-4,z*2.5+8,5)-.51;
  // Place the launch complex on a broad low coastal shelf of a generated continent.
  const siteDistance=Math.atan2(Math.hypot(y,z),x)*PLANET_RADIUS;
  continent=Math.max(continent,.095-.6*smooth(100000,700000,siteDistance));
  const land=smooth(0,.004,continent),elevation=smooth(0,.085,continent);
  const ridges=Math.pow(1-Math.abs(2*fbm(x*95+4,y*95,z*95,4)-1),5);
  const mountain=smooth(.06,.2,continent)*smooth(.42,.68,fbm(x*17,y*17+9,z*17,3));
  const hills=fbm(x*1800+7,y*1800,z*1800,3);
  let height=elevation*(110+Math.max(0,continent)*5200+ridges*mountain*4900+hills*420);
  if(siteDistance<16000){
    const flat=(PLANET_RADIUS+SITE_GROUND)/Math.max(.99,x)-PLANET_RADIUS;
    height=mix(flat,height,smooth(1800,16000,siteDistance));
  }
  return {height,land,continent,moisture:fbm(x*7-2,y*7,z*7+21,3),latitude:Math.abs(z)};
}
/** Canonical ~153 m grid and diagonal, shared with the close-up terrain mesh. */
const samples=new Map<string,ReturnType<typeof terrainSample>>();
export function terrainVertexSample(i:number,j:number){
  const period=262144;i=((i%period)+period)%period;j=Math.max(-period/4,Math.min(period/4,j));
  const key=`${i}:${j}`;let sample=samples.get(key);
  if(sample===undefined){sample=terrainSample(terrainDirection(i*TERRAIN_STEP,j*TERRAIN_STEP));if(samples.size>50000)samples.clear();samples.set(key,sample);}
  return sample;
}
export function terrainVertex(i:number,j:number){return terrainVertexSample(i,j).height;}
export function terrainHeight(lon:number,lat:number){
  const x=lon/TERRAIN_STEP,y=lat/TERRAIN_STEP,i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j;
  const a=terrainVertex(i,j),d=terrainVertex(i+1,j+1);
  return u>=v?a+(terrainVertex(i+1,j)-a)*u+(d-terrainVertex(i+1,j))*v:a+(d-terrainVertex(i,j+1))*u+(terrainVertex(i,j+1)-a)*v;
}
/** Solid launch apron/deck surfaces, matching makeLaunchSite (the flame duct is open).
 * Buildings and decorative service equipment are not terrain colliders. */
export function launchDeckHeight(east:number,north:number):number{
  if(Math.abs(east)>46||Math.abs(north)>46)return -Infinity;
  if(Math.abs(north)<=6.5&&Math.abs(east)>=1.5&&Math.abs(east)<=12.5||Math.abs(east)<=1.5&&north>=-6.5&&north<=-2.5)return 0;
  return -.845;
}
export function surfaceHeight(position:number[],time:number){
  const fixed=fixedPosition(position,time),[lon,lat]=terrainCoordinates(fixed),height=terrainHeight(lon,lat);
  if(fixed[0]<=0)return height;
  const r=Math.hypot(...fixed),scale=PLANET_RADIUS/r;
  const deck=launchDeckHeight(fixed[1]*scale,fixed[2]*scale);
  return Number.isFinite(deck)?Math.max(height,(PLANET_RADIUS+deck)/(fixed[0]/r)-PLANET_RADIUS):height;
}
export function surfaceClearance(position:number[],time:number){return Math.hypot(...position)-PLANET_RADIUS-surfaceHeight(position,time);}
export function surfaceNormal(position:number[],time:number){
  const up=position.map(v=>v/Math.hypot(...position));
  const east=[-up[1],up[0],0],length=Math.hypot(...east);
  if(length<1e-8)return up;
  for(let i=0;i<3;i++)east[i]/=length;
  const north=[-up[2]*east[1],up[2]*east[0],up[0]*east[1]-up[1]*east[0]];
  const derivative=(axis:number[])=>{const sample=(sign:number)=>surfaceHeight(position.map((v,i)=>v+axis[i]*sign*2),time);return (sample(1)-sample(-1))/4;};
  const e=derivative(east),n=derivative(north),normal=up.map((v,i)=>v-east[i]*e-north[i]*n),norm=Math.hypot(...normal);
  return normal.map(v=>v/norm);
}
/** sRGB biome albedo; shared by orbit textures, close-up mesh and optical sensors. */
export function terrainColor(sample:ReturnType<typeof terrainSample>):number[]{
  const {height,land,moisture,latitude}=sample;
  const blend=(a:number[],b:number[],t:number)=>a.map((v,i)=>mix(v,b[i],t));
  let color=blend([18,49,76],[34,115,128],smooth(-.025,0,sample.continent));
  let ground=blend([172,145,91],[49,92,60],smooth(.3,.65,moisture));
  ground=blend([192,181,135],ground,smooth(0,.008,sample.continent));
  ground=blend(ground,[112,112,105],smooth(1900,3600,height));
  color=blend(color,ground,land);
  return blend(color,[222,233,231],Math.max(smooth(.88,.97,latitude),smooth(3100,4600,height+latitude*1600)));
}

/** Conservative height-field ray march, in metres. Used by optical/LiDAR sensors. */
export function rayTerrain(origin:number[],direction:number[],time:number,maxDistance=Infinity){
  const outer=PLANET_RADIUS+TERRAIN_MAX_HEIGHT,b=origin.reduce((sum,v,i)=>sum+v*direction[i],0),c=origin.reduce((sum,v)=>sum+v*v,0)-outer*outer,disc=b*b-c;
  if(disc<0)return Infinity;
  const near=-b-Math.sqrt(disc),far=-b+Math.sqrt(disc),end=Math.min(maxDistance,far);
  let distance=Math.max(0,near),previous=distance;
  for(let i=0;i<256&&distance<=end;i++){
    const p=origin.map((v,j)=>v+direction[j]*distance),clearance=surfaceClearance(p,time);
    if(clearance<=.002){
      if(distance===0)return Infinity;
      let low=previous,high=distance;
      for(let j=0;j<20;j++){const mid=(low+high)/2;if(surfaceClearance(origin.map((v,k)=>v+direction[k]*mid),time)>0)low=mid;else high=mid;}
      return (low+high)/2;
    }
    previous=distance;distance+=Math.max(.001,clearance*.65);
  }
  return Infinity;
}
