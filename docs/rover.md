# ローバー

ワークショップの「ローバー」ボタン、または機体ライブラリの **Trailblazer 01 / Rover** から4輪機体を作成できます。保存・再編集・配置はロケットと共通です。配置すると発射設備の東200 mの地表に水平に置かれます。

## パーツと組み立て

- **CH-400 直方体シャーシ**: 前後4 m × 幅1.8 m × 厚さ0.45 m、180 kg。前後端へ他の胴体パーツを接続し、側面に車輪を取り付けます。
- **RW-45 サスペンション付きタイヤ**: 半径0.45 m、35 kg。左右側面（0°・180°）に配置。車輪を追加する際は対称配置「2」を使ってください。車輪の対称配置は最大2個となり、上下には取り付けません。
- コマンドポッドを先頭に1個、3輪以上のタイヤを取り付けます。電源容量を増やすにはバッテリーを追加してください。ローバーにはエンジン・燃料タンクは不要です。

座標は車体の前方がx、左がy、上がzです。エディターでは従来のロケットと共通の座標表示を使い、地表配置時に水平へ向きを変えます。

## 操作

機体一覧で対象ローバーのUDPをONにして、表示された送受信ポートを指定します。車輪ごとに電動モーター、操舵、ブレーキを操作できます。

外部クライアントは別ターミナルから起動します。`--wheel` の値は **名前,目標角速度,操舵角,最大駆動トルク,ブレーキ**。名前も数値も利用者が指定し、manifestを使った対象の自動選択や姿勢制御は行いません。

以下はプリセットの4輪へ目標角速度20 rad/s、最大駆動トルク405 N·mを10秒指令させ、最後にブレーキを送信して制御権を解放する例です。

```sh
node --import tsx examples/wheel-control.ts \
  --command-port 49011 --telemetry-port 49010 --seconds 10 \
  --wheel wheel_rear_left,20,0,405,0 \
  --wheel wheel_rear_right,20,0,405,0 \
  --wheel wheel_front_left,20,0,405,0 \
  --wheel wheel_front_right,20,0,405,0
```

前輪操舵で旋回する場合は、指定した前輪2個の操舵角を例えば`0.22` rad、後輪を`0`にします。後退は目標角速度を負にします。Ctrl+Cでも指定した車輪へブレーキを送り、終了します。指令失効、制御権喪失、UDP OFF、電源切れでも車輪は駆動を停止して機械式ブレーキをかけます。

## PyLoN互換UDP

PyLoNの`wheel` actuatorと同じフィールド・SI単位を使います。旧AstroForge独自の`motor` / `steering`入力は拒否します。

```json
{
  "type": "pylon_actuator_command",
  "actuatorType": "wheel",
  "name": "wheel_front_left",
  "enabled": true,
  "targetAngularVelocity": 20,
  "steeringAngle": 0.22,
  "maxDriveTorque": 405,
  "brake": 0,
  "timeoutSeconds": 0.3
}
```

実際の送信では共通のセッション識別子、`version: 1`、`controllerId`、`leaseId`、`sequence`も必要です。`targetAngularVelocity`はrad/s、`steeringAngle`はrad、`maxDriveTorque`はN·mです。最大操舵角は±0.55 rad、駆動トルクの機体側上限は405 N·mです。PyLoNと同様、`maxDriveTorque <= 0`は既定トルクを使います。`brake`は0〜1（省略時0）、タイムアウトは0.05〜10秒です。`enabled:false, brake:0`で惰行し、`enabled:false, brake:1`でも制動できます。ブレーキ指令中は駆動・操舵入力を0にします。各車輪を個別に更新してください。既存の`engineJson`バッチは車輪用ではありません。

`pylon_actuator_manifest`に車輪名を掲載します。`pylon_actuator_state`はPyLoNの`angularPosition`、`angularVelocity`、`steeringAngle`、`driveTorque`、`brakeTorque`、`slip`、`maxDriveTorque`、`grounded`を返します。形状情報は`wheelCount`、`radius`、`position`、`rollingSign`、`steeringSign`、`steeringEnabled`、`maxSteeringAngle`、`bodyMin` / `bodyMax`です。位置・範囲は現在の重心を原点とするbase_linkで、符号は両側とも+1です。サスペンションの表示用変位はブラウザ用の機体状態に保持します。

## 物理モデルと確認

各輪に18,000 N/mのばね、850 N·s/mのダンパー、0.40 mのストロークがあります。接地点で車体へ力とトルクを与えるため、加減速でピッチ、旋回でロールが発生します。表示の伸縮・操舵・回転は物理状態から描画します。接地は240 Hzで計算し、摩擦限界とトルク上限を設けています。PyLoNと同じ比例ゲイン0.1で角速度誤差を駆動入力へ変換します。車輪の回転は純転がり近似で、空転慣性は計算しません。`slip`は横方向速度／前進速度からの近似です。

このモデルは球面地表上のレイキャスト車輪です。ばね下の独立剛体、岩や段差、不整地、発射設備との車輪衝突は対象外です。柔らかい着地では車体が動き続け、強い車体衝突では既存の破損処理が働きます。

自動テスト `tests/rover.test.js` では接地荷重、落下後の減衰振動、加速・急制動・後退、旋回時の左右荷重差、空中で駆動力が出ないこと、指令失効・電源切れ、両物理バックエンドの一致を確認します。`tests/wheel-control.test.js` はAstroForgeを起動せず、模擬UDP相手への送受信と対象名の保持を検証します。

### 旧出力指令での実走行の記録

以下は角速度指令への移行前に取得したサスペンション検証記録です。

ブラウザーでプリセットを組み立て・保存・地表配置し、別プロセスから公開UDPで26秒間、加速→急制動→前輪操舵→停止を行いました（Zig/WASM、時間倍率×1）。取得した519サンプルでは、最高速度10.51 m/s、最終速度0.0023 m/s。急制動中に後輪のばねが全伸長（圧縮0 m）となり、前輪の圧縮は最大0.187 mでした。制動後は上下動が減衰し、旋回時には左右の圧縮量が異なることを確認しました。

![UDP実走行の速度とサスペンション変位](/rover-validation.svg)

[公開UDPから取得したサンプル（CSV）](/rover-validation.csv)
