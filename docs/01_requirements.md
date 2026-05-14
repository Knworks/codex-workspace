# 🧾Codex Workspace 要件定義書

## 1. 🎯背景と目的

- Codex 関連ファイルを VS Code から参照しやすくし、`~/.codex` と周辺保存場所の編集導線をまとめる。
- `config.toml`、`AGENTS.md`、Skills、Sub Agents、MCP Server、Templates、Commands を Explorer と Webview で扱えるようにする。
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
| `.codex` | Codex のホームディレクトリ配下にある設定ルート | `resolveCodexPaths()` は `~/.codex` を使用 |
| `config.toml` | Codex の主要設定ファイル | `~/.codex/config.toml` |
| `AGENTS.md` | Codex のグローバル AGENTS ファイル | `~/.codex/AGENTS.md` |
| `AGENTS.override.md` | グローバル override 用 AGENTS ファイル | 存在時のみ Core Explorer に表示 |
| `Commands` | `~/.codex/prompts` 配下のファイルを表示するビュー | View ID は `codex-workspace.prompts` |
| `Skills` | Skill ルート配下の `SKILL.md` を表示するビュー | Project / Workspace / User / System を列挙 |
| `Templates` | テンプレート保存場所 | `~/.codex/codex-templates` 固定 |
| `Sub Agents` | Agent 定義 `*.toml` を表示するビュー | `getAgentLocations()` の結果を列挙 |
| `MCP Server` | `config.toml` の `[mcp_servers.<id>]` 設定 | `.env` 末尾の補助 block は一覧表示しない |
| `Codex Manager` | Core 画面から開く WebviewPanel | History / AGENTS Loading Chain / Trusted Directory / Feature Flags / Hooks / Plugins タブを持つ |
| `Skill Manager` | Skills 一覧と有効/無効切替を行う WebviewPanel | `SKILL.md` frontmatter と `[[skills.config]]` を参照 |
| `AGENTS Manager` | Sub Agents 一覧と有効/無効切替を行う WebviewPanel | `config.toml`、disabled store、Agent TOML を参照 |
| `MCP Manager` | MCP Server の一覧・作成・編集・削除を行う WebviewPanel | 左右 2 ペイン構成 |
| `Plugins` | インストール済み Plugin の構成情報 | `~/.codex/plugins/cache` と marketplace 定義を参照 |
| `.codex-workspace` | 拡張機能のメタ領域 | `~/.codex/.codex-workspace` |
| `config.toml.bk` | `Organize config.toml` 実行前バックアップ | `~/.codex/.codex-workspace/config.toml.bk` |
| `agents-disabled.json` | 無効化した agent 設定ブロック退避先 | `~/.codex/.codex-workspace/agents-disabled.json` |
| `codex-sync.json` | 同期状態の保存先 | `~/.codex/.codex-workspace/codex-sync.json` |
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
- ユーザーは MCP Server ビューでサーバー一覧を見て、項目クリックで有効/無効を切り替えられる。
- ユーザーは MCP Manager で MCP サーバーを追加、編集、削除できる。
- ユーザーは Codex Manager を開き、履歴検索、AGENTS Loading Chain、Trusted Directory、Feature Flags、Hooks、Plugins を確認できる。
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
- Core ビューは `config.toml`、`AGENTS.md`、存在時のみ `AGENTS.override.md` を表示する。
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
- Agent 作成後、`config.toml` に description と `config_file` を含む `[agents.<name>]` block を自動追記または更新する。
- 編集時はファイル名と description を更新し、`config.toml` の block と `config_file` を追従させる。
- 削除時は TOML ファイルを削除し、`config.toml` の対応 block、disabled store、sync state の退避も削除する。
- 無効化時は対応 block を `agents-disabled.json` に退避し、`config.toml` から削除する。
- 有効化時は退避 block があれば復元し、その後に description と `config_file` を Agent TOML の実体へ再同期する。
- AGENTS Manager は name / description / model / reasoningEffort / sandboxMode / agentPath / location / toggle / open button を表示する。

### 5.6 MCP Server の管理

- `config.toml` の `[mcp_servers.<id>]` を一覧表示する。
- `id` が `.env` で終わる補助 block は Explorer と Manager の一覧に出さない。
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
  - required
  - startup_timeout_sec
  - tool_timeout_sec
  - enabled_tools
  - disabled_tools
- `enabled_tools` と `disabled_tools` の同時指定は保存不可とする。
- 保存時は既存 block の未管理キーを保持する。
- `env` は `[mcp_servers.<id>.env]` block と inline table の両方を読める。

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
  - `Current` / `Ignored` / `Problems` / `Detailed candidates` に分類表示する
- Trusted Directory タブ
  - `[projects."<path>"]` のうち `trust_level = "trusted"` のみ表示する
  - 追加と削除を行える
- Feature Flags タブ
  - `FEATURE_DEFINITIONS` に列挙された定義を表示する
  - toggle により `[features]` を更新できる
- Hooks タブ
  - user / project の `hooks.json` と inline hooks を診断表示する
  - source ごとの open / create 操作を提供する
- Plugins タブ
  - `~/.codex/plugins/cache` からインストール済み Plugin を列挙する
  - marketplace 情報は `~/.agents/plugins/marketplace.json`、`workspace/.agents/plugins/marketplace.json`、`workspace/.claude-plugin/marketplace.json` を参照する
  - `[plugins."<id>"]` の `enabled` を切り替えられる
  - manifest 不備で `needs-review` になった Plugin、または `config.toml` が parse できない場合は toggle を無効化する
  - 詳細ペインで manifest、installed path、skills、mcpServers、apps、agents の情報を表示する

### 5.8 同期

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
- `[mcp_servers.<id>.env]` は親 block 直後へ再配置する。
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
