# Pathfinder3 — ROS2 orbital ascent

Pathfinder3を地表から約200 kmの低地球軌道へ投入する、独立したROS2クライアントです。

```text
OrbitController (SpaceROS / ROS2)
    ├─ ControlBatch・ControlAuthorityCommand → pylon_bridge → 公開UDP → AstroForge
    └─ ControlSnapshot・ControlAuthorityState・VesselLifecycle ← bridge ← 公開UDP
```

デモは本体のHTTP API・保存データ・内部モジュールを使用せず、本体の起動・終了も管理しません。通常のROS2 Jazzyだけでなく、固定したSpaceROSイメージでビルド・テスト・実飛行を検証します。

## 機体

本体の「機体」→「保存機体・プリセットを選ぶ」から **Pathfinder3** を選択できます。2段式、上段タンク3個・離陸段タンク8個、24パーツです。初期質量15,269 kg、海面推力350 kN、推力重量比2.34、理想真空Δv約10.95 km/s。Δvは重力・空気抵抗・姿勢変更の損失を含みません。

通常パーツとして追加したエンジンは他の機体でも使用できます。

| パーツ | 海面推力 | 真空推力 | 比推力（海面 / 真空） | 乾燥質量 |
| --- | ---: | ---: | ---: | ---: |
| LE-350 Peregrine | 350 kN | 396.7 kN | 300 / 340 s | 500 kg |
| LE-80 Albatross | 49.8 kN | 80 kN | 280 / 450 s | 180 kg |

これらはAstroForgeの教育用モデルの設計値です。既存のLE-60、重力・大気・質量消費の計算方式は維持し、エンジンごとの定義値を適用します。新しいタンクは不要で、既存のFT-1200を使います。

## ビルドとSpaceROSチェック

リポジトリのルートで実行します。Dockerが必要です。

```bash
examples/pathfinder3/spaceros.sh build
examples/pathfinder3/spaceros.sh check
```

基底イメージは `osrf/space-ros:jazzy-2026.07.0`（Dockerfileでdigestを固定）。`pylon_interfaces`・同梱の`pylon_bridge`・`pathfinder3`を専用ワークスペースへビルドします。`check`は外部ネットワークを切ったコンテナでcolconとpytestを実行し、実際のbridge・ROS2クライアントと模擬UDP相手との往復も確認します。AstroForgeは起動しません。

## 打ち上げ

1. 別ターミナルで本体を起動します（`npm start`）。
2. 機体メニューからPathfinder3を選び「発射台へ」。追加された機体のUDPをONにし、画面の送受信ポートを確認します。
3. その機体に接続する他のコントローラーを停止し、**指定したコマンドポートとテレメトリポート**でデモを開始します。

```bash
# ポートは画面の実際の割り当てで置き換える。以下は一例。
PATHFINDER3_OUTPUT=/tmp/pathfinder3-my-flight \
  examples/pathfinder3/spaceros.sh run \
  command_port:=49013 telemetry_port:=49012
```

このコマンドを実行すると、制御権の取得後に**自動点火**します。AstroForgeの「接続コマンド」は既存の弾道飛行デモ用なので、このミッションでは上のコマンドを使ってください。画面の時間倍率は×1、または検証済みの×5。途中で倍率を変更せずに飛行してください。「マップ」で予測軌道を表示できます。

`PATHFINDER3_OUTPUT`は新しいディレクトリを指定します。省略時は`/tmp/pathfinder3-日時`です。`telemetry.csv`と`result.json`を保存し、既存のCSVは上書きしません。合否は`result.json`の`success`で判定してください。完了後もbridgeと本体画面を残します。デモ側の終了はCtrl+Cで、本体は別ターミナルで終了します。

設定済みのミッションの対象名は、離陸段から順に `booster_engine,upper_engine`、分離リングは`stage_separator`です。ROS2クライアント自体にはこれらの固定IDを埋め込まず、launch引数で渡します。別の名前を使う場合：

```bash
examples/pathfinder3/spaceros.sh run \
  command_port:=49013 telemetry_port:=49012 \
  engines:=my_booster,my_upper separators:=my_separator \
  target_altitude:=200000.0
```

段の順序と対象名は利用者が指定します。名前からROS IDへの対応は同じ時刻のControlSnapshotから取得します。名前・構成・目標を変更した機体の飛行性能は別途検証してください。

## 誘導・成功条件・停止

`BOOST → SEPARATION → STAGE_CLEARANCE → INSERTION → ORBIT_VERIFY`の順に進みます。第1段のflameoutを観測したら指定リングを分離し、分離済みの観測と1秒のクリアランスを待って上段を点火します。上段では慣性速度・高度・重力から鉛直と接線方向の必要加速度を計算し、推力と姿勢を同じ要求加速度に合わせます。

成功条件は次のすべてです。

- 近地点が195 km以上、遠地点が225 km以下で、大気上端より高い位置で推力停止。
- その後60シミュレーション秒、近地点190 km以上・遠地点230 km以下を維持。
- 最終観測の実推力が1 N未満。

単に高度200 kmに達した弾道飛行を成功とは判定しません。制御権の取得応答を待ち、飛行指令の期限は0.4実秒、leaseは2実秒です。古い観測は破棄し、セッション変更・制御権喪失・観測途絶・分離確認のタイムアウト・上段の燃料切れでは停止します。終了時は所有中のleaseだけを解放します。

## 開発用の実飛行fixture

本体側の検証用fixtureは、普段の機体データと別の一時ディレクトリでアプリを起動し、Pathfinder3を発射台へ配置します。デモの実行時依存には含みません。

```bash
# ターミナル1：本体の隔離fixture、末尾は倍率（1または5）
PORT=3033 UDP_COMMAND_PORT=49311 UDP_TELEMETRY_PORT=49310 \
  node --import tsx tests/pathfinder3-launch.js 1

# ターミナル2：起動ログに表示された実際のUDPポートを指定
examples/pathfinder3/spaceros.sh run command_port:=49311 telemetry_port:=49310
```

ポート使用中は本体が次の空きポートを割り当てるので、ログを必ず確認します。本体は [localhost:3033](http://localhost:3033/) で表示できます。

[実飛行とチェックの記録](VALIDATION.md)も参照してください。
