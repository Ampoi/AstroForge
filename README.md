# AstroForge

ブラウザでロケットを組み立て、自分のプログラムからUDPで操縦するローカルシミュレーターです。エンジンの点火・姿勢制御・段の分離をJSONで指令し、高度・速度・燃料・アクチュエータ状態を受信できます。外部サービス、アカウント、APIキーは不要です。

エンジンのノズルと噴流は各エンジンのTVCに追従します。噴流は機体の並進・回転速度を引き継ぎ、大気との混合、渦、浮力、地面・機体表面での流れを粒子で近似します。降下中の巻き上がりや横移動時の流れを描画しますが、燃焼・圧縮性流体の厳密な解析ではなく、飛行の力学には影響しません。粒子数は全エンジン合計2,400個までです。

## 起動して飛ばす

Node.js **22.12以降**、[Zig **0.16.0**](https://ziglang.org/download/)、Gitを用意します。現在はソースから起動するため、利用する場合も初回ビルドにZigが必要です。

```sh
git clone https://github.com/Ampoi/AstroForge.git
cd AstroForge
npm ci
npm start
```

[http://localhost:3000/](http://localhost:3000/)を開きます。保存機体のない初回起動では、2段機体「Pathfinder 02 / Two stage」が発射台に配置され、UDP ONになっています。

別のターミナルで同じフォルダに移動して、付属のUDPコントローラーを実行します。

```sh
npm run demo
```

制御権を取得すると自動点火し、第1段の燃料切れで分離、上段を点火します。予測遠地点160 kmで推力を止め、4分で制御を終了します。デモ側のCtrl+Cでも推力を切り、制御権を返します。物理計算は続くため、サーバー自体を終了する場合は`npm start`側のターミナルでCtrl+Cを押してください。

「機体」メニューから保存機体・プリセットを選ぶか、「新しい機体を作る」でVAB（組立室）を開けます。「発射台へ」は配置のみで、点火はUDP指令で行います。追加した機体はUDP OFFなので、一覧でONにして、その機体の「接続コマンド」を実行してください。

## ボタン・スライダーでUDPを送るデモ

本体とは別ポートのダッシュボードを起動できます。

```sh
npm run demo:dashboard
```

[http://localhost:3018/](http://localhost:3018/)で送信先ポート・対象の`name`を指定し、ボタンでUDP指令を送ります。エンジン出力はN単位のスライダーで調整できます。切り離し・姿勢入力・RCS・力／トルク・任意JSONの送信にも対応します。

機体の形状や段数に依存せず、manifestは名前の入力候補にだけ使用します。デモは独自の画面・サーバーを持つ外部UDPクライアントで、本体のHTTP API・内部状態にはアクセスしません。[起動方法と操作](examples/udp-dashboard/README.md)を参照してください。

## Pathfinder3の低地球軌道投入

2段式の軌道投入機 **Pathfinder3** と、SpaceROS上で動く独立したROS2自動操縦デモを用意しています。機体プリセットを発射台へ配置し、公開UDP bridgeを介して点火・段分離・約200 kmへの軌道投入を行います。

[ビルド・SpaceROSチェック・打ち上げ手順](examples/pathfinder3/README.md)を参照してください。

## UDPで何を送る・受け取るか

以下は初期機体の既定ポートです。どちらもクライアント側から見た向きです。

| 用途 | アドレス・形式 |
| --- | --- |
| コマンドの送信先 | `127.0.0.1:49011/UDP` |
| テレメトリを受け取るためにbindする先 | `127.0.0.1:49010/UDP` |
| パケット | 1 datagramに1つのUTF-8 JSON、`version:1` |
| 配信周期 | 実時間20 Hz、1周期に複数のパケット |

1. テレメトリ用ポートで`pylon_session`を受信し、セッション情報を取得します。
2. `pylon_control_authority_command`の`acquire`で制御権を取得し、応答で自分のleaseを確認します。
3. manifestにあるエンジン名へ`pylon_actuator_command`を送り、例えば`targetThrust:60000`で60 kNの推力を要求します。
4. `pylon_flight_control_command`で姿勢入力、`actuatorType:"separation"`で段の分離を指令できます。
5. 指令とleaseを期限前に更新し、終了時は推力を0にして`release`します。

受信側には高度・速度・燃料を含む`pylon_flight_state`、位置・姿勢の`pylon_ground_truth`、`pylon_imu`、各エンジンや分離リングの`pylon_actuator_state`などが届きます。**指令の応答もテレメトリ用ポートに届き、送信元の一時ポートには返信しません。**

具体的なJSON・必須フィールド・単位・期限は、以下のドキュメントを参照してください。

## ドキュメント

起動後は [http://localhost:3000/docs/](http://localhost:3000/docs/) で読めます。ヘッダーのGitHubアイコンからリポジトリへ移動できます。

| 読みたい内容 | ページ |
| --- | --- |
| 導入、デモ、組み立て、複数機体、起動設定、トラブル対処 | [クイックスタート](docs/guide.md) |
| ポートの向き、セッション、制御権、期限、再接続 | [UDP接続と通信の流れ](docs/protocol.md) |
| 何を送るとどう動くか、JSON例、拒否理由 | [送るコマンドと機体の挙動](docs/udp/commands.md) |
| 受信するパケット、各フィールドの意味、Python受信例 | [受け取るテレメトリ](docs/udp/telemetry.md) |
| 衝突、時間倍率、物理モデルと制約 | [シミュレーション](docs/simulation.md) |
| 機体の保存・配置や状態取得を自動化する | [HTTP / SSE](docs/api/http.md)、[機体スキーマ](docs/api/schema.md) |

PyLoN v1の飛行制御に関係するサブセットを実装しています。対応範囲は[UDP仕様](docs/protocol.md#pylonとの対応範囲)を参照してください。初期機体は弾道飛行用です。物理モデルは係数に基づく教育・制御実験向けの近似です。

ROS2で接続する場合は[PyLoN](https://github.com/PyLoN-sim/PyLoN)を別途cloneし、そのbridgeとメッセージ定義を利用します。PyLoNのROS2コードは同梱していません。[取得・ビルド・接続手順](docs/ros2.md)を参照してください。AstroForge単体の起動や直接のUDP通信にはPyLoNもROS2も不要です。

## 貢献

AstroForge本体を開発する方は、[開発・ビルド・コード構成](docs/contributing.md)を参照してください。

- 開発起動：`npm run dev`
- ビルドと検証：必要なコマンドと生成物を[ビルド手順](docs/contributing.md#ビルドする)にまとめています。
- コードの配置：UI・サーバー・物理計算・共有コード・サンプルは[フォルダ一覧](docs/contributing.md#フォルダとコードの配置)を参照してください。
- 不具合報告・機能提案：[Issues](https://github.com/Ampoi/AstroForge/issues)、変更の提案：[Pull Requests](https://github.com/Ampoi/AstroForge/pulls)。
