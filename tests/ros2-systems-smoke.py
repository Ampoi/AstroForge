#!/usr/bin/env python3
"""Actual DDS topics/services/controller ↔ external PyLoN bridge ↔ AstroForge UDP.
Source the ROS2 workspace built from the separate PyLoN checkout. Uses a private DDS
 domain and ephemeral UDP ports; never starts or changes the user's app server.
"""
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import time

# Restrict the test graph to an isolated ROS domain before importing rclpy.
os.environ['ROS_DOMAIN_ID'] = '187'
os.environ['ROS_LOCALHOST_ONLY'] = '1'
os.environ['ROS_LOG_DIR'] = tempfile.mkdtemp(prefix='astroforge-ros-logs-')
import rclpy
from rclpy.qos import qos_profile_sensor_data, QoSProfile, DurabilityPolicy
from sensor_msgs.msg import LaserScan, PointCloud2, Image, CameraInfo, JointState
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped
from tf2_msgs.msg import TFMessage
from pylon_interfaces.msg import (PartThermalState, NearbyVessels, DockingPortState,
    StarTrackerState, WheelState, ControlAuthorityState, ControlAuthorityCommand,
    MotorCommand, DockingPortCommand, SeparationCommand, SeparationResult,
    ControlSetpoint, WrenchFeedback)
from pylon_interfaces.srv import GetSeparationResult

root = Path(__file__).resolve().parents[1]
processes = []
logs = tempfile.TemporaryFile(mode='w+')
rclpy.init()
node = rclpy.create_node('astroforge_systems_smoke')
received = {}
subscriptions = []
latched = QoSProfile(depth=128, durability=DurabilityPolicy.TRANSIENT_LOCAL)
def subscribe(kind, topic, key, qos=qos_profile_sensor_data):
    subscriptions.append(node.create_subscription(kind, topic, lambda msg: received.__setitem__(key, msg), qos))
def wait(predicate, timeout=12, publish=None):
    deadline = time.monotonic()+timeout
    while time.monotonic()<deadline:
        if any(p.poll() is not None for p in processes):
            raise AssertionError('a test process exited early')
        if publish: publish()
        rclpy.spin_once(node, timeout_sec=.05)
        if predicate(): return
    raise AssertionError('timed out; received '+', '.join(received))
def start(args):
    p = subprocess.Popen(args, cwd=root, env=os.environ.copy(), stdout=logs, stderr=logs)
    processes.append(p)
    return p
try:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as reserve:
        reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
    fixture = subprocess.Popen(['node','--import','tsx','tests/ros2-systems-driver.js',str(port)], cwd=root,
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=logs,text=True)
    processes.append(fixture)
    assert select.select([fixture.stdout],[],[],5)[0]
    command_port=json.loads(fixture.stdout.readline())['commandPort']
    start([sys.executable,'-m','pylon_bridge.udp_bridge','--host','127.0.0.1','--port',str(port),
        '--command-port',str(command_port)])
    base='/ksp_vessel'
    for kind,topic,key in [
        (LaserScan,'/lidar_2d/lidar2d/scan','scan'),(PointCloud2,'/lidar_3d/lidar3d/points','points'),
        (Image,'/camera/camera/image_raw','image'),(CameraInfo,'/camera/camera/camera_info','intrinsics'),
        (JointState,'/joint_states','joints'),(PartThermalState,'/health/thermal','thermal'),
        (NearbyVessels,'/ground_truth/nearby_vessels','nearby'),(StarTrackerState,'/star_tracker/startracker/state','star'),
        (DockingPortState,'/docking_ports/docking/state','dock'),(WheelState,'/actuators/wheel/state','wheel'),
        (ControlAuthorityState,'/control/authority/state','authority'),(PoseStamped,'/ground_truth/pose','pose'),
        (WrenchFeedback,'/control/wrench_feedback','wrench')]: subscribe(kind,base+topic,key)
    subscribe(String,base+'/robot_description','urdf',latched)
    subscribe(TFMessage,'/tf','tf')
    subscribe(SeparationResult,base+'/actuators/separation/result','receipt',latched)
    wait(lambda: all(k in received for k in ['scan','points','image','intrinsics','joints','thermal','nearby','star','dock','wheel','authority','pose','urdf','tf']))
    assert len(received['scan'].ranges)==360
    assert received['image'].width==64 and len(received['image'].data)==64*48*3
    assert received['intrinsics'].k[0]>0 and received['wheel'].radius==.45
    assert '<robot' in received['urdf'].data
    authority=node.create_publisher(ControlAuthorityCommand,base+'/control/authority/command',10)
    motor=node.create_publisher(MotorCommand,base+'/actuators/servo/command',10)
    docking=node.create_publisher(DockingPortCommand,base+'/docking_ports/docking/command',10)
    separate=node.create_publisher(SeparationCommand,base+'/actuators/separation/command',10)
    vessel=received['nearby'].observer_vessel_id
    seq=0
    def identity(msg):
        global seq
        seq+=1;msg.vessel_id=vessel;msg.controller_id='systems-smoke';msg.lease_id='smoke';msg.sequence=seq
        return msg
    def acquire():
        msg=identity(ControlAuthorityCommand());msg.action=msg.ACTION_ACQUIRE;msg.priority=200;msg.lease_duration_sec=10.;msg.suppress_sas=False;authority.publish(msg)
    wait(lambda: received['authority'].controller_id=='systems-smoke' and received['authority'].state==1,publish=acquire)
    def move():
        msg=identity(MotorCommand());msg.id='hinge';msg.enabled=True;msg.mode=msg.MODE_POSITION;msg.position=.3;msg.timeout_sec=.5;motor.publish(msg)
    wait(lambda: 'hinge' in received['joints'].name and received['joints'].position[list(received['joints'].name).index('hinge')]>.15,publish=move)
    subscribe(Image,base+'/docking_ports/docking/camera/image_raw','port_image')
    def camera():
        msg=identity(DockingPortCommand());msg.action=1;docking.publish(msg)
    wait(lambda:'port_image' in received,publish=camera)
    def stage():
        msg=identity(SeparationCommand());msg.id='separator';msg.separate=True;msg.operation_id='ros-smoke-separation';separate.publish(msg)
    wait(lambda:'receipt' in received and received['receipt'].success,publish=stage)
    client=node.create_client(GetSeparationResult,base+'/actuators/separation/get_result')
    assert client.wait_for_service(timeout_sec=3)
    receipt=received['receipt'];request=GetSeparationResult.Request()
    for key in ('operation_id','original_runtime_instance','original_runtime_epoch','original_vessel_id'):setattr(request,key,getattr(receipt,key))
    future=client.call_async(request);wait(future.done);assert future.result().found and future.result().result.success
    msg=identity(ControlAuthorityCommand());msg.action=msg.ACTION_RELEASE;authority.publish(msg)
    wait(lambda:received['authority'].state==0)
    start(['ros2','run','pylon_vehicle_control','setpoint_controller','--ros-args','-p','controller_id:=smoke-controller'])
    setpoints=node.create_publisher(ControlSetpoint,base+'/control/setpoint',10)
    def setpoint():
        pose=received['pose'];msg=ControlSetpoint();msg.header=pose.header;msg.mode=msg.MODE_SIX_DOF
        msg.position=pose.pose.position;msg.position.x+=.1;msg.orientation=pose.pose.orientation;setpoints.publish(msg)
    wait(lambda:received['authority'].controller_id=='smoke-controller' and 'wrench' in received and received['wrench'].accepted,timeout=15,publish=setpoint)
    print('PASS: real ROS2 sensor/model/TF/health/wheel topics, motor and docking-camera commands, separation receipt service, and setpoint controller wrench round-trip.')
except Exception:
    logs.seek(0);print(logs.read(),file=sys.stderr)
    raise
finally:
    for p in reversed(processes):
        p.terminate()
    for p in reversed(processes):
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
    node.destroy_node();rclpy.shutdown();logs.close()
