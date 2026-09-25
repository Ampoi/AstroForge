# 受け取るテレメトリ

クライアントがテレメトリ用ポート（既定 `127.0.0.1:49010`）をbindすると、AstroForgeから飛行状態が届きます。購読コマンドや制御権の取得は不要です。対象機体がUDP ONなら、発射前から受信できます。

## まず受信してみる

Python 3の標準ライブラリだけで試せます。次を`receive.py`として保存し、`python3 receive.py`で実行してください。同じ受信ポートを使うデモを終了してから起動します。追加機体では`TELEMETRY_PORT`を機体一覧の値に変更します。

```python
import json
import socket

TELEMETRY_PORT = 49010
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
    sock.bind(('127.0.0.1', TELEMETRY_PORT))
    print(f'UDP :{TELEMETRY_PORT} で受信中。Ctrl+Cで終了。', flush=True)
    try:
        while True:
            raw, _ = sock.recvfrom(65535)
            packet = json.loads(raw.decode('utf-8'))
            if packet.get('type') in ('pylon_session', 'pylon_flight_state'):
                print(json.dumps(packet, ensure_ascii=False), flush=True)
    except KeyboardInterrupt:
        pass
```

これは受信専用なので機体は点火しません。操縦するには[接続と制御権](../protocol#接続から点火まで)、[送るコマンド](./commands)を参照してください。

## どんなパケットが届くか

UDP ONの機体ごとに実時間20 Hz（約50 msごと）で以下を配信します。**各行は別のdatagram**で、アクチュエータ状態はパーツごとに届きます。ネットワーク上の到着順や到着自体は保証されません。

| `type` | 内容・使い道 |
| --- | --- |
| `pylon_session` | 観測セッションの識別・有効性、時間倍率 |
| `pylon_control_authority_state` | 誰が操縦中か、lease残り時間、指令の拒否理由。指令への応答としても届く |
| `pylon_flight_state` | 高度・速度・資源・軌道・姿勢入力の適用状態 |
| `pylon_ground_truth` | 地球固定座標での位置・姿勢・速度・加速度 |
| `pylon_imu` | 機体軸の角速度と比力（重力を除いた加速度） |
| `pylon_vehicle_health` | 蓄電量と容量 |
| `pylon_actuator_manifest` | 現在の機体のエンジン・RCS・分離リングの一覧 |
| `pylon_actuator_state` | 各エンジンの推力、RCSの噴射、分離の完了状態 |
| `pylon_control_snapshot` | 同じ時刻のflight・engine・separationを一括取得 |
| `pylon_wrench_status` | wrenchが保持されている間に配信する、要求と実現値の差 |

配信処理はsessionから送信を始めますが、受信側では順序を前提にせず`type`で振り分けてください。VAB表示中も配信は継続します。機体が残る着地・墜落後はsessionの`available:true`を維持し、UDP ONの間は結果を配信し続けます。leaseは解除され、操縦指令は`control_unavailable`で拒否されます。機体が消失した場合は`available:false`になり、bridgeは以降の観測を採用しません。UDP OFF・全リセットではheartbeatを含む送信自体が止まります。

## 共通フィールドとセッション

すべてのパケットに`type`、`version:1`、セッション情報5項目（`runtimeInstance`、`runtimeGeneration`、`runtimeEpoch`、`runtimeVesselId`、`vesselId`）、`observationSequence`、`universalTime`が付きます。

| フィールド | 読み方 |
| --- | --- |
| セッション情報5項目 | 対象機体の接続を識別。コマンドにそのままコピーする |
| `observationSequence` | テレメトリ周期ごとに増える観測番号。同一周期のパケットでは共通 |
| `universalTime` | サーバーの共通シミュレーション時刻（秒）。実時刻の日時ではない |

次は`pylon_session`の例です。ID・時刻・名前は実行ごとに変わります。

```json
{
  "type": "pylon_session",
  "version": 1,
  "runtimeInstance": "example-instance",
  "runtimeGeneration": 1,
  "runtimeEpoch": "example-epoch",
  "runtimeVesselId": "example-vessel",
  "vesselId": "example-vessel",
  "observationSequence": 42,
  "universalTime": 2.1,
  "available": true,
  "vesselName": "Pathfinder 02 / Two stage",
  "realtimeSinceStartup": 2.1,
  "paused": false,
  "packed": false,
  "warpRate": 1,
  "physicsWarp": false
}
```

`available:true`は同じセッションで観測を採用できることを示します。操縦できることやleaseを所有していることは保証しません。操縦開始前にacquireの応答と自分のcontroller/leaseを照合してください。着地時はlease喪失と最終snapshotの到着順が入れ替わるため、指令送信を止めても観測購読は継続します。`realtimeSinceStartup`はそのUDPプロトコルインスタンスの開始からの実時間秒です。`warpRate`は1/2/5/10、`physicsWarp`は倍率が1を超えるとtrue。通常の配信では`paused:false`、`packed:false`です。

制御に使うパケットは現在のセッション情報と一致するものだけを採用します。sessionの情報が変わったら過去の観測を捨て、接続をやり直してください。観測を比較する際はセッションと観測番号を組み合わせ、欠落したデータを待ち続けないよう受信時刻も記録します。

発射台上でも`landed:true`です。これだけで飛行終了と判断せず、飛行中の`landed:false`からの遷移や、authorityの`reason`（`vessel_landed` / `vessel_crashed`）を確認します。bridgeの`VesselLifecycle.STATE_ACTIVE`も観測セッションの有効性であり、操縦許可ではありません。

## 制御権と指令の応答

`pylon_control_authority_state`には以下が入ります。

| フィールド | 意味 |
| --- | --- |
| `state` | `0`=未所有、`1`=lease取得済み、`2`=緊急停止 |
| `controllerId`, `leaseId`, `priority` | 現在の所有者。自分の値と照合する |
| `leaseRemainingSeconds` | 失効までの実時間秒。未所有・緊急停止では0 |
| `emergencyStop`, `sasSuppressed` | 緊急停止とSAS抑制フラグ。SAS自体は未実装 |
| `lastSequence` | 所有者状態に記録された最後の受理番号。受信した指令ごとの応答IDではない |
| `reason` | 取得・解放・受理・拒否理由。[結果とエラー](./commands#指令の結果とエラー)を参照 |
| `vessel` | 機体名 |

指令が拒否されても`state:1`が返ることがあります。例えば、自分が制御権を持ったまま不正なエンジン名を送った場合です。`reason`を確認し、制御権の状態と指令の成功を分けて扱ってください。

## 高度・速度・燃料・姿勢入力

`pylon_flight_state`の主なフィールドです。ベクトルは`[x,y,z]`。`*Body`は機体固定の`base_link`座標です。

| フィールド | 意味・単位 |
| --- | --- |
| `altitudeAsl`, `altitudeAgl` | 球面地表から重心までの高度m。両者は同じ値 |
| `latitude`, `longitude` | 緯度・経度、度 |
| `verticalSpeed`, `horizontalSpeed` | 回転地表に対する鉛直（上が正）・水平速度m/s |
| `surfaceVelocityBody` | 回転大気に対する速度、body軸、m/s |
| `orbitalVelocityBody` | 慣性速度、body軸、m/s |
| `angularVelocityBody` | 地球自転分を除いた角速度、body軸、rad/s |
| `upBody`, `eastBody`, `northBody` | その位置の上・東・北を機体軸で表した単位ベクトル。姿勢の補正に使える |
| `mass` | 現在の機体質量kg |
| `liquidFuel`, `oxidizer` | 機体に残る燃料・酸化剤、各1 unit=5 kg。段ごとの量ではない |
| `electricCharge` | 蓄電量Wh |
| `dynamicPressure` | 動圧Pa |
| `apoapsis`, `periapsis` | 予測遠地点・近地点の地表からの高度m。近地点は負になり得る |
| `timeToApoapsis` | 遠地点到達までのシミュレーション秒 |
| `orbitBound` | 束縛軌道ならtrue。falseではapoapsis/timeToApoapsisは0 |
| `landed`, `splashed` | 発射台上・着地ならlanded=true。splashedは常にfalse |
| `bodyName`, `bodyRadius` | `Earth`、地球半径m |
| `gravity`, `gravitationalParameter`, `atmosphereDepth` | 現在の重力加速度m/s²、重力定数μ（m³/s²）、大気上端m |
| `appliedInputValid`, `flightCommandActive` | 有効な姿勢指令があり、leaseと電力の条件を満たすか |
| `appliedInputSequence`, `appliedInputAge` | 適用した姿勢指令の番号と受信からの実時間秒。無効時の番号は0 |
| `appliedPitch`, `appliedYaw`, `appliedRoll` | 適用している正規化入力。無効時は0 |
| `inputAtLimit` | 有効入力の絶対値がいずれか0.999以上か |

ブラウザの高度は初期重心高度を差し引くため、UDPの高度とは数m異なります。姿勢角そのものが必要な場合はground truthのquaternionを使います。燃料と電力の単位、座標の定義は[座標・高度の図と数値例](./coordinates)も参照してください。

## 位置・姿勢とIMU

`pylon_ground_truth`の位置・速度などは地球固定ENU（東・北・上）で表します。

| フィールド | 意味・単位 |
| --- | --- |
| `position` | 初期発射台の重心位置を原点とする位置、ENU、m |
| `rotation` | body→ENUのquaternion、`[x,y,z,w]` |
| `linearVelocity`, `angularVelocity` | 地球自転分を除いた速度m/s・角速度rad/s、ENU |
| `linearVelocityBody`, `angularVelocityBody` | 同じ相対速度・角速度をbody軸で表したもの |
| `linearAcceleration`, `angularAcceleration` | ENUでの座標加速度m/s²・角加速度rad/s² |
| `frameAngularVelocity` | 地球固定座標系の自転角速度、ENU、rad/s |
| `originSequence`, `vessel` | 座標原点の世代番号（runtimeGeneration）、機体名 |

`pylon_imu`は追加パーツなしで得られる理想センサーです。

| フィールド | 意味・単位 |
| --- | --- |
| `angularVelocity` | 慣性系に対するbody角速度、rad/s。地表でも地球自転を含む |
| `linearAcceleration` | 重力を除いた比力、body軸、m/s²。発射台では機首方向に約+g、真空自由落下では約0 |

IMUとground truthの角速度は基準が異なります。IMUにはノイズ・バイアスを加えていません。

`pylon_vehicle_health`の`electricCharge`は現在の蓄電量、`electricCapacity`は容量です。どちらもWhで、別の百分率ではありません。

## アクチュエータ

`pylon_actuator_manifest`の`actuators`配列を読み、指令の`name`に使います。以下は内容例で、実際のパーツ数・名前は機体に依存します。共通フィールドは省略しています。

```json
{
  "type": "pylon_actuator_manifest",
  "actuators": [
    { "name": "engine_1", "actuatorType": "engine", "partId": "engine_1" },
    { "name": "rcs_1", "actuatorType": "rcs", "partId": "rcs_1" },
    { "name": "separator_1", "actuatorType": "separation", "partId": "separator_1" }
  ]
}
```

`pylon_actuator_state`にも`name`・`actuatorType`・`partId`が付きます。`actuatorType`に応じて次を読みます。

| 種類 | フィールド | 意味 |
| --- | --- | --- |
| engine | `available` | 現在の最下段にあり使用可能か。下段が付いた上段エンジンはfalse |
| engine | `operational` | 使用可能な段で、燃料・電力があり、着地・破損などで停止していないか |
| engine | `enabled`, `commandActive` | 有効化されているか、期限内の指令があるか |
| engine | `thrust`, `maxThrust`, `throttle` | 実推力N、現在の最大推力N、比率0〜1。使用不可の段はmaxThrust=0 |
| engine | `flameout` | 使用可能な段の燃料が尽きたか |
| engine | `gimbalAvailable`, `gimbalCommandActive` | ジンバル対応と個別ジンバル指令の有効性 |
| engine | `gimbalPitch`, `gimbalYaw`, `gimbalRoll` | 個別ジンバル指令の正規化値。有効でない場合は0で、姿勢指令由来の実偏向角ではない |
| rcs | `enabled`, `commandActive`, `active` | 有効化、期限内指令、実際に推力が発生しているか |
| rcs | `thrust`, `maxThrust`, `thrustLimit` | 実推力・部品の最大推力・適用中の上限、いずれもN |
| rcs | `flameout` | 一液式推進剤が尽きたか |
| separation | `mechanism` | `decoupler` |
| separation | `available`, `separated` | 今分離できるか、既に分離したか |

分離済みリングはmanifestから外れても`separated:true`を送り続けます。切り離されたエンジン/RCSの状態は上段のテレメトリから外れます。manifestも定期的に更新してください。

## 同じ時刻の状態をまとめて読む

段の燃焼終了・分離・上段点火を判断する場合、`pylon_control_snapshot`を使うと観測時刻の混在を避けられます。

| フィールド | 内容 |
| --- | --- |
| `flight` | 完全な `pylon_flight_state` オブジェクト |
| `engines` | engineの `pylon_actuator_state` オブジェクトの配列 |
| `separations` | separationの `pylon_actuator_state` オブジェクトの配列 |

外側と各メンバーに同じセッション情報・`observationSequence`・`universalTime`が付き、1つのdatagramで届きます。ここはコマンドの`engineJson`と異なり、JSON文字列ではなくオブジェクトです。RCS・IMUは含みません。UTF-8で60,000 bytesを超える場合、部分送信せずsnapshot全体を省略します。

例えば、最下段エンジンの`flameout:true`を検出し、分離指令の後にリングの`separated:true`と上段エンジンの`available:true`・`operational:true`を確認して点火できます。

## wrenchの配分結果

`pylon_wrench_status`には、指令の`controllerId`・`leaseId`・`sequence`と次の値が入ります。wrenchを受信してから、その指令がクリアされるまで配信されます。

| フィールド | 意味 |
| --- | --- |
| `accepted`, `reason` | 期限内ならtrue / `allocated`、期限切れならfalse / `command_expired` |
| `requested` | 要求した `{force:[x,y,z], torque:[x,y,z]}` |
| `allocated`, `achieved` | 直近の物理計算で得た力・トルク。同じ形式、N / N·m |
| `allocationResidual` | requested − achieved |
| `saturationRatio`, `saturated` | 残差の大きさを示す比と、比が0.001を超えるか |
| `trackingResidual`, `trackingErrorRatio` | このモデルではゼロベクトル / 0 |
| `achievedQuality` | `simulated` |

力・トルクはbody軸です。`accepted:true`でも要求どおりの力が出るとは限りません。残差はアクチュエータ能力の不足を調べるために使い、`saturationRatio`を推力の百分率とは解釈しないでください。
