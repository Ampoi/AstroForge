# AstroForge Python SDK

Python 3.11+ / 標準ライブラリのみの、PyLoN v1 UDPクライアントです。

リポジトリルートで `python -m pip install -e ./python` を実行します。
シミュレーターは別ターミナルで起動してください。

```python
from astroforge import Client

with Client(command_port=49011, telemetry_port=49010) as rocket:
    state = rocket.wait_until_ready(timeout=5)
    print(state.flight["altitudeAgl"])
    # 観測だけなら制御権の取得は不要です。
```

詳しいAPI・操縦例・終了時の挙動はリポジトリの `docs/python-sdk.md` を参照してください。
GUIや追加のランタイム依存はありません。
