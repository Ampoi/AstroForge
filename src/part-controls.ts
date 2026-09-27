import { isEngine, PARTS, WHEEL } from '../shared/craft.ts';
import { isJoint, jointLimits } from '../shared/articulation.ts';
import type { Part } from '../shared/types.ts';
import type { UdpState } from '../shared/api.ts';

export type MotorMode = 'position' | 'velocity' | 'effort';
export type ControlField = { key: string; label: string; min: number; max: number; step: number; initial: number };
export const canControlPart = (part: Part) => isEngine(part.type) || ['servo','linear','wheel','rcs','decoupler','docking'].includes(part.type);
const deg = 180 / Math.PI;
export function controlFields(part: Part, mode: MotorMode = 'position'): ControlField[] {
  const field = (key: string, label: string, min: number, max: number, step = .01, initial = 0): ControlField => ({ key, label, min, max, step, initial });
  if (isJoint(part.type)) {
    const limits = jointLimits(part.type), servo = part.type === 'servo', scale = servo && mode !== 'effort' ? deg : 1;
    if (mode === 'position') return [field(mode, servo ? '目標角度 (°)' : '目標伸長量 (m)', limits.lower * scale, limits.upper * scale, servo ? 1 : .01)];
    const max = mode === 'velocity' ? limits.speed * scale : limits.effort;
    return [field(mode, mode === 'velocity' ? `目標速度 (${servo ? '°/s' : 'm/s'})` : servo ? 'トルク (N·m)' : '推力 (N)', -max, max, mode === 'effort' || servo ? 1 : .01)];
  }
  if (isEngine(part.type)) return [field('targetThrust','目標推力 (N)',0,PARTS[part.type].thrust!,100), ...['Pitch','Yaw','Roll'].map(axis => field(`gimbal${axis}`,`ジンバル ${axis} (−1〜1)`,-1,1))];
  if (part.type === 'rcs') return [field('thrustLimit','推力上限 (N)',0,PARTS.rcs.thrust!,1)];
  if (part.type === 'wheel') return [field('targetAngularVelocity','目標角速度 (rad/s)',-WHEEL.maxSpeed/WHEEL.radius,WHEEL.maxSpeed/WHEEL.radius,.1),field('steeringAngle','操舵角 (°)',-.55*deg,.55*deg,.1),field('maxDriveTorque','最大トルク (N·m)',0,WHEEL.motorForce*WHEEL.radius,1,WHEEL.motorForce*WHEEL.radius),field('brake','ブレーキ (0〜1)',0,1)];
  return [];
}

/** Build the same SI-unit packets accepted by the public UDP protocol. */
export function partCommand(part: Part, mode: MotorMode, values: Record<string, number>, enabled: boolean, timeoutSeconds: number): Record<string, unknown> {
  if (!canControlPart(part) || ['decoupler','docking'].includes(part.type)) throw Error('操作対象を確認してください');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < .05 || timeoutSeconds > 10) throw Error('指令時間は0.05〜10秒で指定してください');
  const fields: Record<string, number> = {};
  for (const field of controlFields(part, mode)) {
    const value = enabled ? values[field.key] : field.initial;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) throw Error(`${field.label}の範囲を確認してください`);
    fields[field.key] = value;
  }
  const common = { name: part.id, enabled, timeoutSeconds };
  if (isJoint(part.type)) {
    if (part.type === 'servo' && mode !== 'effort') fields[mode] /= deg;
    return { ...common, type:'pylon_motor_command', mode, hasEnabled:true, hasPosition:mode==='position', hasVelocity:mode==='velocity', hasEffort:mode==='effort', ...fields };
  }
  if (part.type === 'wheel') fields.steeringAngle /= deg;
  return { ...common, type:'pylon_actuator_command', actuatorType:isEngine(part.type)?'engine':part.type, ...(isEngine(part.type)?{hasGimbalCommand:true}:{}), ...fields };
}

type Transport = (command: Record<string, unknown>) => Promise<{accepted: boolean; reason: string}>;
// Kept per browser instance, shared across selection changes. No timer renews a command.
export class PartController {
  private sequence = 0;
  constructor(readonly controllerId: string, readonly leaseId: string) {}
  async send(session: NonNullable<UdpState['session']>, operation: Record<string, unknown>, transport: Transport, isCurrent: () => boolean) {
    const send = async (fields: Record<string, unknown>) => {
      if (!isCurrent()) throw Error('接続または選択対象が変わりました。状態を確認して再操作してください');
      const result = await transport({ ...fields, ...session, controllerId:this.controllerId, leaseId:this.leaseId, sequence:++this.sequence });
      if (!result.accepted) throw Error(commandError(result.reason));
    };
    if (operation.type !== 'pylon_control_authority_command') await send({type:'pylon_control_authority_command',action:'acquire',priority:0,leaseDurationSeconds:10,suppressSas:false});
    await send(operation);
  }
}
export function commandError(reason: string) {
  const messages: Record<string,string> = {
    authority_held_by_higher_or_equal_priority:'別のコントローラーが操作中です。制御権を解放してから再操作してください',
    lease_not_owned:'制御権がありません。状態を確認して再操作してください',
    runtime_session_mismatch:'制御セッションが更新されました。状態を確認して再操作してください',
    control_unavailable:'この機体は現在操作できません',
    emergency_stop:'緊急停止中です',
    docking_port_not_docked:'このポートはドッキングしていません',
  };
  return messages[reason] ?? `指令を受け付けませんでした (${reason})`;
}
