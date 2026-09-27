import {TERRAIN_MAX_HEIGHT,terrainDirection,terrainSample,terrainColor} from '../shared/terrain.ts';
export const PLANET_SOURCE_WIDTH=2048,PLANET_SOURCE_HEIGHT=1024;
export const PLANET_MAP_WIDTH=PLANET_SOURCE_WIDTH*2,PLANET_MAP_HEIGHT=PLANET_SOURCE_HEIGHT*2;
export function planetPixels(width:number,height:number){
  const data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const direction=terrainDirection(((x+.5)/width-.5)*Math.PI*2,((y+.5)/height-.5)*Math.PI);
    const sample=terrainSample(direction),color=terrainColor(sample),offset=(y*width+x)*4;
    for(let c=0;c<3;c++)data[offset+c]=Math.round(color[c]);
    data[offset+3]=Math.round(Math.max(0,sample.height)/TERRAIN_MAX_HEIGHT*255);
  }
  return data;
}
