import {planetPixels,PLANET_MAP_WIDTH,PLANET_MAP_HEIGHT,PLANET_SOURCE_WIDTH,PLANET_SOURCE_HEIGHT} from './terrain-map.ts';
import {enhancePlanet} from './texture-detail.ts';
const width=PLANET_MAP_WIDTH,height=PLANET_MAP_HEIGHT;
const data=enhancePlanet(planetPixels(PLANET_SOURCE_WIDTH,PLANET_SOURCE_HEIGHT),PLANET_SOURCE_WIDTH,PLANET_SOURCE_HEIGHT);
postMessage({data,width,height},{transfer:[data.buffer]});
