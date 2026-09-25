"""Orbital ascent from public flight/actuator observations (SI units only)."""
from dataclasses import dataclass
import math


def clip(value, low, high):
    return max(low, min(high, value))


def vector(value):
    return (value.x, value.y, value.z)


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


@dataclass
class Demand:
    phase: str
    engine: str = ''
    thrust: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0
    roll: float = 0.0
    separation: str = ''
    complete: bool = False


class OrbitGuidance:
    def __init__(self, engines, separators, target=200000.0):
        if not engines or len(separators) != len(engines)-1:
            raise ValueError('Provide engines in burn order and one separator between stages')
        if len(set(engines+separators)) != len(engines+separators):
            raise ValueError('Actuator names must be unique')
        if not math.isfinite(target) or not 180000 <= target <= 400000:
            raise ValueError('Target altitude must be 180000..400000 m')
        self.engines, self.separators, self.target = engines, separators, target
        self.stage = 0
        self.start = None
        self.pending = None
        self.separated_at = None
        self.cutoff_at = None
        self.last_separation_send = -math.inf
        self.launched = False
        self.events = []
        self.last_phase = ''

    def update(self, snapshot):
        f = snapshot.flight
        values = [f.universal_time, f.altitude_asl, f.apoapsis, f.periapsis,
                  f.mass, f.gravity, f.body_radius, f.gravitational_parameter,
                  f.vertical_speed, f.horizontal_speed]
        for v in (f.up_body, f.east_body, f.angular_velocity_body, f.orbital_velocity_body):
            values.extend(vector(v))
        if not all(math.isfinite(v) for v in values) or min(f.mass, f.gravity, f.body_radius, f.gravitational_parameter) <= 0:
            raise ValueError('Invalid flight telemetry')
        if f.body_name != 'Earth':
            raise ValueError('This mission targets Earth')
        if self.start is None:
            if not f.landed or f.altitude_asl > 100:
                raise ValueError('Start with the vehicle on its launch pad')
            self.start = f.universal_time
        t = f.universal_time-self.start
        self.launched |= not f.landed
        if self.launched and f.landed:
            raise ValueError('Vehicle returned to the ground')
        if t > 1200:
            raise ValueError('Mission simulation-time timeout')
        engine = next((e for e in snapshot.engines if e.name == self.engines[self.stage]), None)
        d = Demand('ASCENT', self.engines[self.stage])
        up, east, omega = map(vector, (f.up_body, f.east_body, f.angular_velocity_body))
        if self.cutoff_at is not None:
            d.phase = 'ORBIT_VERIFY'
            if not self.target-10000 <= f.periapsis <= f.apoapsis <= self.target+30000:
                raise ValueError('Post-cutoff orbit left acceptance bounds')
            d.complete = f.universal_time-self.cutoff_at >= 60
        elif f.periapsis >= self.target-5000 and f.apoapsis <= self.target+25000 and f.altitude_asl > f.atmosphere_depth:
            self.cutoff_at = f.universal_time
            d.phase = 'ORBIT_VERIFY'
        elif self.pending is not None:
            d.phase = 'SEPARATION'
            ring = next((s for s in snapshot.separations if s.name == self.pending), None)
            if ring and ring.separated:
                self.stage += 1
                self.pending = None
                self.separated_at = f.universal_time
                d.engine = self.engines[self.stage]
            elif f.universal_time-self.last_separation_send >= 1:
                d.separation = self.pending
                self.last_separation_send = f.universal_time
        elif self.separated_at is not None and f.universal_time-self.separated_at < 1:
            d.phase = 'STAGE_CLEARANCE'
        else:
            if engine is None:
                raise ValueError('Configured engine absent from coherent snapshot: '+d.engine)
            if engine.flameout:
                if self.stage == len(self.engines)-1:
                    raise ValueError('Final stage fuel exhausted before orbit insertion')
                self.pending = self.separators[self.stage]
                self.last_separation_send = f.universal_time
                d.phase, d.separation = 'SEPARATION', self.pending
            elif not engine.operational or engine.max_thrust <= 0:
                raise ValueError('Configured engine is not operational: '+d.engine)
            else:
                d.thrust = engine.max_thrust
                d.phase = 'BOOST' if self.stage == 0 else 'INSERTION'
        altitude = f.altitude_asl
        if self.stage == 0:
            tilt = math.radians(clip((altitude-300)/700, 0, 70))
            gain, damping = 1.5, 5.0
        else:
            # Vertical acceleration includes inverse-square gravity and curvature.
            # Once near the target altitude, accelerate tangentially while bringing
            # radial velocity to zero; no internal position or physics state is read.
            orbital = vector(f.orbital_velocity_body)
            radial = dot(orbital, up)
            horizontal2 = max(0, dot(orbital, orbital)-radial*radial)
            desired_vertical = clip((self.target-altitude)/60, -100, 600)
            available_accel = max(1, (engine.max_thrust if engine else 80000)/f.mass)
            vertical_accel = clip((desired_vertical-radial)/15 + f.gravity-horizontal2/(f.body_radius+altitude),
                                  -.6*available_accel, .95*available_accel)
            circular_speed = math.sqrt(f.gravitational_parameter/(f.body_radius+altitude))
            horizontal_accel = clip((circular_speed-math.sqrt(horizontal2))/15,
                                    0, math.sqrt(max(0, available_accel**2-vertical_accel**2)))
            tilt = math.atan2(horizontal_accel, vertical_accel)
            gain, damping = .35, .9
            if d.thrust > 0:
                d.thrust = f.mass*math.hypot(vertical_accel, horizontal_accel)
        target = tuple(u*math.cos(tilt)+e*math.sin(tilt) for u, e in zip(up, east))
        d.pitch = clip(-gain*target[2]-damping*omega[1], -1, 1)
        d.yaw = clip(gain*target[1]-damping*omega[2], -1, 1)
        d.roll = clip(-damping*omega[0], -1, 1)
        if self.cutoff_at is not None:
            d.pitch = d.yaw = d.roll = 0.0
        if d.phase != self.last_phase:
            self.events.append(dict(time=f.universal_time, phase=d.phase, stage=self.stage+1))
            self.last_phase = d.phase
        return d
