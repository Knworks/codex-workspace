# 🧾Codex Workspace 要件定義書

## 1. 🎯背景と目的

- Codex 関連ファイルを VS Code から参照しやすくし、`~/.codex` と周辺保存場所の編集導線をまとめる。
- `config.toml`、`AGENTS.md`、Skills、Sub Agents、MCP Server、Templates、Commands、Codex Pet Explore を Explorer と Webview で扱えるようにする。
- Codex Manager から会話履歴、Core 設定周辺の診断、Plugin の構成情報を確認できるようにする。

---

## 2. 👥利用者とステークホルダー

- 利用者
  - Codex CLI を利用し、`~/.codex` やワークスペース配下の Codex 関連ファイルを編集する開発者
- ステークホルダー
  - 拡張機能開発者
  - 拡張機能利用者

---

## 3. 📚用語・ドメイン定義

| 用語 | 定義 | 備考 |
| --- | --- | --- |
| Codex Home | Codex の設定・状態ファイルのルート | 共通 resolver は空白のみでない `CODEX_HOME` を優先し、未設定・空文字・空白のみの場合は `~/.codex` を使用 |
| `config.toml` | Codex の主要設定ファイル | `~/.codex/config.toml` |
| `AGENTS.md` | Codex のグローバル AGENTS ファイル | `~/.codex/AGENTS.md` |
| `AGENTS.override.md` | グローバル override 用 AGENTS ファイル | 存在時のみ Core Explorer に表示 |
| Profile V2 設定ファイル | Codex Home 直下の `<name>.config.toml` | Base の `config.toml` と区別し、設定値は合成しない |
| `Commands` | `~/.codex/prompts` 配下のファイルを表示するビュー | View ID は `codex-workspace.prompts` |
| `Skills` | Skill ルート配下の `SKILL.md` を表示するビュー | Project / Workspace / User / System を列挙 |
| `Templates` | テンプレート保存場所 | `~/.codex/codex-templates` 固定 |
| `Sub Agents` | Agent 定義 `*.toml` を表示するビュー | `getAgentLocations()` の結果を列挙 |
| `MCP Server` | `config.toml` の `[mcp_servers.<id>]` 設定 | `env` / `http_headers` / `env_http_headers` / `tools.*` companion block は一覧表示しない |
| `Codex Manager` | Core 画面から開く WebviewPanel | History / AGENTS Loading Chain / Trusted Directory / Feature Flags / Hooks / Plugins タブを持つ |
| `Skill Manager` | Skills 一覧と有効/無効切替を行う WebviewPanel | `SKILL.md` frontmatter と `[[skills.config]]` を参照 |
| `AGENTS Manager` | Sub Agents 一覧管理とオーケストレーション workflow 編集を行う WebviewPanel | `config.toml`、disabled store、Agent TOML、`developer_instructions`、`.codex-workspace/orchestrations/*.json` を参照 |
| `MCP Manager` | MCP Server の一覧・作成・編集・削除を行う WebviewPanel | 左右 2 ペイン構成 |
| `Plugins` | インストール済み Plugin の構成情報 | `~/.codex/plugins/cache` と marketplace 定義を参照 |
| `Codex Pet Explore` | ペット表示、選択、接続状態、rate limit 吹き出しを扱う WebviewView | `~/.codex/pets/<petId>` を優先し、存在しない場合は `~/.codex/pet/<petId>` を参照 |
| `pet.json` | ペット定義 JSON | `spritesheetPath` は必須、`id` / `displayName` / `description` は任意 |
| `.codex-workspace` | 拡張機能のメタ領域 | `~/.codex/.codex-workspace` |
| `config.toml.bk` | `Organize config.toml` 実行前バックアップ | `~/.codex/.codex-workspace/config.toml.bk` |
| `agents-disabled.json` | 無効化した agent 設定ブロック退避先 | `~/.codex/.codex-workspace/agents-disabled.json` |
| `codex-sync.json` | 同期状態の保存先 | `~/.codex/.codex-workspace/codex-sync.json` |
| `orchestrations/*.json` | オーケストレーション workflow 定義 | `~/.codex/.codex-workspace/orchestrations/<workflowId>.json` |
| `maxHistoryCount` | 会話履歴一覧の最大件数設定 | 明示設定時のみ適用 |
| `incrudeReasoningMessage` | 履歴プレビューに reasoning を含める設定 | キー名は実装のまま |

---

## 4. 🎭ユースケース / ユーザーストーリー

- ユーザーは Core ビューから `config.toml`、`AGENTS.md`、`AGENTS.override.md` を開ける。
- ユーザーは Commands ビューで `~/.codex/prompts` 配下のファイルを開き、タイトルバーから新規ファイルを追加できる。
- ユーザーは Skills ビューで複数保存場所の Skill フォルダをまとめて見られる。
- ユーザーは Skills ビューで `SKILL.md` を開き、Skill root と `SKILL.md` に有効/無効アイコンを確認できる。
- ユーザーは Skill Manager で Skill 名、説明、保存場所、パスを一覧し、有効/無効を切り替えられる。
- ユーザーは Templates ビューでテンプレートファイルを開き、ファイル作成時の雛形として利用できる。
- ユーザーは Sub Agents ビューで Agent TOML を開き、AGENTS Manager から有効/無効を切り替えられる。
- ユーザーは AGENTS Manager の Agents タブで一覧から対象 Agent を選択し、詳細ペインで `developer_instructions` の HTML プレビューを確認できる。
- ユーザーは AGENTS Manager の Orchestration タブで workflow を作成、保存、読込、削除し、prompt を生成・コピーできる。
- ユーザーは MCP Server ビューでサーバー一覧を見て、項目クリックで有効/無効を切り替えられる。
- ユーザーは MCP Manager で MCP サーバーを追加、編集、削除できる。
- ユーザーは Codex Manager を開き、履歴検索、AGENTS Loading Chain、Trusted Directory、Feature Flags、Hooks、Plugins を確認できる。
- ユーザーは Codex Pet Explore でペットを選択し、アニメーション表示、ドラッグ移動、接続中の rate limit 吹き出しを確認できる。
- ユーザーは設定済みの同期先フォルダに対して Core / Commands / Skills / Templates / Sub Agents の同期を実行できる。

---

## 5. ✅機能要件

### 5.1 ビュー（Explorer）構成

- Activity Bar 配下に `codex-workspace` View Container を提供する。
- ビューの構成と表示名は以下とする。
  - `codex-workspace.core` : `Codex Manager`
  - `codex-workspace.agents` : `Sub Agents`
  - `codex-workspace.skills` : `Skills`
  - `codex-workspace.prompts` : `Commands`
  - `codex-workspace.mcp` : `MCP Server`
  - `codex-workspace.templates` : `Templates`
  - `codex-workspace.pet` : `Codex Pet Explore`
- Core ビューは `config.toml`、`AGENTS.md`、存在時のみ `AGENTS.override.md` を表示する。
- Core ビューは Codex Home 直下の `<name>.config.toml` を名前順に追加表示し、Profile V2 として区別する。各ファイルを VS Code エディタで開ける。一覧表示とOpen操作は App Server 接続や TOML の解析を必要としない。Profiles 専用タブは設けない。
- Skills ビューは以下の順で Skill ルートを表示する。
  - Project Skills: `workspace/.agents/skills` を優先し、存在しない場合は `workspace/.codex/skills`
  - Workspace Skills: `~/.codex/skills`
  - User Skills: `~/.agents/skills`
  - System Skills: `~/.codex/skills/.system`
- Sub Agents ビューは以下の順で Agent ルートを表示する。
  - Project Agents: `workspace/.codex/agents` を優先し、存在しない場合は `workspace/.agents/agents`
  - Workspace Agents: `~/.codex/agents`
  - User Agents: `~/.codex/agents` と異なるパスが返る場合のみ追加
- Templates の実体パスは `~/.codex/codex-templates` 固定とする。

### 5.2 利用可否判定（共通）

- 一般ビューと更新コマンドは `getWorkspaceStatus()` を利用し、以下のいずれかで利用不可とする。
  - `~/.codex` が存在しない
  - `~/.codex/config.toml` が存在しない
  - `config.toml` が読み取れない
  - `config.toml` が TOML として parse できない
- Core ビューと Codex Manager 起動は `getCoreWorkspaceStatus()` を利用し、`config.toml` が不正でも利用可能とする。
- 利用不可時は各 Tree に理由付きの単一項目を表示する。
- Core ビューで `config.toml` が不正な場合、`config.toml` 項目は warning アイコンと理由付き tooltip を表示する。

### 5.3 Commands / Skills / Templates のファイル操作

- 共通でファイルはエディタで開ける。
- 共通で rename / delete / refresh を提供する。
- 共通で名前は `sanitizeName()` により正規化する。
- ファイル追加時、拡張子がない場合は `.md` を付与する。
- 既存ファイル名と衝突した場合、ファイルは `_1`, `_2` 形式の候補を確認して採用する。
- フォルダ名衝突時はエラーで中止する。
- フォルダ削除は再帰削除する。
- `Commands` ビューのタイトルバー操作は新規ファイル、削除、リネーム、更新、フォルダを開く、同期とする。
- `Skills` ビューのタイトルバー操作は新規 root folder、削除、リネーム、更新、フォルダを開く、同期、Skill Manager 起動とする。
- `Templates` ビューのタイトルバー操作は新規 root folder、新規ファイル、削除、リネーム、更新、フォルダを開く、同期とする。
- `Skills` / `Templates` は item context からファイルとフォルダを追加できる。
- `Skills` の新規ファイルコマンドは root と folder に寄与するが、実行は folder 選択時のみ許可し、それ以外は案内メッセージで終了する。
- `Skills` root に対する新規フォルダ作成時は保存先を Project / Workspace / User から選択させる。
- `Skills` の folder に対する新規フォルダ作成時は `references/`、`scripts/`、`assets/` の候補を Quick Pick で選択できる。
- `Skills` の folder に対する新規フォルダ作成時、候補にない入力を行った場合は、その入力値を正規化した名前で子フォルダを作成する。
- `Skills` の `SKILL.md` と Skill root folder は `enabled` 状態に応じてアイコンを切り替える。
- 新規ファイル作成時は `~/.codex/codex-templates` 配下のテンプレート候補から内容を適用できる。

### 5.4 Skills の有効/無効管理

- Skill の有効/無効状態は `config.toml` の `[[skills.config]]` で管理する。
- `path` は `SKILL.md` の絶対パスを保存する。
- `enabled` が省略されている場合は有効扱いとする。
- 無効化時は `[[skills.config]]` block を追加または更新して `enabled = false` を保存する。
- 有効化時は対象 Skill の `[[skills.config]]` block 自体を削除する。
- Skill Manager は以下を表示する。
  - icon
  - name
  - description
  - skillPath
  - location label
  - toggle
  - open button
- Skill Manager の検索対象は name / description / skillPath とする。

### 5.5 Sub Agents の管理

- Sub Agents ビューは各ルート配下の `*.toml` を一覧表示する。
- 各項目は `config.toml` に `[agents.<id>]` が存在するかどうかで有効/無効アイコンを切り替える。
- タイトルバー操作は新規作成、編集、削除、更新、フォルダを開く、同期、AGENTS Manager 起動とする。
- enable / disable command は実装されているが、`package.json` のメニュー寄与には含めない。
- 新規作成時は保存先ルートを選び、Agent 名、説明、テンプレート内容の順に入力する。
- 新規作成でテンプレートなしの場合だけ、名前・説明のコメントヘッダーと `name`、`description`、`developer_instructions` を初期生成する。対象は #24 で確認した Codex CLI `0.163.0` の単独 Agent 形式で、必須の3項目はコメントとは別に空白でない文字列として保存する。
- 指示文の初期値には入力した説明を使う。説明が空または空白だけなら、必須の説明・指示文に編集を促す `TODO` を入れ、ヘッダーには入力値を保持する。モデル・権限は固定しない。
- 名前は既存のファイル名正規化後の値を使う。引用符・改行・バックスラッシュ・制御文字を文字列とコメントでエスケープし、日本語を保持する。
- テンプレート選択時（空のテンプレートを含む）・編集・有効化・設定整理では Agent TOML を自動補完せず、テンプレートまたは既存ファイルの内容を保持する。既存ファイルの一括修復・再生成は行わない。
- Agent 作成後、`config.toml` に description と `config_file` を含む `[agents.<name>]` block を自動追記または更新する。
- 編集時はファイル名と description を更新し、`config.toml` の block と `config_file` を追従させる。
- 削除時は TOML ファイルを削除し、`config.toml` の対応 block、disabled store、sync state の退避も削除する。
- 無効化時は対応 block を `agents-disabled.json` に退避し、`config.toml` から削除する。
- Explorer command の有効化時は退避 block があれば復元し、description と `config_file` を実体へ同期する。Agent TOML 自体は変更しない。
- AGENTS Manager は `Agents` タブで一覧詳細レイアウトを表示する。
- 一覧の正本は Base `config.toml`、Profile V2 `<name>.config.toml`、認識済み Project `.codex/config.toml` 内の `[agents.<role>]` 宣言とする。Profile 列挙は共通処理を再利用する。
- `config_file` の相対パスは宣言元設定のディレクトリを基準に解決し、絶対パスも扱う。role key はファイル名から独立して扱う。
- 同名 role は宣言元設定ごとに別行として表示し、ON/OFF は選択した宣言元設定だけを更新する。Base の既存 disabled store を維持し、Profile ごと・Project ごとの退避を分離する。
- 無効化した role は退避宣言から引き続き表示し、元の `config_file` を保持して再有効化できる。未登録 TOML は Manager の一覧に含めない。
- `config_file` がない role は継承設定として表示し、Open で宣言元設定を開く。参照先ファイルが存在しない宣言も一覧に含める。
- 設定レイヤーを合成した effective Agent の完全再現は対象外とする。
- 一覧は name / description / model / reasoningEffort / sandboxMode / path / location / toggle / open button を表示する。
- 詳細ペインは model / reasoningEffort / sandboxMode / location / path と `developer_instructions` のプレビューを表示する。
- `developer_instructions` のプレビューは Markdown を HTML 描画し、空の場合は空状態メッセージを表示する。
- AGENTS Manager は `Agents` タブと `Orchestration` タブを持つ。
- `Orchestration` タブでは workflow / agent / loop card を canvas 上で編集できる。
- workflow は `version` / `workflowId` / `name` / `description` / `finalOutputFormat` / `nodes` / `edges` / `createdAt` / `updatedAt` を持つ JSON として保存する。
- workflow の保存先は `~/.codex/.codex-workspace/orchestrations` とする。
- agent card は `order` / `agentName` / `purpose` / `input` / `expectedOutput` / `doneCriteria` を持つ。
- loop card は `maxAttempts` / `acceptanceCriteria` を持つ。
- edge は `workflow -> agent`、`agent -> loop`、`loop -> agent` のみを有効な接続とする。
- 保存前後に workflow のバリデーションを行い、重複 ID、不正接続、未到達 node、循環、必須項目欠落を警告またはエラーとして表示する。
- prompt 生成は保存済み workflow に限らず現在の編集内容から実行でき、生成結果を preview に表示して copy できる。

### 5.6 MCP Server の管理

- `config.toml` の `[mcp_servers.<id>]` を一覧表示する。
- `env` / `http_headers` / `env_http_headers` / `tools.*` companion block は Explorer と Manager の一覧に出さない。
- `enabled` がない場合は有効扱いとする。
- MCP Server ビューでは項目クリックで `enabled` をトグルする。
- 無効状態は `circle-slash` アイコン、有効状態は `mcp` アイコンを使う。
- MCP Manager は左ペインのサーバー一覧と右ペインの編集フォームを表示する。
- MCP Manager のフォーム項目は以下を扱う。
  - id
  - transport (`stdio` / `http`)
  - command
  - args
  - url
  - env
  - http_headers
  - env_http_headers
  - tools
  - required
  - startup_timeout_sec
  - tool_timeout_sec
  - enabled_tools
  - disabled_tools
- `enabled_tools` と `disabled_tools` の同時指定は保存不可とする。
- 保存時は既存 block の未管理キーを保持する。
- `env` / `http_headers` / `env_http_headers` は key-value 行編集で扱う。
- `tools` は tool name ごとに `enabled` / `approval_mode` を持つ行編集で扱う。
- `env` は `[mcp_servers.<id>.env]` block と inline table の両方を読める。
- `http_headers` / `env_http_headers` は companion block を優先し、inline table があれば読み込み対象に含める。
- MCP Manager が UI で管理する companion block は `env` / `http_headers` / `env_http_headers` / `tools.*` のみとする。
- 未知の companion block は UI では編集対象にせず、`config.toml` 手動管理前提のままとする。
- 親サーバーの rename / delete 時は、上記 companion block も追従する。
- 既存 inline `http_headers` は保存時に `[mcp_servers.<id>.http_headers]` companion block へ正規化される場合がある。

### 5.7 Codex Manager

- Core ビュー上部ボタンまたはコマンド `codex-workspace.openHistoryView` で WebviewPanel を開く。
- パネルタイトルは `Codex Manager` とする。
- タブは以下を表示する。
  - History
  - AGENTS Loading Chain
  - Trusted Directory
  - Feature Flags
  - Hooks
  - Plugins
- History タブ
  - `CODEX_HOME/sessions` または `~/.codex/sessions` 配下の `rollout-*.jsonl` を走査する
  - `task_started` / `task_complete` と `turn_id` を使ってタスク単位に集約する
  - 左ペインに `yyyy/mm/dd` ごとのカード一覧、右ペインにユーザー本文と assistant / reasoning タイムラインを表示する
  - `maxHistoryCount` が明示設定されている場合のみ件数制限する
  - `incrudeReasoningMessage` が false の場合 reasoning は非表示とする
- AGENTS Loading Chain タブ
  - workspace root を基準に Global / Project tier の `AGENTS.override.md`、`AGENTS.md`、fallback 候補を診断する
  - `Current` / `Ignored` / `Problems` に分類表示し、各候補の詳細を右ペインに表示する
- Trusted Directory タブ
  - `[projects."<path>"]` のうち `trust_level = "trusted"` のみ表示する
  - 追加と削除を行える
- Feature Flags タブ
  - インストール済み Codex CLI の `codex features list` から key、stage、現在の enabled を表示する
  - toggle は `codex features enable <feature>` / `codex features disable <feature>` を実行し、CLI から状態を再取得する
  - 対象は Base の `$CODEX_HOME/config.toml` とする。Profile 別の実効値管理と App Server API は対象外とする
  - CLI 未検出、実行失敗、出力形式不正ではエラーと再取得ボタンを表示し、固定定義へフォールバックしない
  - CLI が返さない既定値や設定元は推測して表示しない
  - `[features]` に残った、CLI 未掲載または `removed` のキーを削除候補とし、ツールバーに件数を表示する。対象キーと理由は削除確認ダイアログで表示する。`deprecated` や開発中のキーは候補にしない
  - 「古い設定を削除」で対象ファイル・キー・値・理由を確認し、承認された場合に限り削除する。通常の起動や再取得では自動削除しない
  - 確認中に設定内容やCLIの対応状況が変わった場合、未保存の編集がある場合、または安全に編集できないTOML形式では削除せずエラーを表示する
  - 対象以外の設定・コメント・改行とProfile設定を維持する。削除後に一覧を再取得する
  - `removed` のFeatureは表示のみとし、トグルから廃止済み設定を再作成しない
- Hooks タブ
  - user / project の `hooks.json` と inline hooks を診断表示する
  - Event は `PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`SubagentStart`、`SubagentStop`、`Stop`、`Interrupt` を認識する
  - Handler type は `command`、`mcp_tool`、`prompt`、`agent` を認識し、command 以外は定義内容も表示する
  - 未知の Event / Handler は元の名前と定義を保持し、`Unknown` として読み取り専用で表示する。Manager の設定保存で削除しない
  - source ごとの open / create 操作を提供する
  - ファイルベースの管理を維持し、App Server の `hooks/list` は使用しない
- Plugins タブ
  - `~/.codex/plugins/cache` からインストール済み Plugin を列挙する
  - marketplace 情報は `~/.agents/plugins/marketplace.json`、`workspace/.agents/plugins/marketplace.json`、`workspace/.claude-plugin/marketplace.json` を参照する
  - `[plugins."<id>"]` の `enabled` を切り替えられる
  - manifest 不備で `needs-review` になった Plugin、または `config.toml` が parse できない場合は toggle を無効化する
  - 詳細ペインで manifest、installed path、skills、mcpServers、apps、agents の情報を表示する

### 5.8 Codex Pet Explore

- `codex-workspace.pet` は `WebviewView` として提供する。
- View 自体の表示は `codex-workspace.pet.enabled` が true のときだけ有効にする。
- 既定値は `pet.enabled = false`、`pet.appServer.enabled = false`、`pet.rateLimitRefreshMinutes = 5`、`pet.scale = 1`、`pet.selectedPetId = ""` とする。
- 現行設定キーは `codex-workspace.pet.*` とし、読み取り時のみ legacy の `codexWorkspace.pet.*` も参照する。
- ペット保存場所は `~/.codex/pets/<petId>` を優先し、存在しない場合は `~/.codex/pet/<petId>` を参照する。
- 一覧対象はペット保存場所直下のディレクトリのうち、`pet.json` を持ち、かつ有効な `spritesheetPath` を解決できるものだけとする。
- `pet.json` の必須項目は `spritesheetPath` のみとし、`id` / `displayName` がない場合はフォルダ名を使う。
- `spritesheetPath` は pet フォルダからの相対パスのみ許可し、外部 URL、絶対パス、pet フォルダ外参照は禁止する。
- 選択ペットは `pet.selectedPetId` で保持し、未設定または不正な ID の場合は一覧先頭のペットを使う。
- 表示倍率は設定 `pet.scale` から読み取り、`0.5` から `2.0` の範囲に丸める。
- rate limit の再取得間隔は設定 `pet.rateLimitRefreshMinutes` から読み取り、`0` から `60` の範囲に丸める。小数値は保持する。
- Pet ビューでは `192px x 208px`、8 列固定のスプライトシートを canvas 描画する。
- タイトルバーの `Select Pet` コマンドから Quick Pick を開き、候補ペットを選択する。
- App Server 連携設定が OFF の場合、接続コマンドは表示しない。
- App Server 連携設定が ON の場合だけ title bar に connect / disconnect コマンドを表示する。
- 接続中のみ `codex app-server` を起動し、`account/rateLimits/read` の結果から rate limit を取得する。
- 吹き出しは rate limit を取得できたときだけ表示し、表示時間は約 5 秒とする。
- rate limit は `5h` と `1w` を対象にし、reset 時刻は `MM/DD HH:mm` で表示する。
- 残量 25% 以下の rate limit bar はピンク系、それより大きい場合はグリーン系で表示する。

### 5.9 同期

- 同期設定キーは以下とする。
  - `codex-workspace.codexFolder`
  - `codex-workspace.promptsFolder`
  - `codex-workspace.skillsFolder`
  - `codex-workspace.templatesFolder`
  - `codex-workspace.agentFolder`
- Core 同期は `AGENTS.md`、`AGENTS.override.md`、`config.toml` を対象にする。
- Commands / Skills / Templates / Sub Agents 同期は対応ディレクトリを相互同期する。
- 同名ファイルは更新日時が新しい側で上書きする。
- 削除同期状態は `~/.codex/.codex-workspace/codex-sync.json` に記録する。
- 旧状態ファイル `.codex/.codex-sync/state.json` があれば新形式へ移行する。
- 隠しファイル、隠しフォルダ、`.codex-workspace` メタディレクトリは同期対象外とする。
- Sub Agents 同期後は `reconcileAgentConfigAfterSync()` により `config.toml`、disabled store、sync state を追従させる。

### 5.9 `Organize config.toml`

- `codex-workspace.organizeConfigToml` コマンドを提供する。
- 実行前に `~/.codex/.codex-workspace/config.toml.bk` を更新する。
- 実行時は Agent file を元に description と `config_file` を修復してから整理する。
- 整理対象は以下とする。
  - `[features]`
  - `[[skills.config]]`
  - `[agents.<name>]`
  - `[mcp_servers.<id>]`
  - `[projects."<path>"]`
- `[mcp_servers.<id>.env]`、`[mcp_servers.<id>.http_headers]`、`[mcp_servers.<id>.env_http_headers]`、`[mcp_servers.<id>.tools.<tool_name>]` は親 block 直後へ再配置する。
- クラスタ順は「その種別が最初に出た位置」を保つ。

---

## 6. 🛡️非機能要件

- UI / UX
  - Tree View と WebviewPanel の組み合わせで操作する
  - UI 文言は `package.nls.json` / `package.nls.ja.json` と `src/i18n.ts` により英日対応する
  - Skill / Agent / MCP の ON/OFF は色とアイコンの両方で表す
  - Webview は VS Code テーマ色、editor font family、codicon を利用する
- 保守性
  - Tree Provider、各 manager panel、設定更新サービスを分離する
  - `src/test/` 配下にユニットテストを配置し、Explorer、設定更新、同期、診断、Plugin 読み取りを検証する

---

## 7. 🔒制約条件

- 実装は VS Code Extension API、TypeScript、Node.js を前提とする。
- Templates の保存先は `~/.codex/codex-templates` 固定で、設定で変更しない。
- `Commands` ビュー名は実装上の表示名であり、実体パスは `~/.codex/prompts` とする。
- `incrudeReasoningMessage` の設定キー名は既存互換のため変更しない。
- Plugin 情報は plugin cache と marketplace 定義の読取結果に依存し、manifest や定義ファイルが不正な場合は `needs-review` として扱う。

---

## 8. ⚠️リスクと課題

- `config.toml` の構文や block 形式が変わると、Skills / Agents / MCP / Feature Flags / Hooks / Plugins の書き換え処理が壊れる可能性がある。
- `rollout-*.jsonl` のイベント形式が変わると、会話履歴の抽出が不完全になる可能性がある。
- Skill / Agent / MCP / Plugin の toggle は `config.toml` 直接書き換えに依存するため、コメント保持には限界がある。
- Plugin の実体情報は cache 配下の manifest と周辺定義ファイルに依存するため、ファイル欠損時は表示が `needs-review` になる。
