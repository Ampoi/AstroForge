---
layout: home
hero:
  name: AstroForge
  text: 組み立てて、UDPで飛ばす。
  tagline: ロケットをブラウザで組み立て、自分のプログラムから操縦するローカルシミュレーター。
  actions:
    - theme: brand
      text: クイックスタート
      link: /guide
    - theme: alt
      text: UDPで制御する
      link: /protocol
    - theme: alt
      text: テレメトリを読む
      link: /udp/telemetry
features:
  - title: まずは飛ばしてみる
    details: 起動から最初のフライトまでを案内。付属デモで2段ロケットの点火・姿勢制御・分離を試せます。
    link: /guide
  - title: 何を送ると、どう動くか
    details: UTF-8のJSONをUDPで送信。制御権の取得、推力の指定、姿勢入力、段の分離を例とともに説明します。
    link: /udp/commands
  - title: 飛行結果をプログラムで読む
    details: 高度・速度・姿勢・燃料・エンジン状態を実時間20 Hzで受信。受信用ポートと各フィールドの意味を確認できます。
    link: /udp/telemetry
---

## このドキュメントの読み方

1. [クイックスタート](./guide)でAstroForgeを起動し、デモを実行します。
2. [UDP接続](./protocol)で送信先・受信先と制御権の扱いを確認します。
3. [コマンド](./udp/commands)と[テレメトリ](./udp/telemetry)を使い、自分のコントローラーを作ります。

機体の保存・配置をプログラムから操作する場合は[HTTP / SSE](./api/http)、時間倍率や衝突の挙動は[シミュレーション](./simulation)を参照してください。

## 貢献

AstroForge本体の開発に参加する方は、[開発環境・ビルド・コード構成](./contributing)へ進んでください。ソースコードとIssue・Pull Requestは[GitHub](https://github.com/Ampoi/AstroForge)にあります。
