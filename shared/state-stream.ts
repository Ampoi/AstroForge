import type {AppState} from './api.ts';
import type {FlightSnapshot} from '../server/types.ts';

type FixedBody = Pick<FlightSnapshot, 'craft' | 'stats'>;
type Tree = {id: string; debris: Tree[]};
type DynamicVehicle = Omit<AppState['vehicles'][number], 'craft' | 'stats'>;
export interface StreamConfiguration {
  revision: number; craft: AppState['craft']; draft: AppState['draft']; library: AppState['library'];
  bodies: Record<string, FixedBody>;
}
export type StreamFrame = Omit<AppState, 'craft' | 'draft' | 'library' | 'flight' | 'vehicles'> & {
  revision: number; flight: Tree; vehicles: DynamicVehicle[];
};
const tree = (body: FlightSnapshot): Tree => ({id: body.id, debris: body.debris.map(tree)});
/** References change only on edit/launch/separation; no JSON hashing on each tick. */
export class StateStreamEncoder {
  private configuration?: StreamConfiguration;
  private serializedConfiguration = '';
  encode(state: AppState) {
    const old = this.configuration;
    const changed = !old || old.craft !== state.craft || old.draft !== state.draft ||
      old.library.length !== state.library.length || old.library.some((v, i) => v !== state.library[i]) ||
      Object.keys(old.bodies).length !== state.vehicles.length ||
      state.vehicles.some(v => old.bodies[v.id]?.craft !== v.craft || old.bodies[v.id]?.stats !== v.stats);
    if (changed) {
      this.configuration = {revision: (old?.revision ?? 0) + 1, craft: state.craft, draft: state.draft, library: state.library,
        bodies: Object.fromEntries(state.vehicles.map(v => [v.id, {craft: v.craft, stats: v.stats}]))};
      this.serializedConfiguration = `event: configuration\ndata: ${JSON.stringify(this.configuration)}\n\n`;
    }
    const {craft, draft, library, flight, vehicles, ...dynamic} = state;
    const revision = this.configuration!.revision;
    const frame: StreamFrame = {...dynamic, revision, flight: tree(flight),
      vehicles: vehicles.map(({craft, stats, ...vehicle}) => vehicle)};
    return {revision, configuration: this.serializedConfiguration, frame: `data: ${JSON.stringify(frame)}\n\n`};
  }
}
export class StateStreamDecoder {
  configuration?: StreamConfiguration;
  decode(frame: StreamFrame): AppState {
    const config = this.configuration;
    if (!config || config.revision !== frame.revision) throw Error('State stream configuration mismatch');
    const vehicles = frame.vehicles.map(v => {
      const fixed = config.bodies[v.id];
      if (!fixed) throw Error(`Missing configuration for ${v.id}`);
      return {...v, ...fixed};
    });
    const byId = new Map(vehicles.map(v => [v.id, v]));
    function flight(node: Tree): FlightSnapshot {
      const body = byId.get(node.id);
      if (!body) throw Error(`Missing state for ${node.id}`);
      const {udp, trail, controllable, ...snapshot} = body;
      return {...snapshot, debris: node.debris.map(flight)};
    }
    const {revision, ...state} = frame;
    return {...state, craft: config.craft, draft: config.draft, library: config.library, vehicles, flight: flight(frame.flight)};
  }
}
