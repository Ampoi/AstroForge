from setuptools import setup
from glob import glob
setup(name='pathfinder3', version='0.1.0', packages=['pathfinder3'],
      data_files=[('share/ament_index/resource_index/packages', ['resource/pathfinder3']),
                  ('share/pathfinder3', ['package.xml']),
                  ('share/pathfinder3/launch', glob('launch/*.launch.py'))],
      install_requires=['setuptools'], tests_require=['pytest'],
      maintainer='ampoi', maintainer_email='ampoi@users.noreply.github.com',
      description='Independent ROS2 orbital ascent client for public PyLoN UDP', license='MIT',
      entry_points={'console_scripts': ['orbit_controller = pathfinder3.node:main']})
