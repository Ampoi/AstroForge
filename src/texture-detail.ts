/** Load-time detail synthesis. All noise lives in sphere/world coordinates, so
 * neither cube edges nor longitude/poles introduce a new seam. No frame state. */
export const TEXTURE_DETAIL_SEED=73129;
export const WEATHER_SOURCE_SIZE=128;
export const WEATHER_DETAIL_SIZE=512;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export function detailNoise(x:number,y:number,z:number,seed=TEXTURE_DETAIL_SEED){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const smooth=(v:number)=>v*v*(3-2*v),u=smooth(x-ix),v=smooth(y-iy),w=smooth(z-iz);
  const hash=(a:number,b:number,c:number)=>{
    let h=Math.imul(a,374761393)^Math.imul(b,668265263)^Math.imul(c,2147483647)^seed;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  };
  const layer=(k:number)=>mix(mix(hash(ix,iy,iz+k),hash(ix+1,iy,iz+k),u),mix(hash(ix,iy+1,iz+k),hash(ix+1,iy+1,iz+k),u),v);
  return mix(layer(0),layer(1),w);
}

/** Add albedo variation only. Alpha is elevation, never noise or opacity. */
export function enhanceLand(data:Uint8Array,width:number,height:number,seed=TEXTURE_DETAIL_SEED){
  for(let y=0;y<height;y++){
    const lat=((y+.5)/height-.5)*Math.PI,cos=Math.cos(lat),nz=Math.sin(lat);
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if(data[i+3]===0)continue;
      const lon=((x+.5)/width-.5)*2*Math.PI,nx=cos*Math.cos(lon),ny=cos*Math.sin(lon);
      const detail=(detailNoise(nx*380,ny*380,nz*380,seed)-.5)*.16
        +(detailNoise(nx*920,ny*920,nz*920,seed+1)-.5)*.07;
      const strength=Math.min(1,data[i+3]/8);
      for(let c=0;c<3;c++)data[i+c]=Math.round(Math.max(0,Math.min(255,data[i+c]*(1+detail*strength))));
    }
  }
  return data;
}

/** Enlarge the existing map before adding detail, instead of rerunning the
 * expensive terrain/physics field four times as often during initialization. */
export function enhancePlanet(source:Uint8Array,width:number,height:number,seed=TEXTURE_DETAIL_SEED){
  if(source.length!==width*height*4)throw Error('Planet map: invalid dimensions');
  const outWidth=width*2,outHeight=height*2,data=new Uint8Array(outWidth*outHeight*4);
  for(let y=0;y<outHeight;y++){
    const py=(y+.5)/2-.5,iy=Math.floor(py),fy=py-iy;
    const y0=Math.max(0,iy),y1=Math.min(height-1,iy+1);
    for(let x=0;x<outWidth;x++){
      const px=(x+.5)/2-.5,ix=Math.floor(px),fx=px-ix;
      const x0=(ix+width)%width,x1=(ix+1)%width,offset=(y*outWidth+x)*4;
      for(let c=0;c<4;c++)data[offset+c]=Math.round(mix(
        mix(source[(y0*width+x0)*4+c],source[(y0*width+x1)*4+c],fx),
        mix(source[(y1*width+x0)*4+c],source[(y1*width+x1)*4+c],fx),fy));
    }
  }
  return enhanceLand(data,outWidth,outHeight,seed);
}

export function cubeDirection(face:number,u:number,v:number):number[]{
  switch(face){case 0:return [1,-v,-u];case 1:return [-1,-v,u];case 2:return [u,1,v];case 3:return [u,-1,-v];case 4:return [u,-v,1];default:return [-u,-v,-1];}
}
function cubeUV(x:number,y:number,z:number){
  const ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);
  if(ax>=ay&&ax>=az)return x>=0?[0,-z/ax,-y/ax]:[1,z/ax,-y/ax];
  if(ay>=az)return y>=0?[2,x/ay,z/ay]:[3,x/ay,-z/ay];
  return z>=0?[4,x/az,-y/az]:[5,-x/az,-y/az];
}
/** Bilinear sampling with taps crossing onto adjacent faces, rather than
 * clamping each face and baking visible borders into the enlarged atlas. */
export function sampleWeather(source:Uint8Array,size:number,x:number,y:number,z:number,out:number[]){
  const [face,u,v]=cubeUV(x,y,z),px=(u+1)*.5*size-.5,py=(v+1)*.5*size-.5;
  const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;out.fill(0);
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){
    let f=face,tx=ix+i,ty=iy+j;
    if(tx<0||tx>=size||ty<0||ty>=size){
      const d=cubeDirection(face,(tx+.5)/size*2-1,(ty+.5)/size*2-1),uv=cubeUV(d[0],d[1],d[2]);
      f=uv[0];tx=Math.max(0,Math.min(size-1,Math.floor((uv[1]+1)*.5*size)));ty=Math.max(0,Math.min(size-1,Math.floor((uv[2]+1)*.5*size)));
    }
    const offset=((f*size+ty)*size+tx)*4,weight=(i?fx:1-fx)*(j?fy:1-fy);
    for(let c=0;c<4;c++)out[c]+=source[offset+c]*weight;
  }
}
export function enhanceWeather(source:Uint8Array,size=WEATHER_SOURCE_SIZE,targetSize=WEATHER_DETAIL_SIZE,seed=TEXTURE_DETAIL_SEED){
  if(source.length!==size*size*6*4)throw Error('Weather atlas: invalid dimensions');
  const data=new Uint8Array(targetSize*targetSize*6*4),sample=[0,0,0,0];
  for(let face=0;face<6;face++)for(let y=0;y<targetSize;y++)for(let x=0;x<targetSize;x++){
    const d=cubeDirection(face,(x+.5)/targetSize*2-1,(y+.5)/targetSize*2-1),length=Math.hypot(...d);
    sampleWeather(source,size,d[0],d[1],d[2],sample);
    const nx=d[0]/length,ny=d[1]/length,nz=d[2]/length;
    const detail=(detailNoise(nx*175,ny*175,nz*175,seed)-.5)*.75
      +(detailNoise(nx*390,ny*390,nz*390,seed+1)-.5)*.25;
    const offset=((face*targetSize+y)*targetSize+x)*4;
    for(let c=0;c<3;c++){
      const coverage=sample[c]/255;
      // Preserve clear sky and dense cores; break up partially covered edges.
      data[offset+c]=Math.round(clamp(coverage+detail*coverage*(1-coverage)*1.8)*255);
    }
    data[offset+3]=Math.round(sample[3]); // Cloud type is not a detail channel.
  }
  return data;
}
