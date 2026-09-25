# 機体とフライト状態

## Craft

```json
{
  "name": "Minimal rocket",
  "parts": [
    { "id": "pod_1", "type": "pod" },
    { "id": "tank_1", "type": "tank" },
    { "id": "engine_1", "type": "engine" },
    { "id": "fin_1", "type": "fin", "parent": "tank_1", "offset": -0.34, "angle": 0 }
  ]
}
```

| フィールド | 制約 |
| --- | --- |
| `name` | 1〜48文字、空白のみ不可 |
| `rootId` | 任意。VABで基準にする胴体パーツのID。省略時は先頭の胴体パーツ |
| `parts` | 最大80パーツ、先端にpodが1個必要 |
| `parts[].id` | 英数字と`_`、1〜48文字、機体内で一意 |
| `parts[].type` | pod / tank / engine / decoupler / battery / fin / rcs / solar |
| `parent` | 側面パーツfin/rcs/solarの取り付け先ID。engine不可 |
| `offset` | 親の中心からの相対高さ、-0.5〜0.5 |
| `angle` | 有限の角度、rad。2πで正規化 |
| `group` | 任意の対称グループID。英数字と`_`、1〜48文字 |
| `mirror` | 任意。trueで左右ミラー |

胴体は配列内で上から下の順。中間のengineの直下にはdecouplerが必要です。保存時と飛行時の検証は異なり、燃料やTWRが不足した編集途中の機体も保存できます。内部の分離物はpodを持たない場合があるため、そのまま発射用Craftにはできません。

## State

| フィールド | 型・意味 |
| --- | --- |
| `mode` | `flight` / `editor`、起動時はflight |
| `craft` | activeVehicleIdの機体のCraft |
| `draft` | サーバーが保持する編集用Craft。新規VABでは空のWorkshop |
| `library` | `{id,craft}`の配列。starter / two-stageと保存機体 |
| `activeVehicleId` | 最後に配置または/api/controlで操作した主機体の内部ID。UDP OFFの場合もある |
| `vehicles` | 全主機体・分離物・破片の平坦な配列 |
| `flight` | activeVehicleIdの機体のSnapshot。配下のdebrisを含む互換用フィールド |
| `trail` | activeVehicleIdの機体の間引き済みECI位置履歴 |
| `timeScale` | 1 / 2 / 5 / 10 |
| `simulationTime` | サーバーの共通物理時刻、秒 |
| `utc` | サーバー実時計のISO 8601 UTC時刻 |
| `connection` | activeVehicleIdのudp情報とhttpPort・physicsHz・telemetryHz・physicsMs・physicsBackend・slowFrames |

## UDP接続状態

`vehicles[].udp`に各機体の接続情報が入ります。

| フィールド | 意味 |
| --- | --- |
| `enabled` | UDP送受信がONか |
| `commandHost`, `commandPort` | コマンド受信先。hostは127.0.0.1、未割当portはnull |
| `telemetryHost`, `telemetryPort` | テレメトリ送信先。未割当portはnull |
| `session` | ON中のPyLoN runtime identity。OFFはnull |
| `authority` | 機体固有の制御権。未割当はnull、OFFはstate:0 |
| `received`, `accepted`, `rejected`, `sent`, `sendErrors` | この機体の通信件数 |
| `lastCommand` | 最後の受信指令の結果。未受信はnull |
| `demo` | 手動デモの状態。未開始はnull。[操作API](./http#post-api-manual-demo)を参照 |

OFF中も割当済みポートは保持します。分離物はenabled:falseでポート未割当です。

## Workshop（ブラウザの下書き）

VABの下書きは`{name, assemblyVersion:1, rootId, parts}`です。各パーツは`position:[x,y,z]`（body座標m）と`parent`を持ち、ルートと未接続パーツ群の先頭では`parent:null`になります。最初のパーツを置く前は`rootId:null, parts:[]`です。ルートから親子関係をたどれるパーツだけが機体に含まれます。

ブラウザは未接続パーツも含む下書きをlocalStorageへ保存します。HTTPの保存・発射には、接続済みパーツを上から下の順に並べたCraftへ変換して送ります。Workshopそのものは保存・発射用APIの入力形式ではありません。

## Vehicle snapshot

| フィールド | 型・単位 |
| --- | --- |
| `id`, `craft` | 機体IDと構成。IDはHTTP用でUDPのvesselIdとは別 |
| `status` | pad / flying / landed / crashed / destroyed |
| `time`, `createdAt` | 共通物理時刻と配置時刻、秒 |
| `position`, `velocity` | ECIの`[x,y,z]`、m / m/s |
| `quaternion` | body→ECIの`[x,y,z,w]` |
| `omega` | body角速度、rad/s |
| `com` | モデル原点から重心まで、body座標m |
| `altitude` | 初期重心高度からの上昇量m、0未満をクリップ |
| `altitudeAsl` | 球面地表から重心までの高度m |
| `speed`, `verticalSpeed`, `horizontalSpeed` | 地球自転に対する相対速度m/s |
| `mass`, `fuel`, `mono`, `charge` | kg / kg / kg / Wh |
| `thrust`, `drag`, `q`, `mach`, `aoa` | N / N / Pa / 無次元 / rad |
| `maxAltitude`, `maxQ` | これまでの最高高度mと最大動圧Pa |
| `passive`, `fragment` | 分離物・破片フラグ |
| `controllable` | UDPをONにできるか。平坦なvehicles内のみ |
| `udp` | 機体ごとのUDP設定・接続状態。下記参照。平坦なvehicles内のみ |
| `impact` | nullまたは`{time,speed,kind,position}`。kindはground/vehicle |
| `events` | 最大30件の`{time,text}`、新しい順 |
| `trail` | 最大約360点に間引いた位置履歴。vehicles内のみ |
| `stats`, `engines`, `separations`, `orbit` | 構成集計、エンジン状態、分離履歴、軌道要素 |

`destroyed`は描画しない機体です。履歴として主機体の一覧に残ります。破片は生成から20シミュレーション秒で除去します。追尾対象が消えた場合、UIは残った破片または別機体へ自動で切り替えます。

`orbit`には`apoapsis`・`periapsis`（m）、`period`・`timeToApoapsis`（s）、`eccentricity`、`inclination`（度）などがあります。脱出軌道のapoapsis/period/timeToApoapsisはnullです。UDPでの表現は[UDP仕様](../protocol#座標と単位)を参照してください。
