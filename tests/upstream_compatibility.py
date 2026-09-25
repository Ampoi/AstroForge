#!/usr/bin/env python3
"""Validate against an independently checked-out PyLoN, without installing ROS.
Usage: python3 tests/upstream_compatibility.py /path/to/PyLoN
"""
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

if len(sys.argv) not in (2, 3):
    raise SystemExit(__doc__)
sys.path.insert(0, str(Path(sys.argv[1]) / 'Ros2' / 'pylon_bridge'))
from pylon_bridge.protocol import decode_datagram, encode_datagram
from pylon_bridge.domain.session import SessionTracker
from pylon_bridge.domain.control import authority_state_from_packet, wrench_feedback_from_packet
from pylon_bridge.flight_packets import flight_state_from_packet, flight_control_command
from pylon_bridge.simulator_packets import simulator_state_from_packet
from pylon_bridge.imu_packets import imu_from_packet
from pylon_bridge.health_packets import vehicle_health_from_packet, part_thermal_state_from_packet
from pylon_bridge.vehicle_packets import nearby_vessels_from_packet
from pylon_bridge.vessel_model import UrdfChunkAssembler
from pylon_bridge.docking_packets import docking_port_manifest_from_packet,docking_port_state_from_packet
from pylon_bridge.motor_packets import motor_state_from_packet
from pylon_bridge.camera_packets import CameraFrameAssembler
from pylon_bridge.star_tracker_packets import star_tracker_from_packet
from pylon_bridge.packet_conversion import laser_scan_from_packet,points_from_packet
from pylon_bridge.separation_packets import separation_result_from_packet
from pylon_bridge.observations import control_snapshot_from_packet
from pylon_bridge.vehicle_packets import (ground_truth_from_packet, actuator_manifest_from_packet,
    actuator_state_from_packet, control_authority_command, actuator_command, body_wrench_command)

model_assembler = UrdfChunkAssembler()
camera_assembler = CameraFrameAssembler()
parsers = {'pylon_lidar_scan':lambda p: laser_scan_from_packet(p) if p['mode']=='2D' else points_from_packet(p), 'pylon_camera_frame_chunk':camera_assembler.consume, 'pylon_star_tracker':star_tracker_from_packet,'pylon_motor_state':motor_state_from_packet,'pylon_docking_port_manifest':docking_port_manifest_from_packet,'pylon_docking_port_state':docking_port_state_from_packet,'pylon_part_thermal_state':part_thermal_state_from_packet, 'pylon_nearby_vessels':nearby_vessels_from_packet, 'pylon_vessel_urdf_chunk':model_assembler.consume, 'pylon_separation_result':separation_result_from_packet,'pylon_session': simulator_state_from_packet, 'pylon_flight_state': flight_state_from_packet,
    'pylon_ground_truth': ground_truth_from_packet, 'pylon_actuator_manifest': actuator_manifest_from_packet,
    'pylon_actuator_state': actuator_state_from_packet, 'pylon_control_authority_state': authority_state_from_packet,
    'pylon_wrench_status': wrench_feedback_from_packet, 'pylon_imu': imu_from_packet,
    'pylon_vehicle_health': vehicle_health_from_packet, 'pylon_control_snapshot': control_snapshot_from_packet}
root = Path(__file__).resolve().parents[1]
proc = subprocess.Popen(['node', '--import', 'tsx', 'tests/compatibility-driver.js'] + [flag for flag in ('--rover','--systems') if flag in sys.argv], cwd=root,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
try:
    packets = json.loads(proc.stdout.readline())
    tracker = SessionTracker()
    assert tracker.observe(packets[0], 0)
    session = tracker.command_fields(0, 1)
    vessel = packets[0]['vesselId']
    count = 0
    def validate(packets):
        global count
        for packet in packets:
            decoded = decode_datagram(encode_datagram(packet))
            assert tracker.accepts(decoded)
            parsers[packet['type']](decoded)
            count += 1
    validate(packets)
    commands = [
        control_authority_command('acquire', vessel, 'upstream-test', 'lease', 1, 2, True, 1),
        actuator_command('engine', 'engine_1', {'targetThrust':60000,'timeoutSeconds':.5,
            'hasGimbalCommand':True,'gimbalPitch':.2,'gimbalYaw':-.1}, 2, vessel, 'upstream-test', 'lease'),
        flight_control_command(SimpleNamespace(vessel_id=vessel, controller_id='upstream-test',
            lease_id='lease', sequence=3, pitch=.1, yaw=0., roll=0., landing_gear=False, timeout_sec=.5)),
        actuator_command('rcs', 'rcs_1', {'thrustLimit':250,'timeoutSeconds':.5}, 4, vessel, 'upstream-test', 'lease'),
        body_wrench_command((60000.,0.,0.), (0.,10.,0.), 5, .5, vessel, 'upstream-test', 'lease'),
        actuator_command('separation', 'separator_1', {'separate': True}, 6, vessel, 'upstream-test', 'lease'),
        control_authority_command('release', vessel, 'upstream-test', 'lease', 1, 2, True, 7)
    ]
    if '--rover' in sys.argv:
        commands = [commands[0],
            actuator_command('wheel', 'wheel_front_left', {'targetAngularVelocity':12.,
                'steeringAngle':.2,'maxDriveTorque':90.,'brake':0.,'timeoutSeconds':.5},
                2, vessel, 'upstream-test', 'lease'),
            actuator_command('wheel', 'wheel_front_left', {'enabled':False,'targetAngularVelocity':0.,
                'steeringAngle':0.,'maxDriveTorque':90.,'brake':1.,'timeoutSeconds':.5},
                3, vessel, 'upstream-test', 'lease'), commands[-1]]
    if '--systems' in sys.argv:
        commands[1:1] = [dict(type='pylon_motor_command',version=1,name='hinge',
            vesselId=vessel,controllerId='upstream-test',leaseId='lease',sequence=1,
            hasEnabled=True,enabled=True,mode='position',hasPosition=True,position=.2,timeoutSeconds=.5)]
    for command in commands:
        command.update(session)
        proc.stdin.write(encode_datagram(command).decode()+'\n')
        proc.stdin.flush()
        result = json.loads(proc.stdout.readline())
        assert result['result']['reason'] in ('lease_acquired','command_accepted','lease_released'), result
        validate(result['packets'])
        if command.get('actuatorType') == 'wheel':
            state = next(p for p in result['packets'] if p.get('name') == 'wheel_front_left' and p['type'] == 'pylon_actuator_state')
            assert state['radius'] == .45 and state['wheelCount'] == 4
            assert state['steeringAngle'] == command['steeringAngle']
            assert state['enabled'] == command['enabled']
            assert 0 < state['maxDriveTorque'] <= 90
        if command.get('hasGimbalCommand'):
            state = next(p for p in result['packets'] if p['type']=='pylon_actuator_state' and p['name']=='engine_1')
            assert state['gimbalPitch'] == .2 and state['gimbalYaw'] == -.1
        if command.get('actuatorType') == 'separation':
            state = next(p for p in result['packets'] if p.get('name') == 'separator_1' and p['type'] == 'pylon_actuator_state')
            assert state['separated'] and not state['available']
    print(f'PASS: {count} telemetry packets decoded by upstream; {len(commands)} upstream-encoded commands accepted.')
finally:
    proc.stdin.close()
    proc.wait(timeout=5)
