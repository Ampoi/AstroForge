/** A reproducible synthetic weather snapshot, not a forecast/atmospheric solver.
 * Large-scale moisture, ascent and subsidence gate all three cloud layers.
 * Sources/approximations are documented in docs/rendering.md. */
import {WEATHER_FACE_SIZE} from '../src/weather.ts';
export {WEATHER_FACE_SIZE} from '../src/weather.ts';
const PI=Math.PI,rad=PI/180;
const clamp=(v: number)=>Math.max(0,Math.min(1,v));
const smooth=(a: number,b: number,v: number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const wrap=(a: number)=>Math.atan2(Math.sin(a),Math.cos(a));
const gaussian=(x: number)=>Math.exp(-x*x);
function hash(x: number,y: number,z: number){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,1274126177)^731;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
function noise(x: number,y: number,z: number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=smooth(0,1,x-ix),fy=smooth(0,1,y-iy),fz=smooth(0,1,z-iz);let value=0;
  for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)value+=hash(ix+i,iy+j,iz+k)*(i?fx:1-fx)*(j?fy:1-fy)*(k?fz:1-fz);
  return value;
}
// Inverted cellular noise forms rounded islands; remapping it into the smooth
// field erodes the edges while preserving dense cores (Nubis-inspired).
function billows(x: number,y: number,z: number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let distance=4;
  for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const a=ix+i,b=iy+j,c=iz+k;
    const dx=a+.15+.7*hash(a,b,c)-x,dy=b+.15+.7*hash(a+31,b-19,c+7)-y,dz=c+.15+.7*hash(a-11,b+5,c+43)-z;
    distance=Math.min(distance,dx*dx+dy*dy+dz*dz);
  }
  return clamp(1-Math.sqrt(distance));
}
const erode=(base: number,edge: number)=>clamp((base-edge)/Math.max(.01,1-edge));
// Dimensionless cloud-fraction response, not relative humidity in physical units.
export function cloudFormation(moisture: number,ascent: number,subsidence: number){return smooth(.67,.98,moisture+.38*ascent-.45*subsidence);}

const storms=[[-155,48,.3],[-48,51,1.1],[36,49,-.6],[137,43,.5],[-122,-49,-.5],[-25,-54,.4],[64,-46,-.8],[157,-55,.2]].map(([lon,lat,phase])=>({lon:lon*rad,lat:lat*rad,phase}));
const highs=[[-145,27],[-40,27],[50,30],[155,27],[-100,-28],[-5,-29],[105,-30]].map(([lon,lat])=>({lon:lon*rad,lat:lat*rad}));
const decks=[[-86,-19],[-126,27],[4,-20],[-22,22],[101,-29]].map(([lon,lat])=>({lon:lon*rad,lat:lat*rad}));
function region(lon: number,lat: number,center: {lon:number;lat:number},width: number,height: number){return gaussian(wrap(lon-center.lon)*Math.cos(center.lat)/width)*gaussian((lat-center.lat)/height);}
export function weatherAt(longitude: number,latitude: number,land: number){
  const lon=wrap(longitude),lat=Math.max(-PI/2,Math.min(PI/2,latitude));
  const x=Math.cos(lat)*Math.sin(lon),y=Math.cos(lat)*Math.cos(lon),z=Math.sin(lat);
  // Warp before sampling, so cloud boundaries bend and tear at multiple scales
  // instead of appearing as identical circular stamps or straight latitude bands.
  const wx=x+.16*(noise(x*7+13,y*7,z*7)-.5),wy=y+.16*(noise(x*7,y*7+31,z*7)-.5),wz=z+.16*(noise(x*7,y*7,z*7+47)-.5);
  const broad=noise(wx*4.3+12,wy*4.3-8,wz*4.3+5),meso=noise(wx*22+3,wy*22+11,wz*22-7),fine=noise(wx*67,wy*67,wz*67);
  const detail=noise(wx*149+4,wy*149-6,wz*149+2);
  const cellular=billows(wx*48,wy*48,wz*48);
  const body=erode(.55*meso+.3*fine+.15*detail,(1-cellular)*.28);
  // Meandering, broken tropical convergence; no painted solid latitude rings.
  const itczLatitude=(5+4*Math.sin(lon*2+.4)+2*Math.sin(lon*5))*rad+(meso-.5)*.15;
  const convergence=gaussian((lat-itczLatitude)/(.055+.04*broad))*smooth(.30,.65,broad);
  const subtropical=gaussian((Math.abs(lat)-.46)/.17);
  let frontal=0,shield=0,descending=0,marine=0,frontalBody=body;
  for(const system of storms){
    const dx=wrap(lon-system.lon)*Math.cos(system.lat)+(meso-.5)*.10,dy=lat-system.lat+(fine-.5)*.06,r=Math.hypot(dx,dy);
    if(r>.65)continue;
    const hemisphere=Math.sign(system.lat),angle=Math.atan2(dy,dx);
    // A curved ascending front wrapping into a comma head, rather than rings
    // of opaque cloud around every pressure centre. North/south swirl oppositely.
    const phase=system.phase+hemisphere*(.6+(4.2+system.phase)*r)+(broad-.5)*1.2;
    const across=wrap(angle-phase)*Math.max(.05,r);
    const arm=gaussian(across/(.035+.045*r))*(1-smooth(.25,.50+system.phase*.04,r))*smooth(.02,.07,r);
    const headAngle=system.phase+hemisphere*1.1;
    const head=region(lon,lat,{lon:system.lon+.1*Math.cos(headAngle)/Math.cos(system.lat),lat:system.lat+.1*Math.sin(headAngle)},.13,.10);
    const drySlot=gaussian(r/.045);
    const front=arm*(1-drySlot);
    if(front>frontal){
      frontal=front;
      // Stretched detail follows each curved front, rather than a global axis.
      frontalBody=.65*noise(across*125,r*36,system.phase*7)+.35*noise(across*260,r*95,system.phase*11);
    }
    shield=Math.max(shield,head*(1-drySlot*.8));
  }
  for(const high of highs)descending=Math.max(descending,region(lon,lat,high,.23,.17));
  for(const deck of decks)marine=Math.max(marine,region(lon,lat,deck,.20,.22)*(1-land));
  const moisture=.66+.11*(1-land)+.025*gaussian(lat/.35)+.34*(broad-.5)+.12*(meso-.5);
  const subsidence=subtropical*.20+descending*.85;
  const ascent=convergence*.95+frontal*1.15+shield*.45;
  const formed=cloudFormation(moisture,ascent,subsidence);
  const coverage=clamp(formed+marine*.75);
  const lowBody=body*(1-frontal*.65)+frontalBody*frontal*.65;
  const low=smooth(.53-.36*coverage,.78-.38*coverage,lowBody)*smooth(0,.16,coverage);
  const middle=clamp((frontal*.85+shield*.50+convergence*.20)*formed*smooth(.20,.70,frontalBody));
  const high=clamp((frontal*.45+shield*.75+convergence*.85)*smooth(.18,.68,frontalBody)*(1-clamp(subsidence)*.7));
  return [low,middle,high,clamp(.35+convergence*.65-marine*.5)];
}

export interface LandGeoJSON{features:{geometry:{type:'Polygon';coordinates:number[][][]} | {type:'MultiPolygon';coordinates:number[][][][]}}[]}
/** Scanline rasterization: includes islands/holes and the supplied coastline,
 * rather than hard-coded continent rectangles. Rows run south to north (GL UV). */
export function landMask(land: LandGeoJSON,width=512,height=256){
  const mask=new Uint8Array(width*height);
  for(const feature of land.features){
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const polygon of polygons){
      const latitudes=polygon.flat().map(p=>p[1]);
      const start=Math.max(0,Math.floor((Math.min(...latitudes)+90)/180*height)),end=Math.min(height-1,Math.ceil((Math.max(...latitudes)+90)/180*height));
      for(let row=start;row<=end;row++){
        const latitude=(row+.5)/height*180-90,crossings:number[]=[];
        for(const ring of polygon)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const [x0,y0]=ring[j],[x1,y1]=ring[i];
          if((y0>latitude)!==(y1>latitude))crossings.push(x0+(latitude-y0)/(y1-y0)*(x1-x0));
        }
        crossings.sort((a,b)=>a-b);
        for(let i=0;i+1<crossings.length;i+=2){
          const left=Math.max(0,Math.ceil((crossings[i]+180)/360*width-.5)),right=Math.min(width-1,Math.floor((crossings[i+1]+180)/360*width-.5));
          for(let col=left;col<=right;col++)mask[row*width+col]=1;
        }
      }
    }
  }
  return mask;
}
/** OpenGL cube faces +X,-X,+Y,-Y,+Z,-Z; north is -Z in the renderer. */
export function weatherDirection(face: number,u: number,v: number){
  return [[1,-v,-u],[-1,-v,u],[u,1,v],[u,-1,-v],[u,-v,1],[-u,-v,-1]][face];
}
export function buildWeatherMap(land: LandGeoJSON,size=WEATHER_FACE_SIZE){
  const mask=landMask(land),data=new Uint8Array(size*size*6*4);
  for(let face=0;face<6;face++)for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const [x,y,z]=weatherDirection(face,(col+.5)/size*2-1,(row+.5)/size*2-1);
    const lon=Math.atan2(x,y),lat=Math.asin(-z/Math.hypot(x,y,z));
    const mx=Math.min(511,Math.floor((lon/PI*.5+.5)*512)),my=Math.min(255,Math.floor((lat/PI+.5)*256));
    const values=weatherAt(lon,lat,mask[my*512+mx]);
    for(let c=0;c<4;c++)data[((face*size+row)*size+col)*4+c]=Math.round(values[c]*255);
  }
  return data;
}
