# 月面テクスチャ

Credit: **NASA's Scientific Visualization Studio**. Color: LRO / LROC WAC (Arizona State University). Elevation: LRO / LOLA.

出典: [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/)（2019版の色、LOLA標高）。観測由来の色・地形を使い、ランダムなクレーターは追加していません。NASAの色マップ自体は可視化向けに色調整され、極域は低解像度のアルベドデータで補われています。科学解析・衝突判定用のデータではありません。

同梱する `color.png` と `normal.png` は4096×2048。色は元画像のRGBをそのまま保持し、標高は5760×2880から浮動小数点で縮小して法線に変換しています。画像はローカルから読み込み、実行時の外部通信・地形生成・Python実行はありません。

## 再生成

Node.jsの通常の開発依存に加え、**Python 3とPillow**が必要です（検証: Python 3.12.3 / Pillow 10.2.0）。元TIFFは配布バンドルに含めません。リポジトリルートで取得してから生成します。

```sh
mkdir -p artifacts/moon-source
curl --fail --location https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif -o artifacts/moon-source/lroc_color_poles_4k.tif
curl --fail --location https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif -o artifacts/moon-source/ldem_16_uint.tif
npm run build:moon
```

取得済みTIFFを使う場合は `npm run build:moon -- /path/to/source`。生成処理はネットワークを使わず、元データのSHA-256を検証します。

| 元ファイル | SHA-256 |
| --- | --- |
| lroc_color_poles_4k.tif | `918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f` |
| ldem_16_uint.tif | `45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62` |

- 色はsRGB。法線は線形RGB、OpenGL形式（赤=東向き、緑=北向き）。
- LOLAの符号なし標高を `値 × 0.5 − 10000` で月半径1737.4 kmに対するメートルへ変換。緯度ごとの画素間隔を使って法線を計算し、極付近の不安定な勾配を弱めています。
- 北が画像上端、経度0が中央。描画では中央を地球側の面（ローカル+Z）に合わせます。
- 太陽の方向に応じた陰影は法線マップで計算。視認性のため法線強度は1.35倍。地形の自己遮蔽・凹凸による輪郭の変形は表現しません。
- PNG合計24,504,831 bytes。GPU上のRGBA8＋ミップは約85.3 MiB。
