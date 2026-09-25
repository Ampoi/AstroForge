"""One socket and one receiver per vehicle; no HTTP or simulator imports."""
from collections import deque
from copy import deepcopy
from dataclasses import asdict
import json
import math
import socket
import threading
import time
import uuid
from typing import cast

from .commands import AttitudeCommand, EngineCommand, SeparationCommand, boolean, identifier, number, vector
from .errors import (AstroForgeError, AuthorityTimeout, ClientClosed, ConnectionError,
                     ControlLost, SessionChanged, TelemetryTimeout)
from .models import ConnectionState, Imu, Observation, Session, Snapshot

IDENTITY = tuple(Session.__dataclass_fields__)
KNOWN = {"pylon_session", "pylon_flight_state", "pylon_ground_truth", "pylon_imu",
         "pylon_vehicle_health", "pylon_actuator_manifest", "pylon_actuator_state",
         "pylon_control_authority_state", "pylon_control_snapshot", "pylon_wrench_status"}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _session(packet):
    for key in IDENTITY:
        value = packet.get(key)
        if key == "runtimeGeneration":
            if type(value) is not int or value < 0:
                raise ValueError("invalid generation")
        else:
            identifier(value)
    return Session(**{key: packet[key] for key in IDENTITY})


def _observation(packet):
    if not isinstance(packet, dict) or packet.get("version") != 1:
        raise ValueError("invalid envelope")
    seq = packet.get("observationSequence")
    if type(seq) is not int or seq < 0 or not _finite(packet.get("universalTime")):
        raise ValueError("invalid observation")
    return _session(packet), seq, packet["universalTime"]


def _flight(packet):
    for key in ("altitudeAgl", "altitudeAsl", "verticalSpeed", "horizontalSpeed", "mass",
                "liquidFuel", "oxidizer", "electricCharge", "dynamicPressure", "apoapsis", "periapsis"):
        if not _finite(packet.get(key)):
            raise ValueError(f"invalid {key}")
    for key in ("upBody", "eastBody", "northBody", "angularVelocityBody"):
        vector(packet.get(key), -1e100, 1e100, key)
    boolean(packet.get("landed"), "landed")
    boolean(packet.get("orbitBound"), "orbitBound")


def _actuator(packet):
    identifier(packet.get("name"))
    kind = packet.get("actuatorType")
    if kind == "engine":
        for key in ("available", "operational", "flameout", "enabled", "commandActive"):
            boolean(packet.get(key), key)
        for key in ("thrust", "maxThrust"):
            number(packet.get(key), 0, 1e100, key)
    elif kind == "separation":
        boolean(packet.get("available"), "available")
        boolean(packet.get("separated"), "separated")
    elif kind != "rcs":
        raise ValueError("invalid actuator kind")


class Client:
    """Open a UDP receiver immediately. Construction never acquires control.

    All waits are bounded. Observations returned to callers are defensive copies.
    Command return values are sequences sent, not acknowledgements.
    """

    def __init__(self, host: str = "127.0.0.1", command_port: int = 49011, telemetry_port: int = 49010,
                 *, bind_host: str = "127.0.0.1", controller_id: str | None = None, stale_after: float = 1.0):
        for value in (command_port, telemetry_port):
            if type(value) is not int or not 1 <= value <= 65535:
                raise ValueError("ports must be integers in [1, 65535]")
        self.controller_id = identifier(controller_id or f"python-{uuid.uuid4().hex}")
        self.stale_after = number(stale_after, .1, 60, "stale_after")
        self._cv = threading.Condition(threading.RLock())
        self._acquire_lock = threading.Lock()
        self._stop = threading.Event()
        self._closed = False
        self._session = None
        self._retired = deque(maxlen=32)
        self._observations = {}
        self._snapshot = None
        self._heartbeat = 0.0
        self._available = False
        self._fault = None
        self._io_error = None
        self._controlling = False
        self._pending = False
        self._sequence = 0
        self._lease = uuid.uuid4().hex
        self._lease_seconds = 2.0
        self._priority = 10
        self._suppress_sas = True
        self._lease_until = 0.0
        self._next_renew = 0.0
        self._acquire_sequence = 0
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self._endpoint = (socket.gethostbyname(host), command_port)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            self._socket.bind((bind_host, telemetry_port))
            self._socket.settimeout(.01)
        except OSError as error:
            self._socket.close()
            raise ConnectionError(f"Cannot open UDP :{telemetry_port}: {error}. Check the port and other receivers.") from error
        self._thread = threading.Thread(target=self._receive, name="astroforge-udp", daemon=True)
        self._thread.start()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _check(self, control=False):
        if self._closed:
            raise ClientClosed("Client is closed")
        if self._io_error:
            raise self._io_error
        if control:
            self._health(time.monotonic())
            if self._fault:
                raise self._fault
            if not self._controlling:
                raise ControlLost("Call acquire_control() before sending commands")

    def _fail_control(self, error):
        self._controlling = self._pending = False
        self._fault = error
        self._cv.notify_all()

    def _health(self, now):
        if self._controlling or self._pending:
            if now - self._heartbeat > self.stale_after or not self._snapshot or now - self._snapshot.received_at > self.stale_after:
                self._fail_control(TelemetryTimeout("Telemetry stale; command refresh and lease renewal stopped"))
            elif not self._available:
                self._fail_control(ControlLost("Vehicle is no longer controllable"))
            elif self._controlling and now >= self._lease_until:
                self._fail_control(ControlLost("Lease expired without a confirmed renewal"))

    @property
    def state(self) -> ConnectionState:
        with self._cv:
            now = time.monotonic()
            self._health(now)
            age = now - self._heartbeat if self._heartbeat else None
            snap_age = now - self._snapshot.received_at if self._snapshot else None
            return ConnectionState(not self._closed and not self._io_error and age is not None and age <= self.stale_after,
                                   self._available, self._controlling, age, snap_age,
                                   str(self._io_error or self._fault) if self._io_error or self._fault else None)

    @property
    def snapshot(self) -> Snapshot | None:
        with self._cv:
            return deepcopy(self._snapshot)

    def latest(self, packet_type: str, *, name: str = "") -> Observation[dict] | None:
        """Return a packet with its own observation time; IMU is not part of Snapshot."""
        with self._cv:
            return deepcopy(self._observations.get((packet_type, name)))

    @property
    def imu(self) -> Observation[Imu] | None:
        return cast(Observation[Imu] | None, self.latest("pylon_imu"))

    def wait_until_ready(self, timeout: float = 5.0) -> Snapshot:
        """Wait for fresh observations and acknowledge a recoverable control fault.

        This never reacquires control; receive-only reconnection is also supported.
        """
        deadline = time.monotonic() + number(timeout, .001, 3600, "timeout")
        with self._cv:
            while True:
                self._check()
                now = time.monotonic()
                if self._snapshot and now - self._heartbeat <= self.stale_after and now - self._snapshot.received_at <= self.stale_after:
                    self._fault = None
                    return deepcopy(self._snapshot)
                remaining = deadline - now
                if remaining <= 0:
                    raise TelemetryTimeout("No fresh heartbeat and control snapshot; check UDP ON and ports")
                self._cv.wait(min(.05, remaining))

    def wait_for_snapshot(self, timeout: float = 1.0, *, after: Snapshot | None = None) -> Snapshot:
        """Wait for the next coherent snapshot (or one newer than `after`)."""
        deadline = time.monotonic() + number(timeout, .001, 3600, "timeout")
        with self._cv:
            previous = after if after is not None else self._snapshot
            while True:
                self._check()
                self._health(time.monotonic())
                if self._fault:
                    raise self._fault
                current = self._snapshot
                if current and (previous is None or current.session != previous.session or current.sequence > previous.sequence):
                    if time.monotonic() - current.received_at <= self.stale_after:
                        return deepcopy(current)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TelemetryTimeout("No new coherent snapshot")
                self._cv.wait(min(.05, remaining))

    def _emit(self, fields, *, batch_members=None):
        self._check()
        if not self._session:
            raise TelemetryTimeout("No session; call wait_until_ready()")
        self._sequence += 1
        envelope = dict(version=1, **asdict(self._session), controllerId=self.controller_id,
                        leaseId=self._lease, sequence=self._sequence)
        packet = dict(envelope, **fields)
        if batch_members is not None:
            engines, attitude, separation = batch_members
            packet["engineJson"] = [json.dumps(dict(envelope, **e), allow_nan=False) for e in engines]
            if attitude is not None:
                packet["flightJson"] = json.dumps(dict(envelope, **attitude), allow_nan=False)
            if separation is not None:
                packet["separationJson"] = json.dumps(dict(envelope, **separation), allow_nan=False)
        raw = json.dumps(packet, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(raw) > 32768:
            raise ValueError("Command exceeds the 32768 byte protocol limit")
        try:
            self._socket.sendto(raw, self._endpoint)
        except OSError as error:
            self._io_error = ConnectionError(f"UDP send failed: {error}")
            self._fail_control(self._io_error)
            raise self._io_error from error
        return self._sequence

    def _authority(self, action):
        return self._emit(dict(type="pylon_control_authority_command", action=action, priority=self._priority,
                               leaseDurationSeconds=self._lease_seconds, suppressSas=self._suppress_sas))

    def acquire_control(self, *, timeout: float = 3.0, priority: int = 10,
                        lease_duration: float = 2.0, suppress_sas: bool = True) -> None:
        number(timeout, .001, 3600, "timeout")
        number(lease_duration, .1, 10, "lease_duration")
        if type(priority) is not int or abs(priority) > 2**53 - 1:
            raise ValueError("priority must be a JavaScript-safe integer")
        boolean(suppress_sas, "suppress_sas")
        with self._acquire_lock:
            deadline = time.monotonic() + timeout
            self.wait_until_ready(timeout)
            with self._cv:
                self._check()
                if not self._available:
                    raise ControlLost("Vehicle is unavailable for control")
                if self._controlling:
                    raise ControlLost("Already controlling; release before acquiring again")
                self._fault = None
                self._lease = uuid.uuid4().hex
                self._priority, self._lease_seconds, self._suppress_sas = priority, lease_duration, suppress_sas
                self._pending = True
                self._acquire_sequence = self._authority("acquire")
                while not self._controlling:
                    self._check()
                    self._health(time.monotonic())
                    if self._fault:
                        raise self._fault
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self._pending = False
                        # If acquisition succeeded but its reply was lost, release this lease.
                        self._authority("release")
                        raise AuthorityTimeout("Control acquisition not confirmed; inspect latest authority reason")
                    self._cv.wait(min(.05, remaining))

    def release_control(self) -> int:
        with self._cv:
            self._check(control=True)
            sequence = self._authority("release")
            self._controlling = self._pending = False
            self._cv.notify_all()
            return sequence

    def _command(self, fields):
        with self._cv:
            self._check(control=True)
            return self._emit(fields)

    def set_engine(self, name: str, thrust: float, *, enabled: bool = True, timeout: float = .4,
                   gimbal: tuple[float, float, float] | None = None) -> int:
        return self._command(EngineCommand(name, thrust, enabled, timeout, gimbal).fields())

    def set_attitude(self, *, pitch: float = 0, yaw: float = 0, roll: float = 0,
                     timeout: float = .4, landing_gear: bool = False) -> int:
        return self._command(AttitudeCommand(pitch, yaw, roll, timeout, landing_gear).fields())

    def set_rcs(self, name: str, thrust_limit: float = 250, *, enabled: bool = True, timeout: float = .4) -> int:
        return self._command(dict(type="pylon_actuator_command", actuatorType="rcs", name=identifier(name),
                                  thrustLimit=number(thrust_limit, 0, 1e8, "thrust_limit"),
                                  enabled=boolean(enabled, "enabled"), timeoutSeconds=number(timeout, .05, 10, "timeout")))

    def separate(self, name: str) -> int:
        return self._command(SeparationCommand(name).fields())

    def set_wrench(self, force: list[float] | tuple[float, float, float],
                   torque: list[float] | tuple[float, float, float], *, timeout: float = .4) -> int:
        return self._command(dict(type="pylon_body_wrench_command", frame="base_link",
                                  force=vector(force, -1e8, 1e8, "force"), torque=vector(torque, -1e8, 1e8, "torque"),
                                  timeoutSeconds=number(timeout, .05, 10, "timeout")))

    def send_batch(self, engines: list[EngineCommand] | tuple[EngineCommand, ...] = (), *,
                   attitude: AttitudeCommand | None = None, separation: SeparationCommand | None = None,
                   renew_lease: bool = True) -> int:
        boolean(renew_lease, "renew_lease")
        engines = tuple(engines)
        if len(engines) > 16 or any(not isinstance(e, EngineCommand) for e in engines):
            raise ValueError("batch requires at most 16 EngineCommand values")
        if len({e.name for e in engines}) != len(engines):
            raise ValueError("duplicate engine in batch")
        if attitude is not None and not isinstance(attitude, AttitudeCommand):
            raise ValueError("attitude must be AttitudeCommand")
        if separation is not None and not isinstance(separation, SeparationCommand):
            raise ValueError("separation must be SeparationCommand")
        members = ([e.fields() for e in engines], attitude.fields() if attitude else None,
                   separation.fields() if separation else None)
        for member in [*members[0], *([members[1]] if members[1] else [])]:
            number(member["timeoutSeconds"], .05, 1, "batch timeout")
        with self._cv:
            self._check(control=True)
            return self._emit(dict(type="pylon_control_batch", hasFlight=attitude is not None,
                                   hasSeparation=separation is not None, renewLease=renew_lease,
                                   leaseDurationSeconds=self._lease_seconds, suppressSas=self._suppress_sas),
                              batch_members=members)

    def emergency_stop(self) -> int:
        with self._cv:
            self._check()
            if time.monotonic() - self._heartbeat > self.stale_after:
                raise TelemetryTimeout("Cannot emergency-stop an unknown or stale session")
            sequence = self._authority("emergency_stop")
            self._fail_control(ControlLost("Emergency stop requested"))
            return sequence

    def clear_emergency_stop(self) -> int:
        with self._cv:
            self._check()
            if time.monotonic() - self._heartbeat > self.stale_after:
                raise TelemetryTimeout("Session stale")
            return self._authority("clear_emergency_stop")

    def _accept(self, packet, now):
        session, seq, sim_time = _observation(packet)
        kind = packet.get("type")
        if kind not in KNOWN:
            return
        if kind == "pylon_session":
            boolean(packet.get("available"), "available")
            if session != self._session:
                if session in self._retired:
                    return
                if self._session:
                    if session.runtimeInstance == self._session.runtimeInstance and session.runtimeGeneration < self._session.runtimeGeneration:
                        return
                    self._retired.append(self._session)
                    self._fail_control(SessionChanged("Flight session changed; explicitly acquire again"))
                self._session = session
                self._observations.clear()
                self._snapshot = None
        elif session != self._session:
            return
        name = packet.get("name", "") if kind == "pylon_actuator_state" else ""
        key = (kind, name)
        old = self._observations.get(key)
        if old and (seq < old.sequence or seq == old.sequence and kind != "pylon_control_authority_state"):
            return
        if kind == "pylon_session":
            self._heartbeat, self._available = now, packet["available"]
        elif kind == "pylon_flight_state":
            _flight(packet)
        elif kind == "pylon_actuator_state":
            _actuator(packet)
        elif kind == "pylon_actuator_manifest":
            members = packet.get("actuators")
            if not isinstance(members, list) or len(members) > 256:
                raise ValueError("invalid manifest")
            for member in members:
                identifier(member.get("name"))
                if member.get("actuatorType") not in {"engine", "rcs", "separation"}:
                    raise ValueError("invalid manifest type")
        elif kind == "pylon_imu":
            vector(packet.get("angularVelocity"), -1e100, 1e100, "angularVelocity")
            vector(packet.get("linearAcceleration"), -1e100, 1e100, "linearAcceleration")
        elif kind == "pylon_control_snapshot":
            flight, engines, separations = packet.get("flight"), packet.get("engines"), packet.get("separations")
            if not isinstance(engines, list) or not isinstance(separations, list) or len(engines) + len(separations) > 256:
                raise ValueError("invalid snapshot")
            for member in [flight, *engines, *separations]:
                if _observation(member) != (session, seq, sim_time):
                    raise ValueError("incoherent snapshot")
            if flight.get("type") != "pylon_flight_state":
                raise ValueError("invalid snapshot flight")
            _flight(flight)
            for members, expected in ((engines, "engine"), (separations, "separation")):
                if len({m.get("name") for m in members}) != len(members):
                    raise ValueError("duplicate snapshot member")
                for member in members:
                    _actuator(member)
                    if member.get("type") != "pylon_actuator_state" or member["actuatorType"] != expected:
                        raise ValueError("invalid snapshot actuator")
            self._snapshot = Snapshot(session, seq, sim_time, now, flight, tuple(engines), tuple(separations))
        elif kind == "pylon_control_authority_state":
            if type(packet.get("state")) is not int or packet["state"] not in (0, 1, 2):
                raise ValueError("invalid authority")
            number(packet.get("leaseRemainingSeconds"), 0, 10, "lease remaining")
            if type(packet.get("lastSequence")) is not int or packet["lastSequence"] < 0:
                raise ValueError("invalid authority sequence")
            own = packet.get("controllerId") == self.controller_id and packet.get("leaseId") == self._lease and packet["state"] == 1
            if own and old and old.data.get("leaseId") == self._lease and packet["lastSequence"] < old.data.get("lastSequence", 0):
                return
            if own and (self._pending or self._controlling):
                if packet["lastSequence"] >= self._acquire_sequence:
                    self._lease_until = now + packet["leaseRemainingSeconds"]
                    if self._pending:
                        self._pending = False
                        self._controlling = True
                        self._next_renew = now + self._lease_seconds / 3
            elif self._controlling:
                self._fail_control(ControlLost(f"Authority lost: {packet.get('reason', 'unknown')}"))
        if key not in self._observations and len(self._observations) >= 300:
            self._observations.pop(next(iter(self._observations)))
        self._observations[key] = Observation(session, seq, sim_time, now, packet)
        self._cv.notify_all()

    def _receive(self):
        try:
            while not self._stop.is_set():
                try:
                    raw, sender = self._socket.recvfrom(65535)
                except socket.timeout:
                    raw = None
                except ConnectionResetError:
                    # Windows reports a UDP ICMP port-unreachable here during server restarts.
                    with self._cv:
                        if self._controlling or self._pending:
                            self._fail_control(ControlLost("UDP peer unavailable; explicitly reconnect control"))
                    raw = None
                if raw and sender == self._endpoint:
                    try:
                        packet = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                        with self._cv:
                            self._accept(packet, time.monotonic())
                    except (ValueError, TypeError, KeyError, AttributeError, RecursionError, OverflowError):
                        pass  # Malformed datagrams must not kill the receiver.
                with self._cv:
                    now = time.monotonic()
                    self._health(now)
                    if self._controlling and now >= self._next_renew:
                        self._authority("renew")
                        self._next_renew = now + self._lease_seconds / 3
        except Exception as error:
            with self._cv:
                if not self._closed:
                    self._io_error = ConnectionError(f"UDP receiver stopped: {error}")
                    self._fail_control(self._io_error)

    def close(self) -> None:
        """Best-effort release, then close/join. Does not claim a confirmed stop."""
        with self._cv:
            if self._closed:
                return
            try:
                self._health(time.monotonic())
                if self._controlling:
                    # Release clears engine, attitude, RCS and wrench commands together.
                    self._authority("release")
            except AstroForgeError:
                pass
            finally:
                self._controlling = self._pending = False
                self._closed = True
                self._stop.set()
                self._socket.close()
                self._cv.notify_all()
        self._thread.join(timeout=1.0)
