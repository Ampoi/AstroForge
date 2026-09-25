from types import SimpleNamespace as NS
import math
import pytest
from pathfinder3.guidance import OrbitGuidance


def vec(x=0, y=0, z=0):
    return NS(x=x, y=y, z=z)


def snapshot(**updates):
    f = dict(universal_time=0., altitude_asl=15., apoapsis=15., periapsis=-6000000.,
             mass=15000., gravity=9.81, body_radius=6371000., gravitational_parameter=3.986e14,
             vertical_speed=0., horizontal_speed=0., body_name='Earth', atmosphere_depth=150000.,
             up_body=vec(1), east_body=vec(0, 1), angular_velocity_body=vec(),
             orbital_velocity_body=vec(0, 465), landed=True)
    f.update(updates)
    return NS(flight=NS(**f), engines=[NS(name='first', id='opaque1', flameout=False, operational=True, max_thrust=350000.),
                                      NS(name='second', id='opaque2', flameout=False, operational=False, max_thrust=0.)],
              separations=[NS(name='ring', id='opaque3', separated=False)])


def test_configuration_requires_explicit_unique_burn_order():
    for engines, rings in [([], []), (['a', 'b'], []), (['a', 'a'], ['r'])]:
        with pytest.raises(ValueError):
            OrbitGuidance(engines, rings)
    with pytest.raises(ValueError):
        OrbitGuidance(['a'], [], float('nan'))


def test_wait_for_separation_confirmation_and_clearance_before_ignition():
    g = OrbitGuidance(['first', 'second'], ['ring'])
    s = snapshot()
    assert g.update(s).thrust > 0
    s.flight.universal_time = 90
    s.flight.landed = False
    s.engines[0].flameout = True
    assert g.update(s).separation == 'ring'
    s.flight.universal_time += .5
    assert g.update(s).thrust == 0
    s.separations[0].separated = True
    s.engines[1].operational, s.engines[1].max_thrust = True, 80000.
    assert g.update(s).thrust == 0
    s.flight.universal_time += .5
    assert g.update(s).thrust == 0
    s.flight.universal_time += 1
    d = g.update(s)
    assert d.engine == 'second' and d.thrust > 0 and g.stage == 1


def test_altitude_alone_does_not_count_as_orbit_and_cutoff_is_latched():
    g = OrbitGuidance(['first'], [])
    s = snapshot()
    g.update(s)
    s.flight.landed = False
    s.flight.altitude_asl = s.flight.apoapsis = 200000.
    assert not g.update(s).complete
    assert g.cutoff_at is None
    s.flight.periapsis = 196000.
    s.flight.universal_time = 300
    assert g.update(s).thrust == 0
    s.flight.universal_time = 359
    assert not g.update(s).complete
    s.flight.universal_time = 360
    assert g.update(s).complete
    s.flight.periapsis = 100000.
    with pytest.raises(ValueError, match='acceptance'):
        g.update(s)


def test_corrupt_telemetry_and_wrong_body_fail_closed():
    for updates in [dict(mass=0), dict(vertical_speed=math.nan), dict(body_name='Mars')]:
        with pytest.raises(ValueError):
            OrbitGuidance(['first'], []).update(snapshot(**updates))


def test_missing_or_exhausted_engine_never_switches_to_an_arbitrary_target():
    g = OrbitGuidance(['missing'], [])
    with pytest.raises(ValueError, match='absent'):
        g.update(snapshot())
    g = OrbitGuidance(['first'], [])
    s = snapshot()
    s.engines[0].flameout = True
    with pytest.raises(ValueError, match='fuel exhausted'):
        g.update(s)


def test_terminal_thrust_and_attitude_share_the_same_acceleration_demand():
    g = OrbitGuidance(['first', 'second'], ['ring'])
    s = snapshot()
    g.update(s)
    g.stage = 1
    s.engines[1].operational, s.engines[1].max_thrust = True, 80000.
    s.flight.landed = False
    s.flight.altitude_asl = 199000.
    s.flight.apoapsis, s.flight.periapsis = 300000., 180000.
    s.flight.mass = 1100.
    s.flight.gravity = s.flight.gravitational_parameter/(s.flight.body_radius+s.flight.altitude_asl)**2
    circular = math.sqrt(s.flight.gravitational_parameter/(s.flight.body_radius+s.flight.altitude_asl))
    s.flight.orbital_velocity_body = vec(20., circular-5.)
    d = g.update(s)
    assert 0 < d.thrust < 1000  # Full 80 kN would overshoot the orbital speed.
    assert -1 <= d.yaw <= 1
