# 座標・高度の読み方

制御に使う前に、**機体の軸**と**地表の上方向**、**重心の高度**と**開始地点からの上昇量**を区別します。UDPのcamelCaseはPyLoNのROS2メッセージでsnake_caseになります。

## 機体軸と地表の上方向

`base_link`は右手系です。+Xは機首・通常のエンジン推力方向、+Yは機体の左、+Zは機体の上です。機体が傾けば、これらの向きも一緒に回転します。

```text
機体を横向きに描いたbody軸（姿勢に追従）
                    +Z 機体の上
                     ↑
       尾部 [ 機体 ] ─────→ +X 機首・推力
                     ⊗ +Y 機体の左（紙面の奥）

初期発射台で直立したロケット（姿勢quaternionが単位値の場合）
                    +X = 地表の上
                     ↑
                  [ 機体 ]
                     └────→ +Y = 東
                     ⊗ +Z = 北（紙面の奥）
```

| UDP → ROS2 | 意味 | 単位・初期直立時の例 |
| --- | --- | --- |
| `upBody` → `up_body` | 地表の上方向をbodyで表した単位ベクトル | 無次元、`[1, 0, 0]` |
| `eastBody` → `east_body` | 地表の東方向をbodyで表した単位ベクトル | 無次元、`[0, 1, 0]` |
| `northBody` → `north_body` | 地表の北方向をbodyで表した単位ベクトル | 無次元、`[0, 0, 1]` |
| `surfaceVelocityBody` → `surface_velocity_body` | 地表に対する速度をbodyで表したもの | m/s |
| `angularVelocityBody` → `angular_velocity_body` | 地表に対する角速度をbodyで表したもの | rad/s |
| `verticalSpeed` → `vertical_speed` | 地表の上向きが正の速度 | m/s |

機体が傾くと`up_body`は`[1, 0, 0]`ではなくなります。上昇速度は`surface_velocity_body.x`を固定的に読むのではなく、`vertical_speed`、または`dot(surface_velocity_body, up_body)`で求めます。正のroll / pitch / yawはそれぞれbody +X / +Y / +Z周りの右ねじ方向です。

ground truthの位置・速度はENU（`[東, 北, 上]`）、回転はbody→ENUのquaternion `[x, y, z, w]`です。ENUの+Zとbodyの+Zは別の軸です。`up_body`は飛行位置での地表法線、ground truthのENUは初期発射地点に固定した座標なので、広い距離を移動すると上方向も一致しなくなります。

## 発射台での数値例と300m上昇

標準の`Pathfinder 01`（タンク2個、満載、初期姿勢）を配置した時刻0の例です。機体を編集すると重心が変わるため、**以下の高度をコードへ固定しないでください**。

| 観測値 | 数値例 | 意味 |
| --- | --- | --- |
| `altitudeAgl` / `altitudeAsl` | 約3.586668 m | 基準球面から機体重心までの高度 |
| ground truth `position` | `[0, 0, 0]` m | 初期発射台の重心を原点とするENU位置 |
| `upBody` | `[1, 0, 0]` | 機首が地表の上を向いている |
| `surfaceVelocityBody` | `[0, 0, 0]` m/s | 地表に静止 |
| `landed` | `true` | 発射前もtrueなので、これだけで着地成功とは判定できない |

AstroForgeのAGLとASLは同じ基準球面から測ります。機体の底面までの隙間や、脚の接地判定値ではありません。地表の描画・接触面のオフセットや機体姿勢によっても接地時の値は異なります。

「開始地点から300m上昇」は、同じセッションの最初の有効なsnapshotから初期AGLを保存し、その差で判断します。

```python
initial_agl = first_snapshot.flight.altitude_agl
rise_m = snapshot.flight.altitude_agl - initial_agl
remaining_m = 300.0 - rise_m
# 上の機体例では目標AGLは約303.586668 m。
```

この基準は離陸前に一度保存し、飛行中に更新しません。接続を飛行途中から開始した場合は「接続時からの上昇量」になります。セッションが変わったら以前の基準を流用せず、操縦を停止して初期状態を確認し直します。ブラウザの高度も初期重心高度を引いた値です。

## 単位の早見表

| 値 | 単位 |
| --- | --- |
| 高度・位置、速度、加速度 | m、m/s、m/s² |
| 質量、推力、トルク、圧力 | kg、N、N·m、Pa |
| 角度、角速度 | rad、rad/s（緯度・経度のみ度） |
| 姿勢入力`pitch/yaw/roll` | −1〜1の正規化値（角度ではない） |
| `liquidFuel` / `oxidizer` | 各1 unit = 5 kg |
| 電荷・電力容量 | Wh |
| `universalTime` | シミュレーション秒 |
| lease・指令のtimeout、観測の鮮度 | 実時間秒（時間倍率に依存しない） |

接続時の状態の区別は[観測と操縦](../protocol#観測と操縦を分ける)、全フィールドは[テレメトリ](./telemetry)を参照してください。
