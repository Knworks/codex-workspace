# Codex Workspace

Codex Workspace は、VS Code 上で散らばりがちな Codex の設定や運用情報を“ひとつに集約”し、迷わず管理できる拡張機能です。`config.toml` や `AGENTS.md` はもちろん、サブエージェント／Skills／Commands／Templates／MCP サーバー、会話履歴、Feature Flags、Hooks 診断までをまとめて扱えます。「どこに何があるか」を探す時間を減らし、すぐに作業へ戻れます。

## クイックスタート

1. Codex home（通常は `~/.codex`）が存在することを確認します。
2. VS Code の Activity Bar から **Codex Workspace** を開きます。
3. 各 Explore のタイトルバーから、次の操作を行います。
   - ファイル/フォルダを追加する
   - 対象フォルダを開く
   - 更新する
   - 同期する
   - Manager View を起動する
4. Core ビューまたはコマンドパレットから **Codex Manager** を開き、次の項目を確認します。
   - 履歴
   - AGENTS 診断
   - Trusted Directory
   - Feature Flags
   - Hooks

## 主な機能

- `Codex Manager`、`Sub Agents`、`Skills`、`Commands`、`MCP Server`、`Templates` の専用 Explore を提供
- `config.toml`、`AGENTS.md`、`AGENTS.override.md`、prompt、skill、template、agent 定義ファイルを 1 クリックで開く
- 対応 Explore で、ファイル/フォルダの追加、リネーム、削除が可能
- Core、Commands、Skills、Templates、Sub Agents を外部フォルダと双方向同期
- Project / Workspace / User / System を跨いだ Skills 一覧を表示
- Project / Workspace / User を跨いだ Sub Agents 一覧を表示
- Skills、Sub Agents、MCP Server 向けの専用 Manager View を提供
- 会話履歴、AGENTS Loading Chain、Trusted Directory、Feature Flags、Hooks をまとめた `Codex Manager` を提供

> **重要:** 会話履歴は `$CODEX_HOME/sessions/.../rollout-*.jsonl` を解析して表示しています。Codex 側のログ形式が変更されると、History タブが表示できなくなる可能性があります。

## Views

### Codex Manager

![alt text](images/view_codexmanager.png)

Core Explore から次の項目へアクセスできます。

- `config.toml`
- `AGENTS.md`
- `AGENTS.override.md`
- `.codex` フォルダを開く
- `Codex Manager` を開く
- `codex-workspace.codexFolder` との Core 同期

`Codex Manager` はエディタの Webview として開き、次のタブを持ちます。

- `History`
  - 検索可能な会話履歴
  - 一覧と詳細の独立スクロール
  - user / assistant テキストのコピー
  - 設定に応じた reasoning の表示
- `AGENTS Loading Chain`
  - 現在有効な AGENTS 系ファイルの診断
  - 無視された候補、問題、詳細候補の確認
  - 基準ワークスペースの表示
- `Trusted Directory`
  - `config.toml` 内の trusted project 一覧
  - 信頼ディレクトリの追加と削除
- `Feature Flags`
  - 主要な Codex feature flag の既定値、有効値、設定値の確認
  - 対応フラグの ON/OFF 切り替え
- `Hooks`
  - user / project の hook source 診断
  - trusted 状態に応じた project hooks の有効/無効表示
  - `hooks.json` / `config.toml` の作成とオープン

### Commands

`~/.codex/prompts` 配下のファイルを管理し、`codex-workspace.promptsFolder` と同期できます。

この Explore は互換性維持のために残しているもので、Skills、Sub Agents、MCP のような新しい Manager 型機能は追加していません。

### Skills

![alt text](images/view_skills.png)

次の複数保存場所の Skill を 1 つの Explore で扱います。

- `Project Skills`: `project/.agents/skills` を優先し、なければ `project/.codex/skills`
- `Workspace Skills`: `~/.codex/skills`
- `User Skills`: `~/.agents/skills`
- `System Skills`: `~/.codex/skills/.system`

Project Skills の新規作成先は常に `project/.agents/skills` です。  
ルートから追加する場合は、Project / Workspace / User を選択できます。  
`System Skills` は読み込み専用の表示対象として扱います。  
`Skill Manager` では検索、開く、有効/無効の切り替えが可能です。

### Sub Agents

![alt text](images/view_subagents.png)

次の複数保存場所のサブエージェントを扱います。

- `Project Agents`: `project/.codex/agents` を優先し、なければ `project/.agents/agents`
- `Workspace Agents`: `~/.codex/agents`
- `User Agents`: `~/.codex/agents`

Project Agents の新規作成先は常に `project/.codex/agents` です。  
`AGENTS Manager` で検索と有効/無効の管理が可能です。  
Explore のアイコンで有効/無効の状態を識別できます。

### MCP Server

![alt text](images/view_mcpserver.png)

`MCP Server` は Explore 側の素早い ON/OFF を維持しつつ、専用の `MCP Manager` を追加しています。

`MCP Manager` では次を行えます。

- 検索
- サーバー定義の追加、編集、削除
- 有効/無効の切り替え
- `stdio` / `http` transport の主要項目編集
- `env` の Key-Value 編集とバリデーション
- companion `.env` エントリを一覧から隠しつつ、親サーバー削除時は一緒に削除

### Templates

`~/.codex/codex-templates` 配下のテンプレートを管理します。ファイル作成時のテンプレート選択と、`codex-workspace.templatesFolder` との同期に対応しています。

## Commands

| コマンド | 説明 |
| --- | --- |
| `Codex Workspace: Open Codex Manager` | `Codex Manager` の Webview を開きます |
| `Codex Workspace: Open Skill Manager` | `Skill Manager` の Webview を開きます |
| `Codex Workspace: Open AGENTS Manager` | `AGENTS Manager` の Webview を開きます |
| `Codex Workspace: Open MCP Manager` | `MCP Manager` の Webview を開きます |
| `Codex Workspace: Open .codex Folder` | `.codex` フォルダを OS のファイルエクスプローラで開きます |

## Settings

| Key | Type | Default | 説明 |
| --- | --- | --- | --- |
| `codex-workspace.codexFolder` | string | `""` | `config.toml`、`AGENTS.md`、`AGENTS.override.md` など Core ファイルの同期先 |
| `codex-workspace.promptsFolder` | string | `""` | `Commands` の同期先 |
| `codex-workspace.skillsFolder` | string | `""` | Workspace Skills（`~/.codex/skills`）の同期先 |
| `codex-workspace.templatesFolder` | string | `""` | `Templates` の同期先 |
| `codex-workspace.agentFolder` | string | `""` | Sub Agents の同期先 |
| `codex-workspace.maxHistoryCount` | number | `100` | 明示設定した場合の履歴表示上限件数です。未設定時は検出した履歴を全件表示します。 |
| `codex-workspace.incrudeReasoningMessage` | boolean | `false` | 履歴プレビューに reasoning メッセージを含めます。キー名は後方互換のため維持しています。 |

## License

MIT
