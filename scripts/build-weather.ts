import {readFileSync,writeFileSync} from 'node:fs';
import {buildWeatherMap,WEATHER_FACE_SIZE} from './weather-model.ts';
const root=new URL('../',import.meta.url);
const land=JSON.parse(readFileSync(new URL('public/assets/land.json',root),'utf8'));
const data=buildWeatherMap(land);
writeFileSync(new URL('public/assets/cloud-weather.rgba',root),data);
console.log(`Generated 6 × ${WEATHER_FACE_SIZE}² cloud weather cube (${data.byteLength} bytes).`);
