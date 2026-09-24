---
layout: home
hero:
  name: AstroForge
  text: Flight Simulation API
  tagline: 組み立てた機体を、コードで飛ばす。
  actions:
    - theme: brand
      text: クイックスタート
      link: /guide
    - theme: alt
      text: HTTP API
      link: /api/http
    - theme: alt
      text: UDPリファレンス
      link: /protocol
features:
  - title: 複数機体
    details: 同じ地球・同じシミュレーション時刻で機体と分離物を計算。追尾カメラとUDP制御対象は独立して選択できます。
  - title: 固定ステップの物理計算
    details: 6自由度、地球自転、重力、空力、燃料消費。1/120秒の刻みを保ったまま最大10倍速で計算します。
  - title: ローカルAPI
    details: HTTPで機体とワークスペースを管理し、SSEで状態を受信。エンジンと姿勢はPyLoN v1 UDPで制御します。
---
