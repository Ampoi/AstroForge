"""Validated command values, also used as atomic batch members."""
from dataclasses import dataclass
import math


def number(value: float, low: float, high: float, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{label} must be finite and in [{low}, {high}]")
    return value


def boolean(value: bool, label: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{label} must be boolean")
    return value


def identifier(value: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 64:
        raise ValueError("identifier must be a nonempty string of at most 64 characters")
    return value


def vector(value, low: float, high: float, label: str) -> list[float]:
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        raise ValueError(f"{label} must contain three numbers")
    return [number(v, low, high, label) for v in value]


@dataclass(frozen=True)
class EngineCommand:
    name: str
    thrust: float
    enabled: bool = True
    timeout: float = .4
    gimbal: tuple[float, float, float] | None = None

    def fields(self) -> dict:
        g = vector(self.gimbal if self.gimbal is not None else (0, 0, 0), -1, 1, "gimbal")
        return dict(type="pylon_actuator_command", actuatorType="engine", name=identifier(self.name),
                    enabled=boolean(self.enabled, "enabled"), targetThrust=number(self.thrust, 0, 1e8, "thrust"),
                    timeoutSeconds=number(self.timeout, .05, 10, "timeout"), hasGimbalCommand=self.gimbal is not None,
                    gimbalPitch=g[0], gimbalYaw=g[1], gimbalRoll=g[2])


@dataclass(frozen=True)
class AttitudeCommand:
    pitch: float = 0
    yaw: float = 0
    roll: float = 0
    timeout: float = .4
    landing_gear: bool = False

    def fields(self) -> dict:
        return dict(type="pylon_flight_control_command", pitch=number(self.pitch, -1, 1, "pitch"),
                    yaw=number(self.yaw, -1, 1, "yaw"), roll=number(self.roll, -1, 1, "roll"),
                    timeoutSeconds=number(self.timeout, .05, 1, "timeout"),
                    landingGear=boolean(self.landing_gear, "landing_gear"))


@dataclass(frozen=True)
class SeparationCommand:
    name: str
    separate: bool = True

    def fields(self) -> dict:
        return dict(type="pylon_actuator_command", actuatorType="separation", name=identifier(self.name),
                    separate=boolean(self.separate, "separate"))
