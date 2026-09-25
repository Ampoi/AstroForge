# Pathfinder3 検証記録 — 2026-09-25

## 外部PyLoNへの移行後の再検証

AstroForgeから`Ros2/`の同梱ソースを削除し、別リポジトリのPyLoNをビルド時に指定する構成で検証した。

- 外部PyLoN: `/home/ampoi/Documents/PyLoN_dev/PyLoN`、リビジョン`d62d948064d6665702d05957a669596244dca8da`。外部リポジトリへの変更なし。
- SpaceROS: `osrf/space-ros:jazzy-2026.07.0@sha256:a7df4a7bbb7019b45842ce60f4fb7998dcc64ad383c02e9c76ce082031c39fe5`、Python 3.12.3、CycloneDDS。
- 検証イメージ: `astroforge-pathfinder3:jazzy-2026.07.0`、image ID先頭`2fc11a4d097e`。

AstroForgeのルートから実行:

```bash
PYLON_ROOT=/home/ampoi/Documents/PyLoN_dev/PyLoN examples/pathfinder3/spaceros.sh build
examples/pathfinder3/spaceros.sh check
python3 tests/upstream_compatibility.py /home/ampoi/Documents/PyLoN_dev/PyLoN --systems
python3 tests/upstream_compatibility.py /home/ampoi/Documents/PyLoN_dev/PyLoN --rover
python3 tests/bridge_roundtrip.py /home/ampoi/Documents/PyLoN_dev/PyLoN
bash -n examples/pathfinder3/spaceros.sh
npm run docs:build
git diff --check
```

- 外部の`pylon_interfaces`・`pylon_bridge`とデモの計3パッケージをSpaceROS内でビルド成功。
- `colcon test`・`colcon test-result`成功。明示的なpytestでもbridge 183件とデモ12件、合計195件成功、失敗・skipなし。
- 実際のbridge・ROS2クライアントと模擬UDP相手で、取得応答を待つ点火、指令期限、lease更新・解放、セッション変更・制御権喪失・観測途絶時の停止、段分離の状態遷移を確認。本体アプリを起動せず`--network none`で実施。
- 外部PyLoNによる互換性チェック: systems 425パケット・8指令、rover 106パケット・4指令を確認。実UDP往復も着地・墜落の両ケースで成功。
- shell構文、ドキュメントビルド、差分チェック成功。存在しない`PYLON_ROOT`はDockerを起動する前に明示的なエラーで停止することも確認。
- 本体のサーバー・UI・API・物理計算・ライフサイクルへの変更なし。今回は依存ソースの取得方法の変更であり、実飛行・軌道投入は再実行していない。以下は移行前の同梱構成で実施した記録。

## 構成と独立性

- 基底イメージ: `osrf/space-ros:jazzy-2026.07.0@sha256:a7df4a7bbb7019b45842ce60f4fb7998dcc64ad383c02e9c76ce082031c39fe5`。
- SpaceROSコンテナ内で同梱の`pylon_interfaces`・`pylon_bridge`・`pathfinder3`をビルド。Python 3.12、CycloneDDS。
- 本体は別プロセスのAstroForge、Zig/Wasm物理計算120 Hz、公開UDP観測20 Hz。
- デモの飛行IOはROS2 topicのみ。本体との境界は既存の公開UDP。デモからHTTP・保存機体・内部状態へアクセスしない。
- 本体の変更は通常の機体機能としてのエンジン2種類、エンジン別推力・比推力の適用、Pathfinder3プリセット、および既存の組立・表示・UDPでの新エンジン対応。デモのimport・起動・誘導・終了管理は追加していない。
- `tests/pathfinder3-launch.js`は本体側の検証用fixture。日常の保存先とは別の一時データと専用ポートでアプリを準備する。ROS2デモの実行時依存には含めない。

## チェック

```bash
examples/pathfinder3/spaceros.sh build
examples/pathfinder3/spaceros.sh check
npm run typecheck
npm run build:ui
npm run docs:build
node --import tsx --test --test-isolation=none tests/*.test.js
git diff --check
```

- 本体: 169テスト成功。型検査・UIビルド・ドキュメントビルド成功。
- Node.js 26.1.0での検証では、tsx併用時にファイル単位の成功だけを出す実行を避け、`--test-isolation=none`で各テストケースの実行と件数を確認。
- SpaceROS: `colcon build`で3パッケージ成功。`colcon test`・`colcon test-result`と明示的なpytestでbridgeおよびデモを確認。bridge 183件、デモ12件の合計195テストが成功し、失敗・skipは0件。
- UDP往復試験は`--network none`のコンテナ内のループバックだけで実施し、AstroForgeアプリは起動しない。取得応答の欠落中は点火しないこと、指定した名前の保持、lease更新・解放、セッション変更・制御権喪失・観測途絶時の停止、分離確認前の上段点火禁止、分離再送の同一操作IDを確認。
- 終端誘導の回帰テストでは、軌道速度に近づいた際の推力を必要加速度から求めることを確認。高度だけを成功と判定せず、停止後の近地点・遠地点を継続確認。
- ブラウザでPathfinder3のマップ表示を確認。表示中のconsole error/warnなし。

- 最終チェック用イメージ: `astroforge-pathfinder3:jazzy-2026.07.0`、image ID `sha256:97c8b14b9ca09b4fd4d9f761c54eb81b4d0e38328da2fe2ee222d87c2dd01498`。

## 実飛行 — ×5

`PORT=3033`の隔離アプリへ、SpaceROSのbridgeとコントローラーを接続して実打ち上げ。第1段燃焼、分離、上段点火、推力停止、60シミュレーション秒の無推力飛行まで完了した。

| 指標 | 結果 |
| --- | ---: |
| 合否 | SUCCESS |
| 最終高度 | 200.150 km |
| 最終近地点 | 195.045 km |
| 最終遠地点 | 203.840 km |
| 最終水平速度（回転地表基準） | 7,308.802 m/s |
| 最終実推力 | 0 N |
| 残燃料 | 約246.9 kg |
| 点火から分離開始 | 80.93シミュレーション秒 |
| 点火から上段点火 | 82.18シミュレーション秒 |
| 点火から推力停止 | 376.42シミュレーション秒 |
| 観測数 | 1,745 |
| 最大観測間隔 | 0.0615実秒 |
| デモの所要実時間 | 87.45秒 |

[結果JSON](validation/flight-5x.json)と[ROS観測CSVの抜粋](validation/flight-5x.csv)を同梱。CSVは約5シミュレーション秒ごとに加え、phase切り替えと最終行を保持したもの。時刻は本体のuniversal timeで、launch開始はJSONの最初のtransitionを参照。デモ実行中はCSV全観測を保存する。

初回の誘導では終盤の絞り込み時に姿勢計算が最大推力のままで遠地点が過大になった。鉛直・接線の要求加速度から推力と姿勢を一貫して求める方式へ修正し、上記飛行と回帰テストで確認した。

任意の機体構成や倍率変更を含む全条件での軌道投入を保証するものではない。成功判定の継続時間は60シミュレーション秒であり、一周分の耐久試験ではない。

## 実飛行 — 通常の×1

通常速度でも独立したアプリ（HTTP3034、UDP49710/49711）とSpaceROSで離陸から無推力確認まで成功。同じ誘導計算を使用し、近地点195.004 km・遠地点203.825 km、最終高度200.153 km、最終推力0 Nだった。観測8,711件、最大観測間隔0.0622実秒未満、所要436.17実秒（約7分16秒）。

[結果JSON](validation/flight-1x.json) / [ROS観測CSVの抜粋](validation/flight-1x.csv)。この通常速度試験は分離再送の操作ID固定を追加する前のイメージで実施し、操作ID固定を含む最終ビルドは上記×5の再打ち上げとSpaceROSのUDP往復テストで確認した。最終ビルドの誘導計算・機体・物理計算は同一。
