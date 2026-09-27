# Development dashboard

AstroForge と独立した開発用ツール。Python 標準ライブラリだけで動きます。本体サーバー、UI、ROS2、npm scripts からの import・起動・通信はありません。

## この環境での使い方

Tailscale 接続中に **http://ampoi.tail09c1ef.ts.net:8766** を開きます。
初回ログインの管理トークンはリポジトリ直下で以下を実行して確認します。

```sh
python3 dev-dashboard/manage.py token
```

1. 「ToDo を登録」で内容と完了条件を入力します。登録した ToDo は自動実行対象です。
2. 最大3件（画面から1〜16件に変更可能）を独立した worktree で並列開発します。
3. 結果・検証コマンド・ログをカードから確認します。成功時は `codex/task-<ID>` にコミット・push して「レビュー待ち」になります。
4. ブランチをレビューし、**通常の merge または fast-forward** で main に統合します。「統合済みを確認して完了」を押すと、リモート main にブランチ先端が含まれることを確認して完了にします。squash/rebase merge はこの判定に対応していません。
5. 依存タスクがある ToDo は、そのタスクの統合・完了を待って開始します。依存なしのタスク同士は並列です。同じファイルの変更は手動統合時に競合を解消してください。

「キューを一時停止」は新規開始を止めます。実行中の作業はカードの「作業を停止」で停止します。失敗・タイムアウト・サービス再起動による中断は「要対応」になり、自動で無限再試行しません。再試行は既存 worktree の変更を保持します。

一覧のタスクはこのダッシュボードで登録したものです。Codex デスクトップの会話履歴は取り込みません。Worktrees 欄にはこのリポジトリの外部作成 worktree も表示します。

## 起動と停止

Linux、Python 3.12+、Git、認証済み Codex CLI、`systemd --user` を使用します。Tailscale 公開時はログイン済み Tailscale も必要です。

```sh
# 新しい環境の初期設定。一度だけ実行
python3 dev-dashboard/manage.py init --tailscale
python3 dev-dashboard/manage.py start
python3 dev-dashboard/manage.py status
python3 dev-dashboard/manage.py stop
```

Tailscale IP だけに bind し、LAN や `0.0.0.0` には公開しません。HTTP 通信は Tailscale の暗号化されたネットワーク内で運ばれます。Tailscale Serve / Funnel の設定変更は不要です。アクセスには管理トークンが必要で、利用者にはコード実行と登録タスク・ログの閲覧権限があります。tailnet のアクセス制御も利用してください。

サービスは一時的な systemd ユーザーユニットです。端末を閉じても稼働しますが、**PC 再起動後は `manage.py start` が必要**です。user manager がログアウトで停止する環境ではログアウトでも止まります。自動起動設定や恒久的なサービスファイルをフォルダ外に残さないための設計です。

設定は `.runtime/config.json`。`host`、`port`、`public_url`、`codex`、`base_branch`、`remote`、`timeout_minutes`（初期120分）、`push` は停止中に編集し、再起動します。`paused`、`max_workers` は画面/APIから変更でき、保存されます。

ローカルのみの場合は `init --tailscale` の代わりに `init`。systemd を使わない場合は `python3 dev-dashboard/server.py` でも起動できます。

### 専用 Codex CLI

この環境の既存 CLI 0.146.0 は設定済みモデルに非対応だったため、公式 CLI 0.157.1 を `.runtime/codex-cli/` に配置しています。グローバル CLI は変更していません。再構築する場合:

```sh
npm install --prefix dev-dashboard/.runtime/codex-cli --no-audit --no-fund @openai/codex@0.157.1
```

`init` はこの専用 CLI があれば優先します。既に初期化済みなら `.runtime/config.json` の `codex` に `dev-dashboard/.runtime/codex-cli/node_modules/.bin/codex` の**絶対パス**を設定します。モデルは利用者の Codex 設定を継承します。

実行には [Codex の非対話モード](https://learn.chatgpt.com/docs/non-interactive-mode) (`codex exec --sandbox workspace-write --json --output-schema`) を使います。承認が必要な作業は無断で権限を広げず「要対応」にします。依存パッケージの取得や SpaceROS の実行など、サンドボックスでできない操作がある場合は、その worktree で必要な準備・検証を行って再試行してください。AstroForge では各試行の冒頭にサービス側で `npm ci --ignore-scripts` を実行し、worktree ごとに依存パッケージを用意します。main の node_modules とは共有しません。準備コマンドもタイムアウト・停止・ログの管理対象です。追加の準備は停止中に設定ファイルの `setup_commands`（引数配列の配列、シェル展開なし）で指定できます。

## Codex / CLI / API

ローカル CLI はトークンを自動で読み取ります。引数にトークンを露出させません。

```sh
python3 dev-dashboard/manage.py api tasks
python3 dev-dashboard/manage.py api tasks --method POST --data '{"title":"改善内容","prompt":"実装内容と完了条件をここに記入","priority":0,"dependencies":[]}'
python3 dev-dashboard/manage.py api settings --method PATCH --data '{"paused":true}'
python3 dev-dashboard/manage.py api tasks/TASK_ID/log
python3 dev-dashboard/manage.py api tasks/TASK_ID/cancel --method POST --data '{}'
python3 dev-dashboard/manage.py api tasks/TASK_ID/retry --method POST --data '{}'
python3 dev-dashboard/manage.py api tasks/TASK_ID/done --method POST --data '{}'
```

長い入力は JSON ファイルを作り `--data @/path/to/task.json` で渡せます。

外部クライアントは `Authorization: Bearer <token>` と JSON の `Content-Type: application/json` を付けます。API の仕様は [openapi.json](openapi.json)、稼働サーバーでは `GET /api/openapi.json`（認証必須）。エラーは JSON の `error`、入力不正は400、未認証は401、Origin/Host不正は403、未知リソースは404、Git 操作失敗・状態競合は409です。ブラウザは HttpOnly / SameSite=Strict cookie を利用し、外部 Origin からの呼び出しは拒否します。

| API | 用途 |
| --- | --- |
| `GET /healthz` | 起動確認（認証不要） |
| `GET /api/tasks` / `POST /api/tasks` | 一覧 / 登録 |
| `GET /api/tasks/{id}` | 状態、結果、worktree、ブランチ |
| `GET /api/tasks/{id}/log` | 当該試行のログ末尾64KB |
| `POST /api/tasks/{id}/cancel` | 停止 |
| `POST /api/tasks/{id}/retry` | 保持した worktree で再試行 |
| `POST /api/tasks/{id}/done` | main への統合を検証して完了 |
| `GET /api/worktrees` | Git worktree 一覧 |
| `GET /api/settings` / `PATCH /api/settings` | キュー設定 |

タスク ID は作成応答の `id`。UI の依存選択は1件、API は複数の既存タスクを指定できます。priority は -100〜100、大きい値から実行し、同値では登録順です。キューの取得・実行枠の割当はロックで直列化し、プロセス重複起動はファイルロックで防ぎます。

## 保管場所と削除

```text
dev-dashboard/
  server.py                独立 HTTP サーバー・スケジューラー
  manage.py                サービス管理・API クライアント
  static/                  独立した画面
  tests/                   一時 Git リポジトリを使うテスト
  .runtime/                Git 管理対象外、アクセス権0700
    config.json / token    設定・管理トークン（0600）
    queue.sqlite*          ToDo と状態（SQLite WAL）
    logs/                  試行別 JSONL と結果
    worktrees/<task-id>/   タスク別作業場所
    codex-cli/             専用 CLI
```

AstroForge の他のファイルに参照や設定を追加していないので、このフォルダを削除すれば機能を取り除けます。実行中のプロセスはフォルダ削除を検知して終了します。削除前に未コミットの作業やデータを残したい場合は退避してください。

後始末も含める場合、`python3 dev-dashboard/manage.py cleanup` で停止し、変更のない管理対象 worktree の Git 登録を解除してからフォルダを削除します。未コミット・未追跡ファイルがある worktree は強制削除せず停止します。フォルダを直接削除した場合、Git の worktree 登録だけが `.git` に残るので `git worktree prune` で掃除できます。成果のブランチ、コミット、リモートブランチは削除しません。

## 確認

```sh
python3 -m unittest discover -s dev-dashboard/tests -v
node --check dev-dashboard/static/app.js
# 実 Codex 認証・実装・テスト・ローカル bare リモートへの push まで確認
python3 dev-dashboard/tests/smoke_codex.py --codex /absolute/path/to/codex
```

通常テストは模擬 Codex と本物の Git / HTTP サーバーを使い、認証・Origin制限・容量上限・依存関係・停止・失敗・再試行・再起動復旧・ブランチへの push を検証します。外部ネットワークや本体起動は不要です。実 Codex テストは API の利用枠を消費し、テンポラリディレクトリのみを変更します。

成功判定は Codex の終了コードと構造化された検証結果です。テスト内容の妥当性まで機械的に証明するものではないため、結果・ログ・diff をレビューして統合します。ROS2 デモの変更にはリポジトリの SpaceROS 検証規則を引き継ぎ、環境不足を成功扱いしません。

## Ubuntu: `bwrap: loopback: Failed RTM_NEWADDR`

端末で成功しても systemd サービスでは失敗する場合があります。Codex Desktop の AppArmor プロファイルを継承する端末での確認だけでは、常駐サービスの動作確認になりません。

```sh
# モデルを呼ばず、実サービスと同じ systemd 経由で確認
python3 dev-dashboard/manage.py doctor
# Ubuntu 24.04 の公式手順。端末で sudo パスワードの入力が必要
bash dev-dashboard/repair-sandbox.sh
```

修復スクリプトは OS の前提パッケージ `bubblewrap` / `apparmor-profiles` / `apparmor-utils` を導入し、配布元の `bwrap-userns-restrict` プロファイルを `/etc/apparmor.d/` に配置・ロードします。この OS 設定はダッシュボードのフォルダ外に残る共有のサンドボックス前提条件です。既存プロファイルは上書きしません。AppArmor 全体や Codex のサンドボックスは無効化しません。[OpenAI の公式手順](https://learn.chatgpt.com/docs/sandboxing)に基づきます。

各タスクは依存パッケージ準備・モデル実行の前にサンドボックス起動を検査します。失敗時はログを残してタスクを「要対応」にし、キューを一時停止します。修復後に `doctor` が成功したら、対象タスクを「再試行」にしてキューを再開してください。キャンセル済みタスクは自動再開しません。
