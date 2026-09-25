# センサー・可動機構・ドッキング・ROS2

パーツ一覧の「すべて」からセンサー、回転サーボ、直動モーター、ドッキングポートを追加できます。機体の保存・配置は従来と共通です。パーツIDがUDPの対象名になります。センサーIDは上流と同じROS名へ正規化します（小文字化、連続・前後の`_`の整理、数字で始まる場合の`_`付加）。

以下はAstroForgeの教育・制御実験向けモデルです。PyLoNのUDP形式とSI単位を使い、別途取得するPyLoNの標準bridgeへ接続できます。KSPの描画・接触・部品強度を再現するものではありません。

## 搭載センサー

センサーは側面へ取り付け、外向きの方向を観測します。取り付け角度と位置はエディターで変更できます。1機体につき最大8個です。電源がある間、シミュレーション時間で5 Hzにサンプリングし、次のUDP配信周期で送信します。搭載センサー1個につき8 Wを消費します。

| パーツ | 配信とモデル |
| --- | --- |
| `lidar2d` | `pylon_lidar_scan`, `mode:"2D"`。360方向・360°、最大2,000 m。未検出はJSON `null`、ROSでは無限大。自己機体を除くパーツ近似球と球面地表への距離を測る |
| `lidar3d` | 同パケットの`mode:"3D"`。512方向のFibonacci半球。`ranges`と`layout:"fibonacci-hemisphere"`から標準bridgeがPointCloud2を生成 |
| `camera` | `pylon_camera_frame_chunk`。64×48・上端始まりのRGB8、垂直視野60°。SHA-256付きbase64画像。パーツ近似球・地表へのレイキャストで生成。ブラウザの表示状態には依存しない |
| `startracker` | `pylon_star_tracker`。姿勢quaternionに標準偏差0.0001 radの回転誤差を加える。高度80 km未満、太陽から35°以内、地球の視野侵入、中心視線の機体遮蔽、5°/s超の角速度、無電源で無効。条件回復から1秒で再捕捉 |

カメラは形状とパーツ色を観測する低解像度のソフトウェアレンダラーです。雲、地表テクスチャ、排気、発射設備は写りません。LiDARにもこれらの表示物は含まれません。スタートラッカーは星画像からの星同定を行わず、誤差・可視条件を含む姿勢観測モデルです。無効時は`orientation:null`を送り、古い姿勢を有効な観測として再送しません。

`framePosition` / `frameRotation`は所有パーツのローカル座標です。URDFの`partFlightId`と対応し、関節で動かしたセンサーも取り付け姿勢に従います。標準bridgeがカメラ光学座標（右・下・前）とCameraInfoの内部パラメーターを生成します。スタートラッカーの`referenceFrame:"kerbol_inertial"`は上流との互換名です。AstroForgeではECIと同じ固定方向の慣性軸を表し、Kerbol天体の存在を意味しません。

## 回転サーボ・直動モーター

スタックの途中に`servo`または`linear`を挟むと、そこから機首側のパーツと側面パーツが動きます。多関節の直列構成にも対応します。

| パーツ | 位置 | 速度上限 | 努力上限 |
| --- | --- | --- | --- |
| `servo` | 関節ローカルZ軸まわり−π/2〜π/2 rad | 1 rad/s | 180 N·m |
| `linear` | 関節ローカルX軸方向0〜2 m | 0.5 m/s | 1,500 N |

以下へ共通のセッション・lease・sequenceを付けて送信します。

```json
{
  "type": "pylon_motor_command",
  "name": "hinge",
  "hasEnabled": true,
  "enabled": true,
  "mode": "position",
  "hasPosition": true,
  "position": 0.4,
  "timeoutSeconds": 0.5
}
```

`mode:"velocity"`では`hasVelocity:true, velocity`、`mode:"effort"`では`hasEffort:true, effort`を使います。位置はradまたはm、速度はrad/sまたはm/s、努力はN·mまたはNです。期限は実時間0.05〜10秒。無効化・指令失効・lease喪失・電源切れで現在位置にロックします。

`pylon_motor_state`と`pylon_actuator_state`の`actuatorType:"motor"`を配信します。位置・速度・努力・推定電流・目標・給電状態・ロック状態を確認できます。標準bridgeの指令Topicは`/ksp_vessel/actuators/servo/command`です。直動もこのTopicの`MotorCommand.id`で選択し、JointStateも配信します。

関節運動はパーツの位置・姿勢、重心・慣性、推力方向、フィン法線、センサー、機体間衝突、表示へ反映します。内部運動量に対する機体の反動を計算します。関節駆動は負荷慣性を使う簡易サーボで、関節の弾性・バックラッシュ・自己衝突・接触負荷による停止を解く多剛体拘束ソルバーではありません。胴体空力は従来の機体全体の近似を使います。

## ドッキング

`docking`パーツを持つ2機が飛行中で、給電されているときに捕獲できます。ポート間0.30 m以内、法線の内積−0.98以下、ポート位置での相対速度0.5 m/s以下、相対角速度0.2 rad/s以下が条件です。

捕獲後は2機を剛結合として拘束し、合計の質量・慣性と運動量から共通の運動を計算します。機体ID、電源・燃料、UDPポートはそれぞれ保持します。1機体の同時結合相手は1機までです。KSPのような機体データのマージや、3機以上の結合、ドッキング後の資源融通は行いません。

```json
{
  "type": "pylon_docking_port_command",
  "name": "port",
  "action": 1
}
```

共通のセッション・lease・sequenceが必要です。`action:1`はポートカメラの選択、`2`は停止、`3`は切り離し。1機体で選べるポートカメラは1つです。切り離しは速度を保持し、2秒間の再捕獲禁止と0.5秒間の衝突猶予を設けます。

`pylon_docking_port_manifest`と`pylon_docking_port_state`でポート名、結合・解除可能状態、相手、カメラ状態を取得できます。カメラ画像は`source:"docking_port"`を使い、標準bridgeでは`/ksp_vessel/docking_ports/<id>/camera`以下に配信されます。

## URDF・TFと近隣機体

`pylon_vessel_urdf_chunk`はgzip+base64、SHA-256付きのPyLoNランタイムプロキシです。パーツごとの質量・箱による形状近似、接続とセンサー取り付け先を含み、実時間2 Hzで再送します。関節姿勢と燃料による重心変化も次のモデルへ反映します。標準bridgeの仕様に合わせ、URDFはその時点の固定接続プロキシで、関節運動はモデル更新とJointStateで観測します。モデルの失効は3秒です。

`pylon_nearby_vessels`には観測機体と最大32機の状態を含みます。同一世界・同一時刻で2,500 m以内の生存機体を対象に、位置と速度を**観測機体のground truthと同じENU原点**で表します。`vessels`には観測機体自身を含めません。分離物を含み、UDP OFFの機体も観測できます。別機体のUDPセッションがある場合は、その`vesselId`と一致します。

## パーツ温度

`pylon_part_thermal_state`で各パーツの`temperature`、`skinTemperature`、`maxTemperature`、`maxSkinTemperature`をK単位で配信します。部品IDはモデルと共通です。既存の電力残量・容量も含みます。

皮膜と内部の二つの熱容量、伝導、対流、放射、日照、速度による加熱、エンジンの廃熱を計算する簡易集中定数モデルです。初期温度288.15 K。内部限界は一般パーツ1,200 K／エンジン2,000 K、皮膜限界は1,500 K／2,400 Kです。限界は監視用で、自動破壊は行いません。材質ごとの同定や部品間熱伝導、空力遮蔽はなく、`shieldedFromAirstream:false`です。分離時は各パーツの温度を引き継ぎます。

## 分離結果の履歴照会

分離指令に`operationId`を指定すると、その操作の結果を`pylon_separation_result`として保持します。省略時はcontroller・lease・対象名・sequenceからPyLoN互換のlegacy IDを生成します。

```json
{
  "type": "pylon_separation_query",
  "version": 1,
  "operationId": "stage-001",
  "operationInstance": "元のruntimeInstance",
  "operationEpoch": "元のruntimeEpoch",
  "operationVesselId": "元のvesselId"
}
```

照会にleaseは不要です。同じ操作ID・元セッション・対象・controllerの再送では結果を返し、再分離しません。対象やcontrollerを変えた再利用は拒否します。結果には完了・成功・理由・結果機体ID・残り保持秒数を含みます。

結果は1通信チャネルにつき最大128件、完了から実時間600秒間、メモリー内に保持します。UDP OFF/ONによるセッション変更やlease失効後も同じチャネルで照会できます。未保持・期限切れでは`retained:false, reason:"result_not_found"`を返します。チャネル削除やサーバー再起動で履歴は失われます。受理前の形式・権限・対象検証エラーはauthority応答で通知し、結果履歴には残しません。

## ROS2の接続

`pylon_bridge`、`pylon_interfaces`、`pylon_vehicle_control`は[PyLoNリポジトリ](https://github.com/PyLoN-sim/PyLoN)から別途取得します。AstroForgeにはこれらのソースを同梱しません。本体とは別プロセスで起動し、公開UDPだけで通信します。

```sh
source /opt/ros/jazzy/setup.bash
# 別途ビルドしたPyLoNワークスペース
source /path/to/pylon_ws/install/setup.bash
ros2 run pylon_bridge udp_bridge --port 49010 --command-port 49011
```

[ROS2のビルド・制御ノード・検証手順](./ros2)を参照してください。`pylon_vehicle_control`は世界座標の目標位置・姿勢を受け取り、leaseを取得してbody wrenchを指令します。機体に合った推力上限・ゲインの設定と継続的なsetpoint配信が必要です。
