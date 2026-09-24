# 送るコマンドと機体の挙動

[UDP接続](../protocol)で確認したコマンド用ポートに送信します。すべての指令に、現在のセッション情報・controllerId・leaseId・sequenceが必要です。制御権の操作を除き、先にleaseを取得してください。

## 何を送るとどう動くか

| やりたいこと | `type` と指定 | 機体の挙動 |
| --- | --- | --- |
| 操縦を開始・継続・終了する | `pylon_control_authority_command` | leaseを取得・更新・解放。取得だけでは点火しない |
| 点火・推力変更・停止 | `pylon_actuator_command` / `engine` | 指定エンジンにN単位の推力を要求 |
| 機体を回転させる | `pylon_flight_control_command` | ホイール・ジンバル・有効なRCSで姿勢入力を適用 |
| RCSを使えるようにする | `pylon_actuator_command` / `rcs` | RCSを有効化して推力上限を設定。姿勢入力に応じて噴射 |
| 段を切り離す | `pylon_actuator_command` / `separation` | 指定リングとその下側の段を分離し、上段の制御を維持 |
| 力・トルクを直接要求する | `pylon_body_wrench_command` | 主エンジンとRCSで実現可能な範囲を配分 |
| 複数の操作を一緒に適用する | `pylon_control_batch` | 全指令を検証した後にまとめて適用。不正なメンバーがあれば全体を拒否 |

## 制御権を取得・更新・解放する

次は1つの完全なパケットです。`FROM_HEARTBEAT`と`runtimeGeneration`を受信した値に、`leaseId`を今回生成した一意な値に置き換えます。以降も同じセッション・controller・leaseを使います。

```json
{
  "type": "pylon_control_authority_command",
  "version": 1,
  "runtimeInstance": "FROM_HEARTBEAT",
  "runtimeGeneration": 1,
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

| フィールド | 指定 |
| --- | --- |
| `action` | 下表の操作名 |
| `priority` | acquire/renewで指定する整数。他の所有者から取得するには現在より高い値が必要 |
| `leaseDurationSeconds` | acquire/renewで必須、0.1〜10秒 |
| `suppressSas` | acquire/renewで必須、boolean。状態には反映するが、AstroForgeに自動姿勢保持SASはない |

| `action` | 結果・条件 |
| --- | --- |
| `acquire` | 制御権を取得。成功応答は `state:1, reason:"lease_acquired"`。現在の所有者自身なら更新扱い |
| `renew` | 自分のleaseの期限を延長。例では0.5秒ごとに送り、`sequence`を増やす |
| `release` | 自分のleaseを解放し、全指令をクリア。`state:0`になる |
| `emergency_stop` | 全指令をクリアし、`state:2`で緊急停止。通常のlease所有者でなくても、正しいセッション情報があれば送信可能 |
| `clear_emergency_stop` | 停止させたcontrollerId/leaseIdでのみ解除可能。`state:0`へ戻るので、再開にはacquireが必要 |

release / emergency_stop / clear_emergency_stopには共通情報・`type`・`action`だけで足ります。推力停止後も機体は慣性と重力で飛行を続けます。緊急停止はシミュレーションの一時停止ではありません。

## エンジンを点火・停止する

自分の制御権を確認した後、次のパケットを送ります。`name`はmanifestで列挙された、使用可能なエンジンの名前に置き換えます。

```json
{
  "type": "pylon_actuator_command",
  "version": 1,
  "runtimeInstance": "FROM_HEARTBEAT",
  "runtimeGeneration": 1,
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

これは60,000 N（60 kN）の推力を0.4実時間秒間要求します。燃焼を続けるには期限前に新しいsequenceで更新します。leaseも別途更新してください。

| フィールド | 指定・挙動 |
| --- | --- |
| `actuatorType`, `name` | `engine`、manifestのパーツ名 |
| `enabled` | 必須boolean。falseでそのエンジンを停止 |
| `targetThrust` | 必須、0〜100,000,000 N。実際はエンジンの能力と燃料で制限。0で停止 |
| `hasGimbalCommand` | 省略時false。trueなら下記の個別ジンバル入力を使用 |
| `gimbalPitch`, `gimbalYaw`, `gimbalRoll` | 省略時0、各-1〜1。ピッチ/ヨーの可動範囲は±6° |
| `timeoutSeconds` | 必須、0.05〜10秒 |

最下段のエンジンだけが推力を発生します。未分離の上段への指令は受理されても推力は出ません。`pylon_actuator_state`の`available`・`operational`・`thrust`で結果を確認してください。停止時も`enabled`と`targetThrust`などの必須項目を含めます。

## 姿勢を変える

**ここからのJSON例は操作固有のフィールドです。** そのまま送らず、上の例と同じ共通情報（version、セッション情報5項目、controllerId、leaseId、新しいsequence）を同じオブジェクトに追加してください。

```json
{
  "type": "pylon_flight_control_command",
  "pitch": 0.1,
  "yaw": 0,
  "roll": 0,
  "landingGear": false,
  "timeoutSeconds": 0.4
}
```

`pitch` / `yaw` / `roll`はすべて必須で、-1〜1の正規化入力です。目標角度・角速度ではなく操縦入力なので、0を送っても傾いた機体が自動で直立するわけではありません。角速度などのテレメトリから補正量を計算します。

正のroll/pitch/yawはそれぞれbody +X/+Y/+Z周りの正トルクです。ポッドのリアクションホイール、点火中のエンジンのジンバル、有効にしたRCSが姿勢制御に使われます。エンジン側の`hasGimbalCommand:true`はそのエンジンの個別入力を優先します。中央エンジンの`gimbalRoll`は保持されますが、ロールモーメントは発生せず、ホイールとRCSが担当します。

`landingGear`は必須booleanですが、脚パーツがないため動作は変わりません。`timeoutSeconds`は必須で0.05〜1秒です。

## RCSを有効にする

```json
{
  "type": "pylon_actuator_command",
  "actuatorType": "rcs",
  "name": "rcs_1",
  "enabled": true,
  "thrustLimit": 250,
  "timeoutSeconds": 0.4
}
```

`name`はmanifestのRCS名、`enabled`はboolean、`thrustLimit`は0〜100,000,000 N、期限は0.05〜10秒です。すべて必須です。実際の上限は1ブロックあたり250 Nに制限されます。`enabled:false`または`thrustLimit:0`でそのブロックを停止します。

有効化だけでは一定方向へ噴射しません。姿勢指令に応じてピッチ・ヨー・ロールを補助し、一液式推進剤を消費します。並進方向の力を要求する場合はbody wrenchを使います。

## 段を分離する

```json
{
  "type": "pylon_actuator_command",
  "actuatorType": "separation",
  "name": "separator_1",
  "separate": true
}
```

`name`はmanifestの`actuatorType:"separation"`の名前です。`separate`は必須booleanで、trueで実行、falseなら分離しません。`timeoutSeconds`は不要です。発射台上・着地後・衝突後・電力なし・不明なリングへの分離指令は拒否されます。

リングとその下側の段を切り離し、上段のセッションとleaseを維持します。既存の指令をクリアするので、上段エンジンと姿勢に改めて指令を送ってください。燃料は段をまたいで流れません。

分離後はリング・下段エンジン・下段RCSがmanifestから外れます。リングは`pylon_actuator_state`で`separated:true`を通知し続けます。既に外れたリングへの再指令は拒否され、二重分離はしません。同一時刻の[control snapshot](./telemetry#同じ時刻の状態をまとめて読む)で分離完了と上段の使用可否を確認できます。

## 力・トルクを指定する

```json
{
  "type": "pylon_body_wrench_command",
  "frame": "base_link",
  "force": [60000, 0, 0],
  "torque": [0, 0, 10],
  "timeoutSeconds": 0.4
}
```

`frame`は`base_link`のみ。`force`はN、`torque`はN·mの3要素配列で、各成分は有限数・絶対値100,000,000以下です。期限は0.05〜10秒。すべて必須です。

主エンジンが機首方向（+X）の推力を担い、RCSが残りの力・トルクを共有推力予算の範囲で補います。要求値がそのまま外力として加わるわけではありません。要求と実現値の差は`pylon_wrench_status`で確認します。

wrenchを送ると姿勢指令を解除し、個別エンジン指令より優先します。その後に姿勢または個別エンジン指令を送るとwrenchを解除します。残っている期限内の個別指令が再び有効になり得るため、通常の操縦では指令方式を一つに揃えてください。wrenchはRCSを自動で配分に使うため、先行するRCS有効化指令は不要です。

## 複数の指令をまとめる

`pylon_control_batch`ではエンジン・姿勢・分離とlease更新をまとめられます。次はパケットを組み立てるJavaScript例です。`session`はheartbeatからコピーした5項目、`controllerId` / `leaseId`は取得済みの値、`nextSequence`は新しい番号、`engineName`はmanifestから選んだ名前です。

```js
const common = { version: 1, ...session, controllerId, leaseId, sequence: nextSequence };
const engine = {
  ...common, type: 'pylon_actuator_command', actuatorType: 'engine',
  name: engineName, enabled: true, targetThrust: 60000,
  hasGimbalCommand: false, timeoutSeconds: 0.4
};
const flight = {
  ...common, type: 'pylon_flight_control_command',
  pitch: 0, yaw: 0, roll: 0, landingGear: false, timeoutSeconds: 0.4
};
const batch = {
  ...common, type: 'pylon_control_batch',
  hasFlight: true, hasSeparation: false, renewLease: true,
  leaseDurationSeconds: 2, suppressSas: true,
  engineJson: [JSON.stringify(engine)],
  flightJson: JSON.stringify(flight)
};
const datagram = Buffer.from(JSON.stringify(batch), 'utf8');
// UDPソケットからdatagramを対象機体のcommandPortへ送信する
```

`hasFlight`・`hasSeparation`・`renewLease`は必須boolean、`engineJson`は必須配列（空も可、最大16件）です。メンバーはオブジェクトではなく**JSON文字列**です。外側と内側のversion・vesselId・controllerId・leaseId・sequenceを一致させます。engine/flightの期限はbatch内では0.05〜1秒です。

`hasFlight:true`なら`flightJson`、`hasSeparation:true`なら分離コマンドを文字列化した`separationJson`が必須です。`renewLease:true`なら0.1〜10秒の`leaseDurationSeconds`とbooleanの`suppressSas`を指定します。batchで制御権の新規取得はできません。

全メンバーを検証してから、分離 → エンジン・姿勢の順で適用します。分離と上段点火をまとめる場合、切り離す側のエンジンを含めると全体を拒否します。同じアクチュエータの重複指定も不可です。RCSやwrenchはbatchに含められません。

## 指令の結果とエラー

受信した指令への応答は`pylon_control_authority_state`で、設定済みのテレメトリ用ポートに返ります。`state:1`だけでは成功判定できません。所有者のID、`reason`、エンジンなどの実状態も確認してください。定期配信でも同じパケット種別が届くので、応答がコマンド順に1対1で到着する前提にはしないでください。

| `reason` の例 | 意味・対処 |
| --- | --- |
| `lease_acquired` / `lease_renewed` / `lease_released` | 制御権の取得 / 更新 / 解放に成功 |
| `command_accepted` | 指令の検証・適用に成功。実際の推力は能力・燃料・使用可能な段に依存 |
| `runtime_session_mismatch` | セッション情報が違う。現在のheartbeatから取り直す |
| `lease_not_owned` | 自分のleaseを取得する。所有者のcontrollerId/leaseIdを確認 |
| `authority_held_by_higher_or_equal_priority` | 同じか高いpriorityの所有者がいる |
| `stale_sequence` | 同じ系統の過去の番号以下。sequenceを増やす |
| `control_unavailable` | 着地・墜落などで制御できない |
| `invalid_timeout` | 指令の種類ごとの期限範囲を確認 |
| `unknown_actuator` | manifestを更新し、現在の機体に存在するnameを使う |
| `emergency_stop` | 停止したcontroller/leaseでclearしてから再取得 |
| `batch_identity_mismatch` / `batch_targets_detached_part` | batchの共通情報、または分離後に残るエンジンを確認 |
| `packet_too_large` | UTF-8で32,768 bytes以内に収める |

JSONの構文エラーやその他の入力不備でも拒否理由を返します。調査時はHTTP Stateの `vehicles[].udp.lastCommand` にある`accepted`と`reason`、通信件数も利用できます。
