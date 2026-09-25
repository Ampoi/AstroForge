import type {Simulation} from './physics.ts';
import {EARTH,atmosphere} from './physics-reference.ts';
import {norm,sub,cross,dot} from '../shared/math.ts';
import {SENSOR_TYPES,SUN} from './sensors.ts';
export interface ThermalState{temperature:number;skinTemperature:number}
/** Lumped core/skin heat capacities and radiation. Educational coefficients. */
export function advanceThermals(sim:Simulation,dt:number){
  const air=atmosphere(norm(sim.position)-EARTH.radius),speed=norm(sub(sim.velocity,cross([0,0,EARTH.spin],sim.position)));
  const sunlit=dot(sim.position,SUN)>=0||norm(cross(sim.position,SUN))>EARTH.radius;
  for(const p of sim.props.parts){
    const state=sim.thermals[p.id]??={temperature:288.15,skinTemperature:288.15};
    const area=Math.max(.05,p.def.height*(p.def.width??1.25)*2);
    const engine=sim.lastActuation?.engineResults.find(e=>e.id===p.id)?.thrust??0;
    const solar=sunlit?300*area:0;
    const convection=5*air.density*area*(air.temperature-state.skinTemperature);
    const aerodynamic=.00002*Math.sqrt(air.density)*speed**3*area;
    const radiation=.8*5.670374419e-8*area*(state.skinTemperature**4-3**4);
    const conduction=20*area*(state.skinTemperature-state.temperature);
    state.skinTemperature=Math.max(3,state.skinTemperature+(solar+convection+aerodynamic-radiation-conduction)*dt/(p.mass*100));
    state.temperature=Math.max(3,state.temperature+(conduction+engine*.01)*dt/(p.mass*700));
  }
  const watts=(sim.craft.parts.filter(p=>SENSOR_TYPES.includes(p.type)).length+(sim.selectedDockingCamera?1:0))*8;
  sim.charge=Math.max(0,sim.charge-watts*dt/3600);
}
