import {planetPixels} from './terrain-map.ts';
const width=2048,height=1024,data=planetPixels(width,height);
postMessage({data,width,height},{transfer:[data.buffer]});
