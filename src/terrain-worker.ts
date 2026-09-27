import {planetPixels,PLANET_MAP_WIDTH,PLANET_MAP_HEIGHT} from './terrain-map.ts';
const width=PLANET_MAP_WIDTH,height=PLANET_MAP_HEIGHT,data=planetPixels(width,height);
postMessage({data,width,height},{transfer:[data.buffer]});
