# UDP接続と通信の流れ

自分のプログラムからAstroForgeを操縦するには、UDPでJSONのコマンドを送り、別のポートでテレメトリ（飛行状態）を受け取ります。まず[クイックスタート](./guide)でサーバーを起動し、対象機体をUDP ONにしてください。

## 送るポート・受け取るポート

以下は初期機体の既定値です。「送信・受信」の向きをクライアント側から示します。

| クライアントで行うこと | アドレス | 内容 |
| --- | --- | --- |
| コマンドを送信する | `127.0.0.1:49011` | 制御権の取得、推力・姿勢・分離の指令 |
| ソケットをbindして受信する | `127.0.0.1:49010` | セッション、指令への応答、飛行状態、アクチュエータ状態 |

```text
自分のUDPクライアント                         AstroForge
  任意の送信元ポート ── JSONコマンド ───────→  :49011
  :49010をbind      ←─ 応答・テレメトリ ────  機体の状態
```

画面の機体一覧にある「受信」はAstroForgeが受け取るコマンドのポート、「送信」はクライアントに届けるテレメトリのポートです。**応答もテレメトリ用ポートに届きます。コマンドを送った一時ポートには返信しません。** 送信用・受信用ソケットを分けても、テレメトリ用にbindした1つのソケットで送受信しても構いません。

- UDP/IPv4、UTF-8 JSON。1 datagramに1つのJSONオブジェクトを入れます。改行区切りやJSON配列で複数のコマンドをまとめないでください。
- コマンドは最大32,768 bytes、`version`は数値の`1`です。
- UDP ONの各機体から実時間20 Hzで一組のテレメトリを送ります。1周期に複数のdatagramが届くため、20パケット/秒という意味ではありません。
- UDPの欠落・重複・順序の入れ替わりを考慮し、受信バッファは65,535 bytesを確保してください。通信の再送保証・UDP認証はありません。

具体的な入力は[送るコマンドと機体の挙動](./udp/commands)、出力は[受け取るテレメトリ](./udp/telemetry)にまとめています。

## 接続から点火まで

1. 対象機体のテレメトリ用ポートをbindします。同じポートを使うデモは先に終了します。
2. `pylon_session`を待ち、`available:true`で観測セッションが有効なことを確認します。これは操縦許可ではありません。
3. 下表のセッション情報5項目をコピーします。`controllerId`と`leaseId`はクライアントで決めます。
4. `pylon_control_authority_command`の`action:"acquire"`を送ります。
5. 受信する`pylon_control_authority_state`が`state:1`で、自分の`controllerId`と`leaseId`になったことを確認します。
6. `pylon_actuator_manifest`からエンジン名を取得し、`pylon_actuator_state`で`available:true`のエンジンを選んで推力を指令します。
7. 指令を約50 msごとに更新し、leaseも失効前にrenewします。例として指令期限0.4秒、lease期限2秒・更新間隔0.5秒を使えます。
8. 終了時はエンジン推力を0にし、`action:"release"`を送ります。物理計算は続きます。

制御権を取っただけでは点火しません。`targetThrust`を送ることで推力が発生し、機体重量を上回ると発射台を離れます。[制御権と点火のJSON例](./udp/commands#制御権を取得・更新・解放する)を参照してください。

## すべてのコマンドに付ける情報

| フィールド | 値・用途 |
| --- | --- |
| `type` | 操作ごとのパケット種別 |
| `version` | 数値の `1` |
| `runtimeInstance` | heartbeatからそのままコピー |
| `runtimeGeneration` | heartbeatから数値のままコピー |
| `runtimeEpoch` | heartbeatからそのままコピー |
| `runtimeVesselId` | heartbeatからそのままコピー |
| `vesselId` | heartbeatからそのままコピー。HTTPの `vehicles[].id` とは別 |
| `controllerId` | クライアントを識別する空白のみではない文字列、1〜64文字 |
| `leaseId` | 今回の接続を識別する空白のみではない文字列、1〜64文字。UUIDなどを生成 |
| `sequence` | 1〜9,007,199,254,740,991の整数。送信するたびに増やす |

5つのruntime/vesselフィールドをまとめて「セッション情報」と呼びます。値を推測したり、HTTPの機体IDを代入したりせず、対象ポートで受け取ったheartbeatから取得してください。複数機体で`runtimeInstance`が共通とは限りません。

sequenceは制御権・姿勢・wrench・各アクチュエータ・batchの系統ごと、controller/leaseごとに検査します。クライアント側では全指令に共通の連番を使えば扱いやすくなります。同じ指令を再送するときも新しい番号を使います。batch内だけは外側と子コマンドの番号を一致させます。

## 期限と停止

| 期限 | 許容範囲（実時間の秒） | 期限切れの挙動 |
| --- | --- | --- |
| `leaseDurationSeconds` | 0.1〜10 | 制御権を解放し、全指令をクリア |
| 姿勢の `timeoutSeconds` | 0.05〜1 | 姿勢入力を0に戻す |
| engine / RCS / wrenchの `timeoutSeconds` | 0.05〜10 | その指令を適用しなくなる |
| batch内の指令の `timeoutSeconds` | 0.05〜1 | 各指令の期限で停止。分離には期限フィールド不要 |

`release`、所有者の交代、緊急停止、UDP OFFでも指令をクリアします。lease更新だけではエンジンなどの指令期限は延びません。自作コントローラーも通信が途絶えたら新しい指令の送信を停止する設計にしてください。

時間倍率×2 / ×5 / ×10でも、期限と20 Hz配信は実時間で判定します。`universalTime`だけはシミュレーション速度に応じて進みます。

## 複数機体・再接続

初期機体はUDP ON、追加配置した機体はOFFです。機体一覧の「UDP ON/OFF」または[HTTP /api/control](./api/http#post-api-control)で切り替えます。カメラの「追尾」はUDP制御対象を変更しません。

初回ON時に専用ポートを割り当てます。既定では `49011/49010`、`49013/49012` のように2ずつ増やしますが、使用中のコマンド受信ポートや他機体への割り当てと重なる組はスキップします。実際の値は機体一覧、またはHTTP Stateの `vehicles[].udp.commandPort` / `telemetryPort` を参照してください。テレメトリ用ポートはサーバーではbindしないので、クライアント側の競合も確認します。

| 操作・状態 | 通信への影響 |
| --- | --- |
| VABを開く、カメラ追尾を変える | 飛行・配信・セッションを維持 |
| 段を分離する | 上段が同じセッションとleaseを維持。既存の推力・姿勢指令はクリア |
| 機体をUDP OFFにする | その機体の送受信を停止し、leaseと指令を解除。ポート割り当ては保持 |
| 同じ機体を再ONにする | 同じポートで新しいセッションを発行。heartbeatを読み直し、新しいleaseでacquire |
| 未発射機体を置き換える | 旧機体の通信と割り当てを破棄。新機体をONにして接続し直す |
| 旧API `/api/revert` で全リセットする | 全UDPソケット・割り当てを解放。heartbeatも停止。配置された機体はOFF |
| 着地・墜落して機体が残る | `available:true`で結果テレメトリを継続。leaseを解除し、制御指令は拒否 |
| 破損して元の機体が消失する | `available:false`。制御指令は拒否 |

セッション情報が変わったら、古い情報での送信を止め、受信状態と連番を作り直して接続してください。他機体のON/OFFは既存の機体のセッションに影響しません。分離物や破片は追尾のみ可能です。

## 観測と操縦を分ける

| 判断したいこと | 確認するもの |
| --- | --- |
| 同じ機体の結果を観測できるか | 新鮮な`pylon_session.available:true`と一致するセッション情報 |
| 自分が操縦権を持つか | acquire応答の`state:1`、自分の`controllerId` / `leaseId`、lease期限 |
| 指令が受理されたか | authority応答の`reason`と、その後の適用状態 |
| 飛行が終わったか | flightの着地遷移やauthorityの`vessel_landed` / `vessel_crashed` |

着地・墜落では観測を継続し、操縦だけを停止します。lease喪失を理由に購読を終了すると、その後に届く最終結果を取りこぼします。UDPの到着順は保証されないため、authorityとsnapshotのどちらが先でも処理できるようにしてください。詳細は[テレメトリ](./udp/telemetry)を参照してください。

## 座標と単位

軸の図、UDPとROS2のフィールド対応、発射台での実測値、300m上昇の計算例は[座標・高度の読み方](./udp/coordinates)にまとめています。

| 表現 | 意味 |
| --- | --- |
| `base_link` / body | 機体固定の右手系。+X=機首、+Y=左、+Z=上 |
| 正のroll / pitch / yaw | それぞれbody +X / +Y / +Z周りの正トルク |
| ENU | 地球固定の東・北・上。ground truthの位置原点は初期発射台の重心位置 |
| ECI | 内部の地球中心慣性座標。初期発射台の上方向+X、東+Y、北+Z |
| ベクトル・quaternion | `[x,y,z]` / `[x,y,z,w]` |
| 通常の単位 | m、s、kg、N、N·m、rad、Pa。緯度・経度のみ度 |
| 燃料 | `liquidFuel` / `oxidizer` は各1 unit=5 kg。総推進剤kgは `(liquidFuel + oxidizer) * 5` |
| 電力 | `electricCharge` / `electricCapacity` は各1 unit=1 Wh |

`altitudeAsl` / `altitudeAgl`は球面地表から重心までの高度で同じ値です。ブラウザの高度は初期重心高度を差し引くので、UDPより数m小さくなります。脱出軌道のUDP表現は `apoapsis:0, timeToApoapsis:0, orbitBound:false` です。

## PyLoNとの対応範囲

[PyLoN v1の参照リビジョン](https://github.com/PyLoN-sim/PyLoN/tree/d62d948064d6665702d05957a669596244dca8da)を参照して実装しています。飛行制御・車輪・搭載センサー・可動機構・観測に対応します。パーツ名はAstroForgeの保存パーツIDなので、固定名を前提にせずmanifestから取得してください。KSP用の制御ゲイン・質量・重力・推力パラメーターをそのまま流用できるとは限りません。

車輪はPyLoNの目標角速度・操舵角・駆動トルク指令と状態配信に対応しています（[ローバー](./rover)）。

LiDAR、RGBカメラ、スタートラッカー、URDF/TF、パーツ温度、近隣機体、ロボティクスmotor、分離結果ジャーナル、ドッキング、標準ROS2 bridgeと汎用制御ノードについては[センサー・可動機構・ドッキング・ROS2](./systems)を参照してください。近似モデルと上流との差も記載しています。UDPパケット単独での制御対象切り替えとKSP用craft-builderは未対応です。

動くクライアントの例は[Node.jsデモ](https://github.com/Ampoi/AstroForge/blob/main/examples/demo-controller.ts)と[Pythonサンプル](https://github.com/Ampoi/AstroForge/blob/main/examples/launch.py)にあります。本体への機能追加は[貢献](./contributing)を参照してください。
