from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    defaults = {'host': '127.0.0.1', 'telemetry_port': '49310', 'command_port': '49311',
                'engines': 'booster_engine,upper_engine', 'separators': 'stage_separator',
                'target_altitude': '200000.0', 'output_dir': '/tmp/pathfinder3-flight'}
    return LaunchDescription([
        *[DeclareLaunchArgument(k, default_value=v) for k, v in defaults.items()],
        Node(package='pylon_bridge', executable='udp_bridge', output='screen',
             arguments=['--host', LaunchConfiguration('host'), '--port', LaunchConfiguration('telemetry_port'),
                        '--command-port', LaunchConfiguration('command_port')]),
        Node(package='pathfinder3', executable='orbit_controller', output='screen',
             parameters=[{k: ParameterValue(LaunchConfiguration(k), value_type=float if k == 'target_altitude' else str)
                          for k in ('engines', 'separators', 'target_altitude', 'output_dir')}]),
    ])
