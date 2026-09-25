# Python SDK

Pythonから接続・観測・操縦するためのUDP専用SDKです。session、sequence、lease更新を管理し、既存のPyLoN v1コマンド一式を扱います。Python 3.11以上、追加の実行時依存はありません。GUIは含みません。

## インストール

リポジトリルートで実行します。Windows PowerShellでは仮想環境を有効化しなくても使えます。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ./python
.\.venv\Scripts\python.exe examples/python_receive.py
```

macOS / Linuxでは `.venv/bin/python` を使います。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ./python
.venv/bin/python examples/python_receive.py
```

配布パッケージ名は `astroforge-sdk`、import名は `astroforge` です。PyPIには公開していないため、上のローカルパスからインストールしてください。シミュレーターは別ターミナルで起動します。同じ機体の手動デモ・Node.jsデモ・別の受信プログラムは終了してください。テレメトリの受信ポートは1クライアントが占有します。

## 受信する

```python
from astroforge import Client

with Client(command_port=49011, telemetry_port=49010) as rocket:
    sample = rocket.wait_until_ready(timeout=5)
    for _ in range(100):
        print(sample.simulation_time, sample.flight["altitudeAgl"])
        sample = rocket.wait_for_snapshot(timeout=1, after=sample)
```

`Client`作成時に受信スレッドが開始されます。受信だけなら制御権は不要で、終了時も指令を送りません。接続先は既定で `127.0.0.1`、受信側bindも `127.0.0.1` です。機体メニューに表示されたポートを指定してください。複数機体はそれぞれ専用ポートの別Clientで扱います。

`Snapshot`は `session`、`sequence`、`simulation_time`、`received_at`、`flight`、`engines`、`separations` を持ちます。flightは型付き辞書、engines/separationsは型付き辞書のタプルです。同一観測時刻の `pylon_control_snapshot` を採用し、IMUなど別周期の情報は混ぜません。大きな機体でサーバーがsnapshotを省略する場合は待機がタイムアウトします。

- `snapshot`：最新のsnapshot。未受信ならNone。鮮度を保証する待機は行いません。
- `wait_for_snapshot(after=sample)`：指定した観測より新しいsnapshotを待ちます。after省略時は呼び出し開始時点より新しいものを待ちます。
- `imu`：型付き `Observation[Imu]`、未受信ならNone。
- `latest("pylon_actuator_manifest")`：パケット種別ごとの最新 `Observation`。
- `latest("pylon_actuator_state", name="engine_1")`：部品ごとの状態。
- `state`：接続・制御可能性・制御権所有・heartbeat/snapshotの経過秒・エラー。

`Observation.data`は受信フィールドの辞書です。`sequence`、`simulation_time`、`received_at`とセッションを一緒に保持します。取得データはコピーなので、利用者の書き換えは受信状態へ影響しません。

## 操縦する

次は初期2段機体を短時間点火する例です。`set_attitude()`は目標角度ではなく正規化された操縦入力です。ゼロ入力による自動直立保持はありません。

```python
import time
from astroforge import Client, EngineCommand, AttitudeCommand

with Client() as rocket:
    sample = rocket.wait_until_ready()
    rocket.acquire_control(timeout=3)
    end = time.monotonic() + 2
    while time.monotonic() < end:
        rocket.send_batch(
            [EngineCommand(e["name"], thrust=60000)
             for e in sample.engines if e["available"]],
            attitude=AttitudeCommand(pitch=0, yaw=0, roll=0),
        )
        sample = rocket.wait_for_snapshot(after=sample)
```

SDKはleaseを自動更新しますが、推力・姿勢・RCS・wrench指令を自動再送しません。上のループは実時間20 Hzの観測ごとに指令を送信します。ループが止まれば通常の指令は既定の0.4秒で期限切れになります。lease更新だけでは推力を維持しません。

| API | 主な引数・用途 |
| --- | --- |
| `acquire_control()` | timeout=3、priority=10、lease_duration=2、suppress_sas=True。観測で自分の所有を確認して戻る |
| `release_control()` | 自分のleaseを解放し、全指令のクリアを要求 |
| `set_engine(name, thrust)` | 推力N、enabled=True、timeout=0.4、任意のgimbal=(pitch,yaw,roll) |
| `set_attitude()` | pitch/yaw/rollは各−1〜1、timeout=0.4、landing_gear=False |
| `set_rcs(name, thrust_limit=250)` | 推力上限N、enabled=True、timeout=0.4 |
| `separate(name)` | 指定リングを分離。完了はsnapshotのseparationsで確認 |
| `set_wrench(force, torque)` | body軸の3成分、NとN·m、timeout=0.4 |
| `send_batch(engines, attitude=..., separation=...)` | EngineCommand列、任意のAttitudeCommand/SeparationCommand。renew_lease=True |
| `emergency_stop()` / `clear_emergency_stop()` | 停止要求／自分が要求した停止の解除。解除後に再取得が必要 |

batchのエンジンは最大16件、重複不可。RCSとwrenchはbatchに含められません。通常のエンジン/RCS/wrench指令期限は0.05〜10秒、姿勢とbatchは0.05〜1秒です。段分離には期限はありません。分離を含むbatchでは上段だけを指定する必要があり、機体に依存する妥当性はサーバーが検証します。

コマンドの戻り値は**送信したsequence**です。受理や動作完了の保証ではありません。`latest("pylon_control_authority_state").data["reason"]`や部品状態で結果を確認してください。UDP応答は各指令と厳密な1対1対応ではなく、`lastSequence`は応答IDではありません。

## 単位・時計・終了

単位と座標は[テレメトリ仕様](./udp/telemetry)に合わせています。高度m、速度m/s、角速度rad/s、電力Wh、燃料・酸化剤は各1 unit=5 kgです。姿勢入力は角度ではありません。IMUの角速度は地球自転を含み、flightのbody角速度は地球自転分を除きます。

`simulation_time`は倍速の影響を受けます。`received_at`はPythonの `time.monotonic()`、timeout・lease・鮮度判定は実時間です。異なるPCのmonotonic時刻同士は比較しないでください。

`with`終了または`close()`で、自分の制御権が有効ならreleaseを送信します。サーバーで受理されるとエンジン・RCS・姿勢・wrenchが一緒にクリアされます。終了はベストエフォートであり、受理を確認したという意味ではありません。通信が途絶えた場合はサーバーの指令期限により停止します。closeは複数回呼べます。

## 途絶・再接続・エラー

既定ではheartbeatまたはsnapshotが1秒以上古くなると、指令送信とlease更新を停止します（`stale_after`で変更可能）。制御権喪失、セッション変更、制御不能化も同様です。待機中の操縦処理には具体的な例外を返します。

| 例外 | 対処 |
| --- | --- |
| `TelemetryTimeout` | UDP ON、ポート、相手プロセス、snapshot受信を確認 |
| `AuthorityTimeout` | 取得未確認。別所有者や緊急停止を確認 |
| `ControlLost` | 他クライアントの取得、lease失効、飛行終了などを確認 |
| `SessionChanged` | UDP再ONやサーバー再起動後の新セッションを確認 |
| `ConnectionError` | ポート競合、bind失敗、ソケットエラーを確認 |
| `ClientClosed` | 新しいClientを作成 |
| `ValueError` | 指令の型・有限数・範囲を修正 |

回復可能な例外後は `wait_until_ready()` で新鮮な観測を待ち、エラーを確認済みにできます。これは受信専用にも使えます。**操縦は自動再開しません**。再開する場合は明示的に `acquire_control()` を呼び、観測から現在の機体・エンジンを再選択してください。致命的なソケットエラー後はClientを閉じて作り直します。

## サンプルと検証

```powershell
# 受信だけ（指令なし）
.\.venv\Scripts\python.exe examples/python_receive.py
# 基本操縦。従来のhost/port/duration/turn引数を維持
.\.venv\Scripts\python.exe examples/launch.py --duration 20 --turn 0
# 初期2段機体：燃料切れ→分離確認→0.8シミュレーション秒待機→上段点火
.\.venv\Scripts\python.exe examples/python_staging.py --duration 240
# SDKの障害・通信試験
.\.venv\Scripts\python.exe -m unittest discover -s python/tests -v
# 専用サーバー・保存先・ポートを自動生成する実UDP試験（物理Wasmのビルドが必要）
.\.venv\Scripts\python.exe python/tests/integration.py
```

2段サンプルは予測遠地点160 kmで推力を切り、その後は再点火しません。分離未確認なら上段を点火せず終了します。物理精度や多様な自作機体での飛行成功を保証するものではありません。
