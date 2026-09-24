# AstroForge / PyLoN v1 UDP

Reference: https://github.com/PyLoN-sim/PyLoN/tree/d62d948064d6665702d05957a669596244dca8da

このドキュメントはMVPの対応範囲を定義します。PyLoN全機能互換を意味しません。受信は32768バイト以内のUTF-8 JSON datagram、versionは1。初期機体の既定ポートはRX 49011 / TX 49010で、ONの機体ごとに毎秒20回のテレメトリを送ります。追加機体のポートは機体一覧またはHTTP Stateの`vehicles[].udp`で確認してください。応答も設定されたTX送信先へ送ります。コマンド送信元の一時ポートには返信しません。

## 対応する受信パケット

| type | 対応内容 |
|---|---|
| `pylon_control_authority_command` | acquire, renew, release, emergency_stop, clear_emergency_stop |
| `pylon_flight_control_command` | pitch, yaw, roll / [-1, 1] |
| `pylon_actuator_command` | engine / RCS / separation |
| `pylon_body_wrench_command` | base_link座標のforce[N], torque[N·m] |
| `pylon_control_batch` | engineJson, flightJson, separationJson, renewLease / atomic validation |

`landingGear`は書式上受け付けますが、脚パーツがないため状態変更はありません。`suppressSas`は制御権状態に反映しますが、ゲーム側SAS自体を実装していません。エンジンのgimbalRollは書式上保持しますが、中央1基のエンジンはロールモーメントを発生できません。ロールはポッドのホイールとRCSが担当します。

## 対応する送信パケット

- `pylon_session`
- `pylon_control_authority_state`
- `pylon_flight_state`
- `pylon_ground_truth`
- `pylon_imu`
- `pylon_vehicle_health`
- `pylon_control_snapshot`
- `pylon_actuator_manifest`
- `pylon_actuator_state` (engine, rcs, separation)
- `pylon_wrench_status` (wrench指令受信後)

session heartbeatが最初に送られます。起動直後から発射台では`available:true`で物理時刻が進みます。通常のVAB表示中も飛行と配信は続きます。旧`/api/revert`で明示的にリセットした場合だけ、再配置まで`available:false, paused:true`でheartbeatのみを送ります。墜落・着地・破損後は`available:false`、結果テレメトリは送り続けます。

各flightパケットの`universalTime`はサーバーの共通シミュレーション時刻（秒）です。`observationSequence`はheartbeatごとに増加します。`runtimeInstance`はサーバー起動ID、`runtimeGeneration`は配置/制御対象の変更/リセットで増加、`runtimeEpoch`と`runtimeVesselId`はセッションごとに変わります。

`pylon_imu`は追加パーツ不要の理想IMUです。`angularVelocity`は慣性系に対するbody角速度で、地表では地球自転を含みます。`linearAcceleration`は重力を除いた比力をbody軸で表し、発射台では機首方向に約+g、真空自由落下では約0です。センサーノイズ・バイアスは加えていません。

`pylon_vehicle_health`は実際の`electricCharge`と`electricCapacity`を送ります。両方とも1 unit = 1 Whです。上流bridgeは連続したサンプルの差から蓄電量変化率を推定できます。

`pylon_control_snapshot`は同一物理時刻・観測番号の`flight`、`engines`、`separations`を一つのdatagramに含めます。各メンバーにもセッションidentityを付け、上流の厳密なsnapshot検証を通します。上流と同じく60,000 bytesを超える場合は全体を省略し、部分的なsnapshotは送りません。

## 接続の順序

1. ローカル49010をbindしてsession heartbeatを待つ。
2. `available:true`のsessionからruntime identityとvesselIdをコピーする。
3. 一意のcontrollerId/leaseIdでacquireを送る。
4. 自分のleaseが`state:1`になったことを確認する。
5. actuator manifestのnameを使ってengine/RCSを指令する。
6. 20 Hz程度で短いtimeout付きの指令を更新し、leaseも定期renewする。
7. 終了時は推力を0にし、releaseする。

leaseDurationSecondsは0.1〜10秒。timeoutSecondsはflightが0.05〜1秒、engine/RCS/wrenchが0.05〜10秒。batchの各メンバーは0.05〜1秒です。期限は壁時計の単調時刻で判定するので、シミュレーションが遅れても古い入力が残りません。lease失効、release、所有者の変更、緊急停止で指令をクリアします。コマンド失効時は該当アクチュエータを0に戻します。

sequenceは正の安全な整数 (`1..2^53-1`)。上流のint64全域のうち、JavaScriptで正確に扱える範囲です。authority / attitude / wrench / 各actuator / batchごとの単調増加として扱います。古い・重複sequenceと古いセッションを拒否します。異なる所有者は、現在より高いpriorityでのみacquireできます。緊急停止は新たなacquireでも解除されず、停止を行ったcontrollerId/leaseIdによるclearが必要です。

## JSON例

以下のIDは実際のheartbeatから取得して置き換えてください。actuator nameはmanifestから取得します。初期機体のエンジン名は`engine_1`です。

```json
{
  "type": "pylon_control_authority_command",
  "version": 1,
  "runtimeInstance": "FROM_HEARTBEAT",
  "runtimeGeneration": 2,
  "runtimeEpoch": "FROM_HEARTBEAT",
  "runtimeVesselId": "FROM_HEARTBEAT",
  "vesselId": "FROM_HEARTBEAT",
  "controllerId": "my-controller",
  "leaseId": "unique-lease-id",
  "sequence": 1,
  "action": "acquire",
  "priority": 10,
  "leaseDurationSeconds": 2.0,
  "suppressSas": true
}
```

同じidentity/controller/leaseを付けたエンジン指令:

```json
{
  "type": "pylon_actuator_command",
  "version": 1,
  "runtimeInstance": "FROM_HEARTBEAT",
  "runtimeGeneration": 2,
  "runtimeEpoch": "FROM_HEARTBEAT",
  "runtimeVesselId": "FROM_HEARTBEAT",
  "vesselId": "FROM_HEARTBEAT",
  "controllerId": "my-controller",
  "leaseId": "unique-lease-id",
  "sequence": 2,
  "actuatorType": "engine",
  "name": "engine_1",
  "enabled": true,
  "targetThrust": 60000,
  "hasGimbalCommand": false,
  "gimbalPitch": 0,
  "gimbalYaw": 0,
  "gimbalRoll": 0,
  "timeoutSeconds": 0.4
}
```

姿勢指令は`type:pylon_flight_control_command`、`pitch/yaw/roll`、`landingGear:false`、`timeoutSeconds`を設定。エンジンの`hasGimbalCommand:false`なら姿勢指令でジンバルも動かします。trueなら当該エンジンのgimbalPitch/Yawを優先します。ジンバル入力・状態は上流と同じ正規化値[-1,1]、物理的可動範囲は±6°です。

RCS指令は`actuatorType:rcs`、manifestの`name`、`enabled:true`、`thrustLimit:250` [N]。RCSはロール/ピッチ/ヨーを補助します。平行移動は`pylon_body_wrench_command`からforceを指定します。wrench指令は主エンジンの+X推力と、RCSの共有推力予算で実現可能な分だけ配分します。wrenchとflight/個別engineは後に受信した指令へ切り替わります。

batchは`hasFlight`, `hasSeparation`, `renewLease`, `leaseDurationSeconds`, `suppressSas`, `engineJson:[]`を持ちます。エンジンの各メンバーはJSON文字列。`hasFlight:true`なら`flightJson`もJSON文字列で追加。各メンバーのversion/vessel/controller/lease/sequenceを外側と一致させてください。全メンバーの検証後にのみ適用します。`hasSeparation:true`なら`separationJson`に分離指令のJSON文字列を追加できます。分離を先に適用し、上段へのengine/flight指令を適用します。切り離される側のエンジンを同時に指定したbatchは全体を拒否します。

## 分離指令

manifestのactuatorTypeが`separation`のnameを指定します。ほかの指令と同じruntime identity、controllerId、leaseId、sequenceを付けます。

```json
{
  "type": "pylon_actuator_command",
  "actuatorType": "separation",
  "name": "separator_1",
  "separate": true
}
```

上の例は追加フィールドのみです。versionとセッション・lease情報を含む共通envelopeが必要です。上流のSeparationCommandと同じくtimeoutSecondsは不要。別stream `separation:<name>`でsequenceを検証します。制御権なし、電力なし、発射台・着地・衝突後、不明なリングは拒否します。

分離リングと下側の段が切り離され、上側のポッドを制御対象として維持します。AstroForgeでは分離時にセッションとleaseを維持します。既存の飛行・推力指令はクリアし、次の指令で上段を点火できます。燃料は段を跨いで流れず、下段が付いている上段エンジンは推力を発生しません。

状態は`pylon_actuator_state`の`mechanism:"decoupler"`、`available`、`separated`で通知します。分離したリングはmanifestから外れ、`separated:true`の状態をリセットまで送信します。切り離したエンジン/RCSもmanifestから外れます。同じリングへの再指令で二重分離は起きません。上流のoperationId付き結果ジャーナル・`pylon_separation_result/query`は未実装です。

## 座標と単位

- 内部ECI: 地球中心、初期発射台の上方向が+X、東+Y、北+Z。赤道の球面地球。
- `base_link`: +X=機首、+Y=左、+Z=上、右手系。
- AstroForgeの正のroll/pitch/yawはそれぞれbody +X/+Y/+Z周りの正トルク。
- `pylon_ground_truth`: 発射台初期位置を原点とする地球固定のENU（東・北・上）。quaternionはbody→ENUの[x,y,z,w]。地球自転を取り除いた速度・角速度。
- `pylon_flight_state`: `*Body`はbase_link。surfaceVelocityは回転大気に対する速度、orbitalVelocityは慣性速度。altitudeAsl/Aglは球面地表から重心までの距離。
- ブラウザ高度は初期重心高度を差し引いた上昇量。UDPのASL値とは約数mの差があります。
- m、s、kg、N、N·m、rad、Pa。latitude/longitudeは度。
- liquidFuel/oxidizerはKSP風resource unit。各1 unit=5 kg、質量比45:55。総推進剤kg = `(liquidFuel+oxidizer)*5`。electricChargeはMVPでは1 unit=1 Whと定義。
- 脱出軌道はJSON Infinityを使わず`apoapsis:0,timeToApoapsis:0,orbitBound:false`。`orbitBound`はAstroForgeの追加フィールド。ブラウザ内部はnullで扱います。

engine/RCS名は保存されるパーツIDです。上流KSPが生成する名前そのものとは異なります。固定名のハードコードを避け、manifestから列挙してください。上流ROS bridgeのパーサーと互換な書式であっても、KSP用の操縦ゲイン・質量・重力・推力パラメーターがそのまま適切とは限りません。

## 未対応

LiDAR、カメラ、スタートラッカー、URDF/モデル転送、パーツ温度、近隣機体、ロボティクスmotor、rover/wheel、分離結果ジャーナル、ドッキング、UDPパケット単独での複数機体の制御切り替え、ROSサーバー自体は未実装です。未対応コマンドにはauthority stateのreasonで拒否理由を返します。入力検証は一部で上流より厳格です。UDP認証・再送保証はありません。MVPの受信は127.0.0.1限定です。

Python標準ライブラリでの実例は `examples/launch.py`、上流のパケット生成・解析関数との相互検証は `tests/upstream_compatibility.py` を参照してください。

## 複数機体と倍率

HTTPの`/api/control`へ`{vehicleId, enabled:true/false}`を送り、機体ごとにUDPをON/OFFできます。ONの機体はそれぞれ専用の受信・送信ポート、runtime identity、lease、sequenceを持ち、並行して制御できます。別機体のidentityを送った指令は拒否します。カメラの追尾変更や他機体のON/OFFはセッションに影響しません。

初期機体はON、追加配置した機体はOFFです。初回ON時、設定ポートから2ずつ増やした組を探し、他機体への割り当てと重なる組や使用中の受信ポートをスキップします。65535を超える場合は割り当てエラーです。テレメトリのポートは送信先であり、サーバーはbindしません。受信するクライアント側でそのポートをbindしてください。

OFFはその機体の指令とleaseを解除し、送受信を停止します。ポート割り当ては保持し、再ON時に新しいセッションで接続し直します。再ON時に受信ポートが使用中ならOFFのままエラーを返します。機体の置換・全リセットではポート割り当ても解放します。分離物は追尾のみ可能です。

heartbeatの`warpRate`は1/2/5/10、`physicsWarp`は倍率が1より大きいとtrueです。`universalTime`は加速しますが、lease期限・コマンド期限と20 Hz配信は実時間のままです。
