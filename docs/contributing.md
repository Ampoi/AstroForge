# 貢献

AstroForge本体を改修する方向けの、開発環境・ビルド・コード構成です。外部コントローラーを作る場合は[UDP接続](./protocol)から始められます。

不具合報告や機能提案は[GitHub Issues](https://github.com/Ampoi/AstroForge/issues)、コードやドキュメントの変更は[Pull Requests](https://github.com/Ampoi/AstroForge/pulls)へ。報告には再現手順、Node.js・Zigのバージョン、対象機体、使用したUDPポート・コマンド、期待した結果と実際の結果を添えてください。

## 開発環境を起動する

Node.js 22.12以降と、`.zig-version`で指定されたZig 0.16.0を用意します。Pythonのサンプル・結合試験を実行する場合はPython 3も使います。

```sh
git clone https://github.com/Ampoi/AstroForge.git
cd AstroForge
npm ci
npm run dev
```

`npm run dev`は最初に物理Wasmとドキュメントをビルドし、`tsx watch server/index.ts --dev`でHTTP・UDP・物理ループを起動します。アプリは `http://localhost:3000/`、ビルド済みドキュメントは `http://localhost:3000/docs/` です。

tsxのwatchでサーバー側のTypeScript変更を検知すると、サーバーが再起動して飛行・UDPセッションも初期化されます。コントローラーを再接続してください。フロントエンドは同じHTTPサーバーに組み込まれたViteが配信し、Vueコンポーネントやスタイルの変更を反映します。Zigソースは自動で再ビルドされないので、変更後に物理Wasmを再ビルドしてサーバーを再起動します。

普段の保存機体や起動中のサーバーと分けて検証する場合は、macOS / Linuxで次のように指定できます。

```sh
ASTROFORGE_DATA_DIR=/tmp/astroforge-dev \
PORT=3002 UDP_COMMAND_PORT=49211 UDP_TELEMETRY_PORT=49210 npm run dev
# 別ターミナルから接続。機体一覧の実際のポートを確認する
npm run demo -- --command-port 49211 --telemetry-port 49210
```

## ビルドする

| コマンド | 生成物・用途 |
| --- | --- |
| `npm run typecheck` | TypeScript / Vueの型チェック（生成物なし） |
| `npm run build:ui` | Vue / TypeScript / Tailwind CSS → `dist/` |
| `npm run build:physics` | `native/physics.zig` → `build/physics.wasm`とハッシュファイル |
| `npm run docs:build` | `docs/` → `docs/.vitepress/dist/`。アプリの `/docs/` で配信 |
| `npm run build` | 型チェック → 物理Wasm → UI → ドキュメントの順に実行 |
| `npm start` | `npm run build`を実行してから通常起動 |

通常起動ではビルド済みUIを `dist/` から配信します。開発時は `npm run dev` でViteの開発配信を使います。

```sh
npm run build
npx tsx server/index.ts
```

物理ビルドはソース・スクリプト・生成物のハッシュが一致すれば省略されます。強制再ビルドやZigのパス指定は次のとおりです。

```sh
ZIG=/path/to/zig npm run build:physics -- --force
```

生成物とキャッシュはGit管理対象外です。ビルド済み環境を別の場所で動かす場合は、Wasm・ビルド済みUIとドキュメント・サーバーと共有コード・必要なnpm依存関係を用意して `npx tsx server/index.ts` で起動します。Wasmがない・ABIが違う場合は起動エラーになります。

参照版JavaScriptとの比較や、Zigがない環境での調査には、明示的にバックエンドを切り替えられます。通常の`npm start`は事前のWasmビルドを行うため、この用途では直接起動します。

```sh
npm run build:ui
npm run docs:build
ASTROFORGE_PHYSICS=js npx tsx server/index.ts
```

ABI・メモリ境界・物理モデルの担当範囲は[Zig物理カーネル](./physics-kernel)を参照してください。

## フォルダとコードの配置

| フォルダ | 内容・主なファイル |
| --- | --- |
| `src/` | `App.vue`がVueによる組み立て・画面操作・保存、`style.css`がTailwind CSSとスタイル。`scene.ts`が機体モデルとカメラ、`environment.ts`が地球・軌道表示、`launch-site.ts`が発射場 |
| `public/` | faviconや`assets/land.json`（海岸線）など、そのまま配信する静的素材 |
| `server/` | Node.jsサーバー。`index.ts`がHTTP/SSE・保存・物理ループ、`vehicle-udp.ts`が機体ごとのソケット、`protocol.ts`がUDP入力検証・制御権・テレメトリ、`observations.ts`がIMU・電力・snapshot |
| `server/` の物理処理 | `physics.ts`が推力配分・資源・機体の状態・分離、`world.ts`が複数機体・衝突・時間倍率、`physics-kernel.ts`がWasm呼び出し、`physics-reference.ts`が比較用JS物理カーネル |
| `native/` | `physics.zig`に倍精度RK4積分、重力、大気、空力の計算 |
| `shared/` | ブラウザとサーバーの共有コード。`craft.ts`がパーツ・段構成・質量/慣性、`assembly.ts`が組み立ての親子関係と飛行用出力、`placement.ts`が配置・スナップ、`math.ts`がベクトル/姿勢、`orbit.ts`が予測軌道 |
| `examples/` | 独立したUDPクライアント。`demo.ts`がCLI、`demo-controller.ts`がテレメトリと操縦判断、`launch.py`がPython版。Node.js版はHTTPやサーバー内部モジュールを使わない |
| `tests/` | 数値・通信・HTTP・組み立て・分離のテスト、実UDP試験、ベンチマーク |
| `scripts/` | `build-physics.ts`がZigビルド、`benchmark-physics.ts`がJS/Wasmの比較計測 |
| `docs/` | 利用ガイドとリファレンス。`.vitepress/config.mjs`がナビゲーション・検索・GitHubリンク |
| `data/` | 実行時の保存機体（`crafts.json`）。旧 `craft.json` も読み込み可能。`ASTROFORGE_DATA_DIR`で変更できる |
| `dist/`, `build/`, `.zig-cache/` | ビルド済みUI、生成したWasm、Zigのビルドキャッシュ |
| `index.html`, `vite.config.ts`, `tsconfig.json` | アプリの入口、Vue・Tailwind CSSのビルド設定、TypeScriptの型チェック設定 |

フライト用の機体スキーマを変える場合は `shared/craft.ts` と[機体とフライト状態](./api/schema)、UDPを変える場合は `server/protocol.ts` と[コマンド](./udp/commands)・[テレメトリ](./udp/telemetry)を合わせて確認してください。

## 変更を確認する

```sh
npm run typecheck
npm test
npm run build
```

`npm test`は物理Wasmを準備してから `tests/*.test.js` を実行します。数値積分・資源収支・軌道・衝突、セッション・lease・sequence・期限・batch、HTTP API、組み立て、デモ制御などを検証します。ドキュメントだけの変更では `npm run docs:build` と表示・リンクの確認を行います。

性能や実UDPの挙動を変更した場合は、関連する追加確認を実施してください。

```sh
npm run benchmark
npm run benchmark:physics

# 独立した確認用サーバーをVAB画面にしてから実UDP試験
python3 tests/udp_smoke.py
# 起動直後の確認用サーバーで、デモによる自動点火を確認
python3 tests/demo_smoke.py http://localhost:3000
# 確認用サーバーをVAB画面にしてから分離・上段点火を確認
node --import tsx tests/separation-smoke.js http://127.0.0.1:3002

# PyLoNを別途チェックアウトして上流のPythonデコーダーと照合
python3 tests/upstream_compatibility.py /path/to/PyLoN
# 本体サーバーを起動せず、実UDPとbridgeのセッション処理を往復検証
python3 tests/bridge_roundtrip.py /path/to/PyLoN
```

実UDP・デモ・分離の試験は機体の配置や飛行状態を変更するため、日常の飛行とは別のサーバー・保存先を使います。`upstream_compatibility.py`はパケット変換関数の確認です。`bridge_roundtrip.py`は本体のUDPアダプタとPyLoNの`BridgeRuntime`をループバックUDPで接続し、取得・更新・解放、着地・墜落後のsnapshot継続、制御拒否、機体消失とUDP OFFを検証します。ROSは不要で、PyLoNチェックアウトの変更も行いません。ROS/DDSまでの往復検証は外部の`AstroForge_PyLoN_demo/scripts/test-connection.sh`で実施します。この追加のために本体のサーバー・UI・物理計算・ライフサイクルへデモ用処理を追加していません。

## Python SDKを変更する

Python SDKを変更した場合は、Python 3.11以上の仮想環境で追加確認を実行します。

```sh
python -m pip install -e ./python
python -m unittest discover -s python/tests -v
npm run build:physics
python python/tests/integration.py
python -m pip wheel ./python --no-deps -w artifacts/python-dist
```

`integration.py`は専用サーバー・一時保存先・空きポートを作成し、終了時にサーバーを停止します。既存の飛行には接続しません。Windowsでは `python` を `.venv/Scripts/python.exe`、macOS / Linuxでは `.venv/bin/python` に置き換えて実行できます。利用方法は [Python SDK](./python-sdk) を参照してください。

## ドキュメントを編集する

```sh
npm run docs:dev
```

ターミナルに表示されたURLを開きます。VitePressの開発サーバーでMarkdown変更を反映できます。これはドキュメントのみの起動で、シミュレーターは別途起動します。

```sh
npm run docs:build
npm run docs:preview
```

プレビューはビルド済みサイトを表示します。本文はAstroForgeを使う人に向け、起動手順・送る入力・受け取る結果・単位・制約を先に書きます。本体の実装や開発手順はこの「貢献」セクションにまとめてください。
