# HTTP / SSE API

ベースURLは `http://127.0.0.1:3000`。`PORT`で変更できます。HTTPとUDPコマンドはループバックにのみbindします。`Host`は設定ポートの`localhost`または`127.0.0.1`に限定し、`Origin`が付く場合は同一originのみ許可します。

POSTには `Content-Type: application/json` が必要です。本文は最大65,536 bytesです。レスポンスはJSON、`Cache-Control: no-store`です。

## エンドポイント一覧

| Method | Path | 用途 | 本文 |
| --- | --- | --- | --- |
| GET | `/api/state` | 現在の全体状態 | なし |
| GET | `/api/events` | 10 HzのSSE状態配信 | なし |
| POST | `/api/editor` | 飛行を継続しVABを開く | `{}` または `{ "libraryId": "two-stage" }` |
| POST | `/api/flight` | 配置せずフライト画面に戻る | `{}` |
| POST | `/api/craft` | 機体をライブラリに保存 | Craftと任意の`libraryId` |
| POST | `/api/launch` | 機体を発射台へ配置 | Craft |
| POST | `/api/control` | 機体ごとのUDPをON/OFF | `{ "vehicleId": "...", "enabled": true }` |
| POST | `/api/time-scale` | 時間倍率を変更 | `{ "scale": 10 }` |
| POST | `/api/revert` | 全飛行をリセットする旧API | `{}` |

`/api/craft`以外のPOSTは現在の[State](./schema#state)を返します。画面モード・倍率・各機体のUDP設定は同じサーバーの全ブラウザで共有します。カメラ追尾は各ブラウザ内の状態で、HTTP APIはありません。

## GET /api/state

```sh
curl http://127.0.0.1:3000/api/state
```

`vehicles`から機体と分離物を列挙し、`vehicles[].udp.enabled`で複数のUDP制御対象を識別できます。`activeVehicleId`は最後に配置または`/api/control`で操作した主機体です。`flight`・`craft`・`connection`はその機体を参照する互換フィールドで、UDPがOFFの場合もあります。カメラ追尾はこれらのフィールドを変更しません。

## GET /api/events

ブラウザ向けServer-Sent Events。接続時に1回、その後100 msごとに全Stateを送ります。イベント名は既定の`message`です。

```js
const events = new EventSource('/api/events');
events.onmessage = ({ data }) => {
  const state = JSON.parse(data);
  console.log(state.timeScale, state.vehicles);
};
// 終了時
// events.close();
```

各メッセージは `data: <JSON>\n\n`。再送IDや履歴再生はありません。再接続時は最新状態を取得します。送信バッファが512,000 bytesを超えたクライアントは切断します。

## POST /api/editor /api/flight

```sh
curl -X POST http://127.0.0.1:3000/api/editor \
  -H 'Content-Type: application/json' -d '{"libraryId":"two-stage"}'
```

`libraryId`省略時は空のVABを新規作成し、`draft`には`{name:"新しい機体", assemblyVersion:1, rootId:null, parts:[]}`を返します。選択した編集機体はStateの`draft`です。編集中も既存の飛行・UDPセッションを維持します。フライトに戻るには `/api/flight` に `{}` を送ります。

## POST /api/craft

```js
const state = await fetch('/api/state').then(r => r.json());
const saved = await fetch('/api/craft', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({...state.library.find(v => v.id === "starter").craft, name:'My Pathfinder'})
}).then(r => r.json());
console.log(saved.libraryId);
```

成功時は `{ "ok": true, "libraryId": "UUID", "library": [...] }`。新規保存はIDを省略、上書きは返された`libraryId`をCraftと一緒に送ります。保存済み機体は100件まで、プリセットは上書きせずコピーを保存します。同名機体もIDで区別します。`data/crafts.json`へ永続化し、実行中の機体を変更しません。

## POST /api/launch

[Craft](./schema#craft)を本文として送ります。燃料・エンジン・TWRなどの発射可能性を検証し、新規機体をUDP OFFで追加し、フライト画面に移動します。既存の飛行機体のUDPセッションと指令は維持します。配置だけでは点火しません。

既存の飛行は継続します。未発射の発射台機体だけは置き換わります。発射台付近に既存の機体があると拒否します。同時に保持できる主機体は12機です。

## POST /api/control

`vehicleId`はStateの`vehicles[].id`。ONにする場合は`controllable:true`の主機体を指定します。着地・破損後もOFFにできます。分離物・破片のUDP設定は変更できません。

`enabled:true`で専用ポートを割り当て、UDPを開始します。`enabled:false`でその機体の指令とleaseを解除し、送受信を停止します。他の機体は変更しません。省略時は後方互換としてtrueです。同じ設定の再送ではセッションを更新しません。再ONでは同じポートと新しいセッションを使い、旧セッション宛てのUDP指令は拒否します。

返却される`vehicles[].udp`から`commandPort`と`telemetryPort`を取得してください。未割当時はnull、OFF中は前回割当を保持します。破損・着地済み機体はOFFのみ可能、分離物はON/OFFとも不可です。ポート不足や再ON時の受信ポート競合では400を返し、OFFを維持します。

## POST /api/time-scale

```sh
curl -X POST http://127.0.0.1:3000/api/time-scale \
  -H 'Content-Type: application/json' -d '{"scale":10}'
```

数値の`1`、`2`、`5`、`10`、`20`、`50`、`100`、`200`だけを受け付けます。文字列・小数・その他の値は400を返し、設定は変わりません。固定ステップは常に1/120秒です。

## POST /api/revert

互換性のための明示的な全飛行リセットです。全機体・分離物・時刻・倍率を初期化し、現在の編集機体を発射台に置き、VABへ移動します。すべてのUDPソケットと割り当てを解放し、配置された機体はUDP OFFになります。通常の画面遷移には `/api/editor` と `/api/flight` を使用してください。

## エラー

```json
{ "error": "倍率は1・2・5・10・20・50・100・200のいずれかです" }
```

| HTTP status | 内容 |
| --- | --- |
| 400 | JSON不正、本文超過、機体不正、不明ID、倍率不正、発射台が占有中、保持上限 |
| 403 | Host/Originが不正、許可外パス |
| 404 | エンドポイントまたは静的ファイルがない |
| 405 | 未対応のHTTPメソッド |
| 415 | POSTのContent-TypeがJSONでない |
