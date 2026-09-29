# 検証記録

日付: 2026-09-29

- Blender: 5.2.2 LTS, build `d13f752e3b9c`
- 実行用モデル: 75メッシュ、126,594三角形、約5 MB
- 生成: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-launch-complex.py`
- アセット検証: `node --import tsx --test tests/launch-complex.test.js` — 4項目成功
- `npm run typecheck` — 成功
- `npm run build:ui` — 成功（既存の大きなJSチャンクに関する警告あり）
- リモートのパーツモデル等を取り込んだ後、型チェック・UIビルドを再実行し成功。`node --import tsx --test tests/launch-complex.test.js tests/blender-models.test.js tests/map-camera.test.js tests/attachment.test.js` は23項目すべて成功。
- `npm test` — 209件中208件成功、HTTP/UDPライフサイクル1件が20秒の制限でキャンセル。全体成功とは扱っていない。
- `node --import tsx --test tests/api.test.js` の単独再実行 — 初回は85行目の60ms待機後のUDP応答検出で失敗。レンダリング終了後の再実行も20秒でタイムアウトした。原因は未確定で、この描画変更ではHTTP/UDP側を変更していない。
- Codex内ブラウザの `http://127.0.0.1:5173/tests/launch-complex.html` で、実際のGLB読み込み、全体、搬送路とVAB、発射台、通常の飛行視点を確認。コンソールのerror/warnなし。

重複していた発射台エプロン・搬送路・VAB床を切り分け、道路の交差点を和集合の面へ置き換えた。接地高さと上昇軸を維持し、搬送路の連続性・VAB開口・代表点での重複面の不在を実モデルへのレイで検証した。

Blenderは制限付きプロセスでMetal初期化時にクラッシュしたため、通常権限のバックグラウンドプロセスで生成・保存した。ROS2デモ、bridge、サーバー、物理計算には変更を加えていない。

最終の確認画像は、保存済み.blendをBlender EEVEEで1440 × 990ピクセルにレンダリングした。CPU Cyclesの出力が長時間化したため切り替えたもので、GLBの形状・材質は同一。overview.pngで床・道路交差点の黒い重複面の解消を確認した。
