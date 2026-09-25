/** Shared domain contracts. Distances are metres, masses kg and angles radians. */
export type PartType =
  "pod" | "tank" | "engine" | "booster_engine" | "vacuum_engine" | "decoupler" | "fin" | "rcs" | "battery" | "solar" | "chassis" | "wheel" | "lidar2d" | "lidar3d" | "camera" | "startracker" | "servo" | "linear" | "docking";
export interface PartDefinition {
  name: string;
  label: string;
  category: string;
  description: string;
  mass: number;
  height: number;
  color: string;
  radial?: boolean;
  width?: number;
  depth?: number;
  power?: number;
  wheelTorque?: number;
  fuel?: number;
  thrust?: number;
  isp?: number;
  ispVac?: number;
  impulse?: number;
  area?: number;
  mono?: number;
  watts?: number;
}
export interface Part {
  id: string;
  type: PartType;
  parent?: string | null;
  offset?: number;
  angle?: number;
  group?: string;
  mirror?: boolean;
}
export interface Craft {
  name: string;
  parts: Part[];
  rootId?: string | null;
  assemblyVersion?: undefined;
}
export interface AssemblyPart extends Part {
  position: number[];
}
export interface Assembly {
  name: string;
  parts: AssemblyPart[];
  rootId: string | null;
  assemblyVersion: 1;
}
export type Design = Craft | Assembly;
export interface LayoutPart extends AssemblyPart {
  rotation?: number[];
  def: PartDefinition;
  connected?: boolean;
}
export interface SurfaceHit {
  id: string;
  point: number[];
  normal?: number[];
}
export type AssemblyPlacement =
  | {
      kind: "root" | "free";
      position: number[];
      snapped: false;
      parent?: never;
    }
  | {
      kind: "surface";
      position: number[];
      snapped: boolean;
      parent: string;
      offset: number;
      angle: number;
    }
  | {
      kind: "stack";
      position: number[];
      snapped: boolean;
      parent: string;
      side: number;
    };
export interface PlacementOptions {
  movingId?: string | null;
  count?: number;
  mirror?: boolean;
  snap?: boolean;
  point?: number[];
  idFactory?: (type: string, i: number) => string;
}
export type Mode = "editor" | "flight";
export type FlightStatus =
  "pad" | "flying" | "landed" | "crashed" | "destroyed";
export interface ForceTorque {
  force: number[];
  torque: number[];
}
export interface AeroResult extends ForceTorque {
  q: number;
  mach: number;
  aoa: number;
  drag: number;
}
export interface EngineResult {
  id: string;
  thrust: number;
  maxThrust: number;
  available: boolean;
  fuel: number;
  gimbalPitch: number;
  gimbalYaw: number;
}
export interface Actuation extends ForceTorque {
  thrust: number;
  engineResults: EngineResult[];
  rcsResults?: { id: string; thrust: number; thrustLimit: number }[];
  rcsUsed: number;
  watts: number;
}
export interface EngineCommand {
  enabled: boolean;
  expires: number;
  targetThrust: number;
  hasGimbalCommand?: boolean;
  gimbalPitch: number;
  gimbalYaw: number;
  gimbalRoll: number;
}
export interface RcsCommand {
  enabled: boolean;
  expires: number;
  thrustLimit: number;
}
export interface FlightCommand {
  expires: number;
  receivedAt: number;
  sequence: number;
  pitch: number;
  yaw: number;
  roll: number;
}
export interface WrenchCommand extends ForceTorque {
  expires: number;
  controllerId: string;
  leaseId: string;
  sequence: number;
}
export interface LibraryEntry {
  id: string;
  craft: Craft;
}

export interface WheelCommand {
  enabled: boolean; expires: number; targetAngularVelocity: number; steeringAngle: number; maxDriveTorque: number; brake: number;
}
export interface WheelState {
  id: string; grounded: boolean; compression: number; normalForce: number;
  steering: number; rotation: number; speed: number; motorForce: number;
  driveTorque: number; brakeTorque: number; slip: number; maxDriveTorque: number;
}
