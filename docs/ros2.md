# 外部PyLoNからROS2を接続する

AstroForgeはPyLoN v1互換のUDPを提供します。ROS2 bridge・メッセージ定義・汎用制御ノードのソースはAstroForgeに同梱せず、[PyLoN](https://github.com/PyLoN-sim/PyLoN)を別リポジトリとして取得して利用します。AstroForge本体のビルド・起動や直接のUDP通信にはPyLoNのcloneもROS2も不要です。

## 取得とビルド

ROS2 Jazzyをインストールした環境で、PyLoNと専用ワークスペースを用意します。以下のリビジョンはAstroForgeとの互換性を検証したものです。別のリビジョンを利用する場合は後述のチェックで確認してください。KSPのインストールやMODのビルド・同期は不要です。

```bash
mkdir -p "$HOME/src"
git clone https://github.com/PyLoN-sim/PyLoN.git "$HOME/src/PyLoN"
git -C "$HOME/src/PyLoN" checkout d62d948064d6665702d05957a669596244dca8da
export PYLON_ROOT="$HOME/src/PyLoN"
source /opt/ros/jazzy/setup.bash
mkdir -p "$HOME/pylon_ws"
cd "$HOME/pylon_ws"
rosdep install --from-paths "$PYLON_ROOT/Ros2" --ignore-src --rosdistro jazzy -y
colcon build --base-paths "$PYLON_ROOT/Ros2" --packages-up-to pylon_bridge pylon_vehicle_control
source install/setup.bash
```

## bridgeと制御ノード

AstroForgeで対象機体のUDPをONにし、画面の実際のポートを指定します。

```bash
ros2 run pylon_bridge udp_bridge --host 127.0.0.1 --port 49010 --command-port 49011
```

bridgeは本体とは別プロセスで動作し、公開UDPだけで通信します。機体ごとに1つ起動し、複数機体を扱うときはROS domainを分けるか、topic・frameのprefixを分けます。互換性のため既定のtopic名は`/ksp_vessel`です。

汎用制御ノードは、同じワークスペースをsourceした別ターミナルで起動できます。

```bash
source /opt/ros/jazzy/setup.bash
source "$HOME/pylon_ws/install/setup.bash"
ros2 run pylon_vehicle_control setpoint_controller --ros-args \
  -p controller_id:=astroforge-controller
```

`/ksp_vessel/control/setpoint`へ`pylon_interfaces/msg/ControlSetpoint`を10〜20 Hzで送ります。`pylon_ground_truth_enu`の位置・quaternionと新鮮なground-truth timestampを使い、6自由度制御は`mode: 3`です。ノードはleaseを取得してbody wrenchを指令し、入力や観測が古くなれば制御権を解放します。既定の力上限2,000 Nでは初期ロケットは離陸できないため、機体に合った推力上限・ゲイン・電力が必要です。

軌道投入デモのSpaceROSビルドでは、同じ外部PyLoNを`PYLON_ROOT`で指定します。[Pathfinder3の手順](https://github.com/Ampoi/AstroForge/blob/main/examples/pathfinder3/README.md)を参照してください。

## 互換性チェック

AstroForgeのルートで実行します。先頭3つはROS2を起動せず、指定したPyLoNの変換関数とbridge runtimeを使います。

```bash
export PYLON_ROOT=/path/to/PyLoN
python3 tests/upstream_compatibility.py "$PYLON_ROOT" --systems
python3 tests/upstream_compatibility.py "$PYLON_ROOT" --rover
python3 tests/bridge_roundtrip.py "$PYLON_ROOT"
# 外部PyLoNをビルドしたROS2ワークスペースをsourceしてから実行
source "$HOME/pylon_ws/install/setup.bash"
python3 tests/ros2-systems-smoke.py
```

最後のテストは隔離した物理・UDP fixtureと実際のROS2 bridge・制御ノードをDDS domain 187で起動します。センサー・URDF/TF・温度・近隣機体・車輪のtopic、motor、ドッキングカメラ、分離結果と照会service、制御ノードのwrenchを確認します。アプリのHTTPサーバーは起動せず、保存機体も読みません。

対応範囲とKSPとの差は[UDP仕様](./protocol#pylonとの対応範囲)を参照してください。
