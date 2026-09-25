import type {
  Craft,
  WheelState,
  FlightStatus,
  ForceTorque,
  AeroResult,
  Actuation,
  EngineResult,
} from "../shared/types.ts";
import type { craftStats, massProperties } from "../shared/craft.ts";
import type { orbitalElements } from "./physics-reference.ts";
export interface PhysicsBody {
  props: ReturnType<typeof massProperties>;
  stats: ReturnType<typeof craftStats>;
}
export interface PhysicsKernel {
  name: string;
  integrate(
    sim: PhysicsBody,
    state: number[],
    dt: number,
    actuation: ForceTorque,
  ): number[];
  aerodynamic(
    sim: PhysicsBody,
    position: number[],
    velocity: number[],
    q: number[],
    omega: number[],
  ): AeroResult;
}
export interface FlightSnapshot {
  id: string;
  craft: Craft;
  createdAt: number;
  fragment: boolean;
  passive: boolean;
  impact: {
    time: number;
    speed: number;
    kind: string;
    position: number[];
  } | null;
  time: number;
  status: FlightStatus;
  position: number[];
  velocity: number[];
  quaternion: number[];
  omega: number[];
  altitude: number;
  altitudeAsl: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  speed: number;
  mass: number;
  fuel: number;
  mono: number;
  charge: number;
  orbit: ReturnType<typeof orbitalElements>;
  thrust: number;
  drag: number;
  q: number;
  mach: number;
  aoa: number;
  maxAltitude: number;
  maxQ: number;
  upBody: number[];
  eastBody: number[];
  northBody: number[];
  surfaceVelocityBody: number[];
  orbitalVelocityBody: number[];
  gravity: number;
  events: { time: number; text: string }[];
  stats: ReturnType<typeof craftStats>;
  com: number[];
  engines: EngineResult[];
  wheels: WheelState[];
  powerGeneration: number;
  separations: { id: string; time: number }[];
  debris: FlightSnapshot[];
}
export interface UdpConfig {
  commandPort: number;
  telemetryPort: number;
  telemetryHost: string;
}
export type Packet = { type: string } & Record<string, unknown>;
/** Wire fields are checked by PylonProtocol before commands enter the simulation. */
export interface WireCommand {
  [key: string]: unknown;
  version: number;
  type: string;
  sequence: number;
  controllerId: string;
  leaseId: string;
  vesselId: string;
  action: string;
  priority: number;
  suppressSas: boolean;
  leaseDurationSeconds: number;
  actuatorType: string;
  name: string;
  separate: boolean;
  timeoutSeconds: number;
  pitch: number;
  yaw: number;
  roll: number;
  landingGear: boolean;
  frame: string;
  force: number[];
  torque: number[];
  enabled: boolean;
  targetThrust: number;
  hasGimbalCommand: boolean;
  gimbalPitch: number;
  gimbalYaw: number;
  gimbalRoll: number;
  thrustLimit: number;
  motor: number;
  steering: number;
  brake: number;
  hasFlight: boolean;
  hasSeparation: boolean;
  renewLease: boolean;
  engineJson: string[];
  flightJson: string;
  separationJson: string;
}
