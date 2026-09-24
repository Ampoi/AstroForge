# AstroForge

ブラウザでロケットを組み立て、PyLoN v1形式のUDPで飛行を制御する軽量MVPです。Unity不要。Zig製WebAssemblyが物理積分・空力計算を、Node.js標準ライブラリが機体の管理・UDP・HTTPを担当し、Three.jsが3Dを描画します。外部サービス、アカウント、APIキーは不要です。

## 起動

Node.js 22.12以降が必要です。独立したUDPデモもNode.jsだけで動作します。別のPythonサンプルにはPython 3を使用します。

物理Wasmの初回ビルドには **Zig 0.16.0**（`.zig-version`）が必要です。[Zig公式配布](https://ziglang.org/download/)から導入し、`zig version`で確認してください。`npm start`は物理WasmとAPIドキュメントをビルドして起動します。

```sh
npm install
npm start
```

[http://localhost:3000](http://localhost:3000) を開きます。

1. 初期画面はフライトです。保存機体のない初回起動では、発射台に2段機体「Pathfinder 02 / Two stage」が配置されています。
2. 別ターミナルで `npm run demo` を実行すると、制御権を取得して自動点火します。起動直後は「発射台へ」の操作は不要です。
3. 「機体」メニューから保存機体・プリセットを選択、または「新しい機体を作る」でVABを開きます。
4. VABで「保存」または「発射台へ」。既存の飛行中の機体は残り、編集中も計算が続きます。
5. 「機体」→「追尾」でカメラ、機体ごとの「UDP ON/OFF」で操縦対象を選びます。複数機体を同時にONにでき、各機体に専用の受信・送信ポートが割り当てられます。追加配置した機体はOFFです。分離物も追尾できます。
6. ×1 / ×2 / ×5 / ×10で時間倍率を変更。GMTは実際のUTC時刻、物理計算は固定1/120秒です。

フライト画面はヘッダーと左右の計器を省き、高度・GMTと操作だけを表示します。「機体を追尾」 / 「地球全景」で表示を切り替え、ドラッグ・スクロールでカメラを操作できます。⌂で発射場全体を表示します。

## APIドキュメント

[VitePress](https://vitepress.dev/guide/getting-started)でHTTP・SSE・機体スキーマ・PyLoN UDP・衝突・時間倍率をドキュメント化しています。

```sh
npm run docs:dev      # ドキュメント開発
npm run docs:build    # アプリの /docs/ へ配信する静的サイトを生成
npm run docs:preview  # ビルドをプレビュー
```

ビルド後は [http://localhost:3000/docs/](http://localhost:3000/docs/) またはフライト画面の「API ↗」から開けます。

発射場には火炎排出口付きの発射デッキ、整備塔とアクセスアーム、組立棟、管制棟、物流棟、運用棟、燃料設備、道路と駐車場を配置しています。

デモは `examples/demo.js` と `examples/demo-controller.js` だけで動く独立したUDPクライアントです。アプリとの接続は通常のPyLoN UDPのみで、HTTP・プロセス間通信・アプリ内部のモジュールを使いません。テレメトリ受信、状態管理、操縦判断、送信数とログの管理をすべてデモ内で完結させています。アプリは通常の受信コマンドと飛行結果を表示します。

デモは制御権取得 → 第1段を60 kNで点火 → 8〜15秒に75%推力 → 25〜33秒にRCSロール試験 → 第1段の燃料切れを検出して切り離し → 分離確認から0.8秒後に第2段点火 → 予測遠地点160 kmで推力停止、を行います。高度30 kmまでは垂直を保ち、その後は東へ最大4°傾けて上昇し、4分で制御権を返します。弾道飛行はその後も続きます。各段の点火・燃焼終了・分離確認は時刻付きでターミナルに記録されます。到達高度・分離時刻は機体の構成によって変わります。単段機体も同じコマンドで飛ばせます。

`Ctrl+C`で推力を切り、制御権を返します。通信途絶・セッション変更・他のコントローラへの制御権移譲でも停止します。デモのpriorityは1、Pythonサンプルは10です。VABへの移動では飛行とセッションを維持します。UDPをOFFにするとその機体の指令とleaseを解除します。再びONにすると同じポートで新しいセッションを発行するため、その機体のデモを再起動してください。他の機体の飛行・通信は継続します。旧HTTP `/api/revert` は明示的な全飛行リセットとして残しています。

```sh
npm run demo -- --duration 20
npm run demo -- --command-port 49111 --telemetry-port 49110
npm run demo:python -- --duration 90 --turn 12
```

初期機体はUDP ONで、通常は受信 `:49011` / 送信 `:49010` を使用します。次の機体には `:49013` / `:49012` のように2ずつ増やした専用ポートを割り当てます。使用中の受信ポートや他機体への割当済みポートはスキップします。一覧の「接続コマンド」から各機体のデモ起動コマンドをコピーし、別々のターミナルで実行できます。同じ機体のテレメトリ受信ポートを使うクライアント同士は同時に起動できません。

## 地球と宇宙の表示

飛行中は実際の慣性位置と地球自転を使い、地球の曲率、大気の縁、海・陸・極域、雲、昼夜、太陽と星空を描画します。地球全景の光点は機体、オレンジの実線は実際の飛行履歴、水色の破線は現在の慣性位置・速度から求めた二体問題の予測軌道です。予測は推力と空力を無視し、地表に衝突する場合は衝突点まで、周回する場合は一周分を表示します。脱出軌道や非常に大きな楕円軌道は地心距離40地球半径までに制限します（機体がさらに遠い場合はその位置の先まで延長）。地球の裏に回った機体は隠れます。追尾カメラでも高度に応じて空が暗くなり、宇宙へ連続的に移行します。発電の昼夜判定と描画で太陽方向を共有しています。

海岸線は同梱のNatural Earth 110mデータ（約96 KB）、地表の色と雲・星は手続き生成です。描画には球面との交差計算と6サンプルの大気シェーダーを使用し、巨大な地形メッシュや外部の画像配信は不要です。大気散乱・雲・地表色は見た目の近似で、気象シミュレーションや衛星画像ではありません。地形の高低差・雲の空力影響はありません。

## 組み立て

- 「新しい機体を作る」で空のVABを開き、ポッドや燃料タンクなどの胴体パーツを最初に配置するとルート（◆）になります。パレットで選んで作業場をクリック、またはドラッグして配置します。
- 胴体パーツは空いている上下の接続点へスナップ。安定翼・RCS・ソーラーパネルは側面へ取り付け、高さ3段・周方向45°間隔の接続点の12 cm以内でスナップします。Altキーまたは「スナップ OFF」で解除できます。
- 配置済みパーツをドラッグすると、その子・孫パーツもまとめて移動します。ルートから取り外したパーツ群は半透明になり、空中に置いておけます。未接続のパーツへ追加したパーツも半透明です。
- 機体のパーツ数、質量、TWR、Δv、保存・発射の対象はルートにつながっているパーツだけです。ドラッグ中も集計を更新し、再接続すると子パーツもまとめて復帰します。ルートを動かすと接続済みの機体全体が移動します。
- 側面パーツの1・2・4・6個の放射状配置、左右ミラー、取り付け位置の調整に対応。対称グループは一緒に移動します。Escで操作取消、Undoで配置・取り外し・削除を戻せます。
- 「1段機体」「2段機体で分離を試す」でプリセットを読み込み、「空にする」で最初から組み立てられます。「重心 / 空力中心」で接続済みの機体の目安を表示します。
- ブラウザの下書きは、ルート・親子関係・未接続パーツの位置も含めてlocalStorageへ保存。「保存」は接続済みの機体をサーバーの`data/crafts.json`へ機体IDごとに保存します。最大100件、旧`data/craft.json`も読み込めます。
- ロケットの3Dモデル・材質・テクスチャ・UIアイコンは手続き的に作成。起動後の外部アセット取得なし。

飛行用の機体は、ポッドを先端に1個、各段の末尾にエンジンを配置します。上段エンジンの下には分離リングが必要です。削除は選択パーツとその子孫に適用します。ルートの削除は「空にする」を使います。重なりの幾何判定は未実装です。

## 分離・多段化

初回起動の2段機体では `npm run demo` だけで下段の燃料切れ → 自動分離 → 上段点火を試せます。保存機体が読み込まれている場合は、「機体」→「保存機体・プリセットを選ぶ」で2段プリセットを発射台へ配置し、UDPをONにして「接続コマンド」を実行してください。VABの「2段機体で分離を試す」でも読み込めます。

2段プリセットには上下両段に安定翼を配置し、大気圏内で分離した後も上段の姿勢を安定させます。デモの姿勢補正は時間倍率に合わせて調整します。

分離リングとそれより下のパーツ（側面パーツも含む）を別の剛体に分け、両方に重力・空力を計算します。上段を引き続き追尾し、近くにある切り離した段も描画します。燃料は段ごとに独立し、未分離の上段エンジンは燃焼しません。分離時は重心・慣性・質量・資源を更新し、位置と運動量を引き継いで120 N·sの等反対向きの分離インパルスを加えます。

デモは同一観測時刻の `pylon_control_snapshot` から燃料切れ・分離済み状態・上段エンジンの使用可否を確認します。最下段のリングから順に切り離し、分離待ちも姿勢を保持します。分離指令は未確認の間のみ0.5秒間隔で再送し、5秒以内に分離と上段の準備を確認できなければ停止します。通信の期限は実時間、点火前の0.8秒待機はシミュレーション時間です。

分離は飛行中のみ。通常の分離指令は既存の推力・姿勢指令をクリアするため、上段に改めて指令を送ってください。分離と上段点火を一つのatomic batchに含めることもできます。分離した段もカメラ追尾・衝突判定の対象です。破片へのUDP制御切り替え・再接続は未対応です。

## UDPと互換性

|用途|デフォルト|
|---|---|
|ブラウザ|`http://localhost:3000`|
|コマンド受信|`127.0.0.1:49011/UDP`|
|テレメトリ送信先|`127.0.0.1:49010/UDP`|
|テレメトリ|20 Hz / UTF-8 JSON|
|物理|120 Hz固定ステップ / 倍精度 / RK4|

PyLoNの**飛行制御に関係するv1サブセット**を実装しています。セッション、lease、sequence、姿勢入力、engine/RCS/separation command、body wrench、atomic batch、IMU、蓄電状態、同一時刻のcontrol snapshotに対応します。PyLoN全体やKSPの完全互換実装ではありません。

参照仕様は [PyLoN d62d948](https://github.com/PyLoN-sim/PyLoN/tree/d62d948064d6665702d05957a669596244dca8da)。詳細・完全なJSON例・未対応範囲は [docs/protocol.md](docs/protocol.md) を参照してください。

```sh
PORT=3001 UDP_COMMAND_PORT=49111 UDP_TELEMETRY_PORT=49110 npm start
python3 examples/launch.py --command-port 49111 --telemetry-port 49110
```

`UDP_COMMAND_PORT` / `UDP_TELEMETRY_PORT` は割り当ての開始ポートで、異なる値が必要です。実際の割り当ては機体一覧または `vehicles[].udp` で確認できます。OFF中も同じ機体への割り当てを保持し、再ON時に受信ポートが他のプロセスに使われている場合はエラーを返します。機体の置換・全リセットで割り当てを解放します。

`UDP_TELEMETRY_HOST`で送信先を変更できます。HTTPとコマンド受信はローカルホストにのみバインドします。初期状態から発射台のテレメトリを配信し、通常のVAB表示中も飛行と通信を続けます。ブラウザを閉じても発射後の物理計算は続きます。

## 物理モデル

地球半径6,371 km、中心重力 `μ = 3.986004418e14 m³/s²`、自転 `7.292115e-5 rad/s`。慣性座標で位置・速度・姿勢quaternion・角速度を積分します。大気は地球と共回転。燃料消費で質量、重心、慣性テンソルが変化し、取り付け位置から力とトルクを計算します。

大気はUS Standard Atmosphere 1976の下層の温度勾配・静水圧モデルを使用。約86 kmより上は指数近似に切り替え、150 kmで密度を0にします。抗力は `½ρv²CdA`、翼の法線力は局所流速と迎角から計算し、取り付け位置に作用させます。遷音速抗力を近似加算します。標準大気と抗力式の根拠は [US Standard Atmosphere 1976](https://ntrs.nasa.gov/citations/19770009539)、[NASA Drag Equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/modern-drag-equation/) です。

これは**CFDではなく、係数ベースの教育・制御実験向けモデル**です。抗力・翼係数を実機データに合わせた同定は行っていません。失速、衝撃波、干渉流、風、加熱、材質の詳細な破壊、タンクの液体運動は詳細には扱いません。質量変化時の慣性は毎ステップ更新しますが、燃料流の角運動量・スロッシングは省略します。RCSは全ノズルの推力予算を共有する理想6軸配分器です。ポッドのリアクションホイールは角運動量飽和を省略します。

軌道は位置・速度から二体問題の接触軌道を計算します。遠地点・近地点・遠地点到達時間・離心率・周期・傾斜角を算出。地球内部に入る近地点もそのまま表示するため、弾道飛行では負値になります。地面・機体同士の衝突を判定し、8 m/s以上で接続部から分解、65 m/s以上で消失します。破片は最大20シミュレーション秒で除去します。衝突形状と強度はゲーム向けの近似です。詳細は [docs/simulation.md](docs/simulation.md) を参照してください。月・第三天体・J2・地形・海洋・ドッキングは未実装。初期機体は弾道飛行用で、地球周回軌道投入用ではありません。

ステップの物理時刻とコマンド期限の実時間は分離しています。OSのスリープなどで250 ms以上遅れた場合は実時間をすべて追いかけず計算負荷を制限し、`slowFrames`を増やします。実験中はOSをスリープさせないでください。

## 検証

```sh
npm test
npm run benchmark
npm run benchmark:physics # JS / Zigを各5回、別プロセスで計測して中央値を比較

# 起動中のローカルサーバーに対する実UDP試験（組立室で実行）
python3 tests/udp_smoke.py

# 起動直後の独立した確認用サーバーで、ボタン操作なしの自動点火を検証
python3 tests/demo_smoke.py http://localhost:3000

# 独立した確認用サーバーでの分離・上段点火（組立室で実行）
node tests/separation-smoke.js http://127.0.0.1:3002

# PyLoNを別途チェックアウトして、PyLoN自身のPythonデコーダーで相互検証
python3 tests/upstream_compatibility.py /path/to/PyLoN
```

数値テストは海面・11 kmの大気値、真空の円/楕円/脱出軌道、3周分のエネルギー・角運動量保存、燃料収支、推力、空力の安定方向、RCS、タイムアウトを検証します。通信テストはsession、所有権、sequence、期限切れ、優先権、緊急停止、atomic batch、不正入力を確認します。上流互換テストはROSを起動せず純粋な上流パケット変換関数を使用します。ROS/DDS全体の結合試験とは異なります。

## 構成

```text
server/index.js        HTTP / UDP / simulation loop
native/physics.zig     f64 RK4 / gravity / atmosphere / aerodynamic forces & torques
server/physics-kernel.js versioned Wasm ABI / backend selection
server/physics-reference.js JS reference kernel / orbital elements / shared constants
server/physics.js      actuation / resources / vehicle lifecycle / breakup
server/world.js        multiple vehicles / swept collisions / time warp
server/protocol.js     PyLoN v1 envelope / authority / telemetry
server/observations.js inertial IMU / electrical storage / coherent snapshot
shared/craft.js        part catalog / stages / layout / mass & inertia
shared/placement.js    surface snap constants / legacy stack placement
shared/assembly.js     workshop roots / attachment trees / detached branches / flight export
shared/math.js         vector / quaternion / matrix operations
shared/orbit.js        two-body future path / surface impact / escape boundary
public/scene.js        procedural 3D models / camera / selection
public/environment.js  Earth / atmosphere / clouds / stars / trail & prediction
public/launch-site.js  launch deck / service tower / buildings / roads
public/assets/land.json Natural Earth coastline (public domain)
public/app.js          builder / flight instruments / local persistence
examples/demo.js       standalone UDP demo CLI / terminal logs
examples/demo-controller.js telemetry / guidance / commands (UDP only)
examples/launch.py     alternative Python UDP flight controller
tests/                numerical & protocol verification
```

既定の物理バックエンドはZig製Wasmです。ビルド・切替・移行範囲・検証方法は [docs/physics-kernel.md](docs/physics-kernel.md) を参照してください。
