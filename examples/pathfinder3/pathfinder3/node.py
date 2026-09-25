"""ROS2-only mission IO. The separately launched bridge owns UDP transport."""
import csv
import json
import math
from pathlib import Path
import time
import uuid

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
from pylon_interfaces.msg import (ControlSnapshot, ControlBatch, EngineCommand,
                                  FlightControlCommand, SeparationCommand,
                                  ControlAuthorityCommand, ControlAuthorityState, VesselLifecycle)
from .guidance import OrbitGuidance


class OrbitController(Node):
    def __init__(self, **kwargs):
        super().__init__('pathfinder3_controller', **kwargs)
        for key, default in [('engines', ''), ('separators', ''), ('target_altitude', 200000.0),
                             ('timeout', 1500.0), ('output_dir', '/tmp/pathfinder3-flight')]:
            self.declare_parameter(key, default)
        names = lambda key: [v.strip() for v in self.get_parameter(key).value.split(',') if v.strip()]
        self.guidance = OrbitGuidance(names('engines'), names('separators'), float(self.get_parameter('target_altitude').value))
        self.timeout = float(self.get_parameter('timeout').value)
        if not math.isfinite(self.timeout) or self.timeout <= 0:
            raise ValueError('timeout must be finite and positive')
        self.output = Path(self.get_parameter('output_dir').value)
        self.output.mkdir(parents=True, exist_ok=True)
        # A run must never overwrite evidence from a previous flight.
        self.csv_file = (self.output/'telemetry.csv').open('x', newline='')
        columns = ['time', 'phase', 'stage', 'altitude', 'apoapsis', 'periapsis', 'vertical_speed',
                   'horizontal_speed', 'mass', 'fuel_units', 'thrust_command', 'thrust_actual',
                   'pitch', 'yaw', 'roll', 'tilt_deg', 'dynamic_pressure']
        self.csv = csv.DictWriter(self.csv_file, fieldnames=columns)
        self.csv.writeheader()
        self.controller = 'pathfinder3-'+uuid.uuid4().hex[:8]
        self.lease = uuid.uuid4().hex
        self.sequence = 0
        self.identity = None
        self.latest = self.authority = self.final_row = None
        self.owned_once = self.done = self.success = False
        self.reason = ''
        self.started = self.last_observation = time.monotonic()
        self.last_acquire = self.last_log = 0.0
        self.last_sequence = -1
        self.last_time = None
        self.samples = 0
        self.max_gap = 0.0
        self.separation_started = None
        self.separation_operations = {}
        self.batch_pub = self.create_publisher(ControlBatch, '/ksp_vessel/control/batch', 10)
        self.authority_pub = self.create_publisher(ControlAuthorityCommand, '/ksp_vessel/control/authority/command', 10)
        retained = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                              durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.create_subscription(ControlAuthorityState, '/ksp_vessel/control/authority/state', self.on_authority, retained)
        self.create_subscription(VesselLifecycle, '/ksp_vessel/lifecycle', self.on_lifecycle, retained)
        self.create_subscription(ControlSnapshot, '/ksp_vessel/control/snapshot', self.on_snapshot, 10)
        self.create_timer(0.1, self.watchdog)
        self.get_logger().info('Waiting for ROS telemetry and a confirmed control lease')

    def next_sequence(self):
        self.sequence += 1
        return self.sequence

    def owns(self):
        a = self.authority
        return bool(a and self.identity and a.state == a.STATE_OWNED and
                    a.vessel_id == self.identity[3] and a.controller_id == self.controller and a.lease_id == self.lease)

    def on_authority(self, message):
        self.authority = message
        if self.owns():
            self.owned_once = True
        elif self.owned_once:
            self.finish(False, 'Control authority lost')

    def on_lifecycle(self, message):
        if self.identity is None or self.done:
            return
        identity = (message.runtime_instance, message.runtime_generation, message.runtime_epoch, message.vessel_id)
        if identity != self.identity or message.state != message.STATE_ACTIVE:
            # Never issue shutdown commands into the replacement session.
            self.authority = None
            self.finish(False, 'Session changed or became unavailable')

    def lease_command(self, action):
        if self.identity:
            self.authority_pub.publish(ControlAuthorityCommand(vessel_id=self.identity[3], controller_id=self.controller,
                lease_id=self.lease, sequence=self.next_sequence(), action=action, priority=1,
                lease_duration_sec=2.0, suppress_sas=True))

    def watchdog(self):
        if self.done:
            return
        now = time.monotonic()
        if now-self.started > self.timeout:
            self.finish(False, 'Mission wall-clock timeout')
        elif self.identity is None and now-self.started > 20:
            self.finish(False, 'No ROS snapshot within 20 seconds')
        elif self.identity and now-self.last_observation > 1:
            self.finish(False, 'Telemetry stale for more than 1 second')
        elif self.separation_started and now-self.separation_started > 5:
            self.finish(False, 'Separation not confirmed within 5 seconds')
        elif self.identity and not self.owned_once and now-self.last_acquire > .5:
            self.lease_command(ControlAuthorityCommand.ACTION_ACQUIRE)
            self.last_acquire = now

    def demand(self, d=None):
        if not self.owns() or self.latest is None:
            return
        batch = ControlBatch(vessel_id=self.identity[3], controller_id=self.controller,
            lease_id=self.lease, sequence=self.next_sequence(), renew_lease=True,
            lease_duration_sec=2.0, suppress_sas=True, has_flight=True)
        batch.flight = FlightControlCommand(pitch=float(d.pitch) if d else 0.0,
            yaw=float(d.yaw) if d else 0.0, roll=float(d.roll) if d else 0.0,
            landing_gear=False, timeout_sec=.4)
        if d and d.separation:
            ring = next((s for s in self.latest.separations if s.name == d.separation), None)
            if ring is None:
                raise ValueError('Configured separator not observed: '+d.separation)
            batch.has_separation = True
            operation = self.separation_operations.setdefault(d.separation, uuid.uuid4().hex)
            batch.separation = SeparationCommand(id=ring.id, separate=True, operation_id=operation,
                original_runtime_instance=self.identity[0], original_runtime_epoch=self.identity[2],
                original_vessel_id=self.identity[3])
        else:
            # Names are user-supplied; ROS IDs are resolved from the same snapshot.
            batch.engines = [EngineCommand(id=e.id, enabled=bool(d and d.thrust > 0 and e.name == d.engine),
                target_thrust=float(d.thrust) if d and e.name == d.engine else 0.0, timeout_sec=.4)
                for e in self.latest.engines if e.name in self.guidance.engines]
        self.batch_pub.publish(batch)

    def on_snapshot(self, message):
        if self.done:
            return
        f = message.flight
        identity = (f.runtime_instance, f.runtime_generation, f.runtime_epoch, f.vessel_id)
        if self.identity is None:
            self.identity = identity
        elif identity != self.identity:
            self.authority = None
            self.finish(False, 'Snapshot session changed')
            return
        if f.observation_sequence <= self.last_sequence:
            return
        now = time.monotonic()
        self.max_gap = max(self.max_gap, now-self.last_observation) if self.samples else 0.0
        self.last_observation, self.last_sequence, self.latest = now, f.observation_sequence, message
        if self.last_time is not None and f.universal_time < self.last_time:
            self.finish(False, 'Simulation time moved backwards')
            return
        self.last_time = f.universal_time
        if not self.owns():
            return
        try:
            d = self.guidance.update(message)
            if self.guidance.pending:
                self.separation_started = self.separation_started or now
            else:
                self.separation_started = None
            row = dict(time=f.universal_time, phase=d.phase, stage=self.guidance.stage+1,
                altitude=f.altitude_asl, apoapsis=f.apoapsis, periapsis=f.periapsis,
                vertical_speed=f.vertical_speed, horizontal_speed=f.horizontal_speed,
                mass=f.mass, fuel_units=f.liquid_fuel, thrust_command=d.thrust,
                thrust_actual=sum(e.thrust for e in message.engines), pitch=d.pitch, yaw=d.yaw, roll=d.roll,
                tilt_deg=math.degrees(math.acos(max(-1, min(1, f.up_body.x)))), dynamic_pressure=f.dynamic_pressure)
            self.csv.writerow(row)
            self.final_row, self.samples = row, self.samples+1
            self.demand(d)
            if d.complete:
                self.finish(row['thrust_actual'] < 1, 'Unpowered orbit verified for 60 simulation seconds')
            if now-self.last_log >= 2:
                self.last_log = now
                self.csv_file.flush()
                self.get_logger().info(f'{d.phase} T={f.universal_time:.1f} h={f.altitude_asl/1000:.1f} km '
                    f'Ap={f.apoapsis/1000:.1f} Pe={f.periapsis/1000:.1f} km vH={f.horizontal_speed:.0f} '
                    f'tilt={row["tilt_deg"]:.1f} thrust={d.thrust:.0f} N')
        except (ValueError, ArithmeticError) as exc:
            self.finish(False, str(exc))

    def finish(self, success, reason):
        if self.done:
            return
        self.done, self.success, self.reason = True, success, reason
        self.csv_file.flush()
        summary = dict(success=success, reason=reason, target_altitude=self.guidance.target,
            samples=self.samples, max_telemetry_gap_sec=self.max_gap, wall_duration_sec=time.monotonic()-self.started,
            transitions=self.guidance.events, final=self.final_row,
            transport='ROS2 -> PyLoN bridge -> public UDP -> AstroForge')
        (self.output/'result.json').write_text(json.dumps(summary, indent=2)+'\n')
        (self.get_logger().info if success else self.get_logger().error)(('SUCCESS: ' if success else 'FAILED: ')+reason)

    def stop(self):
        self.done = True
        if self.owns():
            self.demand()
            self.lease_command(ControlAuthorityCommand.ACTION_RELEASE)
        self.csv_file.close()


def main(args=None):
    rclpy.init(args=args)
    node = OrbitController()
    try:
        while rclpy.ok() and not node.done:
            rclpy.spin_once(node, timeout_sec=.1)
    except KeyboardInterrupt:
        node.finish(False, 'Interrupted')
    except Exception as exc:
        node.finish(False, f'{type(exc).__name__}: {exc}')
        raise
    finally:
        if rclpy.ok():
            node.stop()
            deadline = time.monotonic()+.3
            while time.monotonic() < deadline:
                rclpy.spin_once(node, timeout_sec=.02)
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
    return 0 if node.success else 1
