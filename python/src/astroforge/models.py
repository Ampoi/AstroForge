"""Typed observations. Wire names and SI units follow the existing protocol."""
from dataclasses import dataclass
from typing import Generic, TypeVar, TypedDict


class Flight(TypedDict):
    altitudeAgl: float
    altitudeAsl: float
    verticalSpeed: float
    horizontalSpeed: float
    mass: float
    liquidFuel: float
    oxidizer: float
    electricCharge: float
    dynamicPressure: float
    apoapsis: float
    periapsis: float
    orbitBound: bool
    upBody: list[float]
    eastBody: list[float]
    northBody: list[float]
    angularVelocityBody: list[float]
    landed: bool


class Actuator(TypedDict, total=False):
    name: str
    actuatorType: str
    available: bool
    operational: bool
    enabled: bool
    commandActive: bool
    thrust: float
    maxThrust: float
    flameout: bool
    separated: bool


class Imu(TypedDict):
    angularVelocity: list[float]
    linearAcceleration: list[float]


@dataclass(frozen=True)
class Session:
    runtimeInstance: str
    runtimeGeneration: int
    runtimeEpoch: str
    runtimeVesselId: str
    vesselId: str


T = TypeVar("T")


@dataclass(frozen=True)
class Observation(Generic[T]):
    session: Session
    sequence: int
    simulation_time: float
    received_at: float  # time.monotonic(), not simulation time
    data: T


@dataclass(frozen=True)
class Snapshot:
    session: Session
    sequence: int
    simulation_time: float
    received_at: float
    flight: Flight
    engines: tuple[Actuator, ...]
    separations: tuple[Actuator, ...]


@dataclass(frozen=True)
class ConnectionState:
    connected: bool
    available: bool  # Session availability, not a guarantee that control can be acquired.
    controlling: bool
    heartbeat_age: float | None
    snapshot_age: float | None
    error: str | None
