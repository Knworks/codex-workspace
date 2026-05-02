# 🧾Codex Workspace 要件定義書

## 1. 🎯背景と目的

* Codex のグローバル設定ディレクトリ（`~/.codex`）配下にある設定・プロンプト・スキル・テンプレート・エージェント・MCP 設定を、VS Code 内で一元的に閲覧・編集できるようにする。
* ターミナルや OS のファイラーで設定ファイルを探して編集する手間を削減し、運用の効率と作業の一貫性を高める。
* MCP サーバーの有効/無効（`enabled`）切り替えを VS Code UI から行えるようにし、設定変更の手間を下げる（反映には再起動が必要である旨を通知）。

---

## 2. 👥利用者とステークホルダー

* 利用者

  * Codex を利用し、`~/.codex` の設定（`config.toml`, `AGENTS.md`）、プロンプト、スキル、テンプレート、エージェント、MCP サーバー設定を日常的に編集する開発者
* ステークホルダー

  * 拡張機能開発者（作者）
  * 拡張機能利用者（Codex ユーザー）

---

## 3. 📚用語・ドメイン定義

| 用語            | 定義                                                      | 備考                                             |
| ------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `.codex`      | Codex のグローバル設定ディレクトリ。各 OS のホームディレクトリ直下の `~/.codex` を指す。 | Windows/macOS/Linux でホームパスは異なる                 |
| `config.toml` | Codex の設定ファイル（TOML形式）。MCP 設定を含む。                        | 破損（TOML parse 不可）の場合は拡張を利用不可                   |
| `AGENTS.md`   | Codex のエージェント設定/説明用ファイル（Markdown）。                      | 直接エディタで編集可能                                    |
| `prompts`     | プロンプトファイル/フォルダを格納するフォルダ（`.codex/prompts`）。階層は自由。        | ルートフォルダ名は固定／リネーム不可                             |
| `skills`      | スキルファイル/フォルダを格納するフォルダ（`.codex/skills`）。階層は自由。           | ルートフォルダ名は固定／リネーム不可                             |
| `codex-templates`   | テンプレートファイル/フォルダを格納するフォルダ（`.codex/codex-templates`）。           | 固定パス／ルートフォルダ名は固定／リネーム不可                        |
| `agents`      | エージェント定義ファイルを格納するフォルダ（`.codex/agents`）。                     | 固定パス／`*.toml` を対象／ルートフォルダ名は固定／リネーム不可          |
| `.codex-workspace` | 拡張機能が生成するメタファイルの管理フォルダ（`.codex/.codex-workspace`）。          | 拡張機能管理領域                                       |
| `agents-disabled.json` | 無効化したエージェントの退避情報を保持するファイル。                       | 保存先は `.codex/.codex-workspace/agents-disabled.json` |
| `codex-sync.json` | 同期の削除判定に使うメタ情報を保持するファイル。                           | 保存先は `.codex/.codex-workspace/codex-sync.json`      |
| MCP           | Model Context Protocol のサーバー設定群。                        | `[mcp_servers.<id>]` テーブルとして `config.toml` に定義 |
| MCP サーバー      | `config.toml` の `[mcp_servers.<id>]` ブロック1つを指す。         | `<id>` がサーバー表示名                                |
| `enabled`     | MCP サーバーの有効/無効を表す設定値。                                   | 省略時は ON 扱い                                     |
| `rollout-*.jsonl` | Codex CLI のセッション履歴ファイル。                            | `$CODEX_HOME/sessions/年/月/日/` 配下に保存される |
| `user_message` | 履歴イベントのうち、ユーザーの発話本文。                                 | `type:"event_msg"` かつ `payload.type:"user_message"` |
| `task_started / task_complete` | 履歴タスクの開始/終了イベント。                            | `type:"event_msg"` かつ `payload.type:"task_started"` / `payload.type:"task_complete"` |
| `agent_message` | 履歴イベントのうち、AI の回答本文。                            | `type:"event_msg"` かつ `payload.type:"agent_message"` |
| `response_item(reasoning)` | 履歴イベントのうち、思考過程本文。                            | `type:"response_item"` かつ `payload.type:"reasoning"` |
| `turn_id` | 1タスクを識別する ID。                            | `task_started`〜`task_complete` を同一 `turn_id` で関連付ける |
| `maxHistoryCount` | 履歴一覧の最大表示件数設定。                            | 明示設定時のみ適用。未設定時は全件表示 |
| `incrudeReasoningMessage` | 思考過程表示の ON/OFF 設定。                            | 既定値 `false` |

---

## 4. 🎭ユースケース / ユーザーストーリー

* ユーザーは VS Code の専用 Explorer（複数ビュー）から `config.toml` / `AGENTS.md` を開き、エディタで編集できる。
* ユーザーは Prompts Explorer からプロンプトファイル/フォルダを作成・編集・リネーム・削除できる。
* ユーザーは Skills Explorer からスキルファイル/フォルダを作成・編集・リネーム・削除できる。
* ユーザーは Template Explorer からテンプレートファイル/フォルダを閲覧し、テンプレートファイルを開いて編集できる。
* ユーザーはファイル作成時に `.codex/codex-templates` 配下にテンプレートファイルが存在する場合、テンプレートを選択して雛形を適用できる。
* ユーザーは Agent Explorer で `.codex/agents` 配下の `*.toml` を一覧し、選択して編集できる。
* ユーザーは Agent Explorer からエージェントを追加し、追加時にテンプレート適用の有無を選択できる。
* ユーザーはエージェント追加時に `config.toml` へ `[agents.<agent>]` が自動追記される。
* ユーザーは Agent Explorer のコンテキストメニューからエージェントを有効化/無効化できる。
* ユーザーは Agent Explorer の「フォルダを開く」ボタンで `.codex/agents` を OS のエクスプローラ/Finder で開ける。
* ユーザーは MCP Explorer で MCP サーバー一覧を閲覧し、スイッチ風 UI で `enabled` を ON/OFF 切り替えできる。
* ユーザーは Prompts/Skills/Template Explorer の「フォルダを開く」ボタンで各ルートフォルダを OS のエクスプローラ/Finder で開ける。
* ユーザーは Codex Core の「フォルダを開く」ボタンで `.codex` を OS のエクスプローラ/Finder で開ける。
* ユーザーは Refresh 操作により全ビューを更新できる。
* `.codex` や `config.toml` が存在しない/壊れている場合、ユーザーは「拡張が利用できない」ことを UI 上で確認できる。
* ユーザーは VS Code の表示言語に応じて、日本語または英語で拡張の表示（ラベル/メッセージ）を利用できる。
* ユーザーは Codex Core の同期ボタンを押下することで、`.codex` と同期フォルダの間で最終更新日時が新しいファイルを正として相互同期できる。
* ユーザーは Prompts Explorer の同期ボタンを押下することで、`.codex/prompts` と同期フォルダの間で最終更新日時が新しいファイルを正として相互同期できる。
* ユーザーは Skills Explorer の同期ボタンを押下することで、`.codex/skills` と同期フォルダの間で最終更新日時が新しいファイルを正として相互同期できる。
* ユーザーは Template Explorer の同期ボタンを押下することで、`.codex/codex-templates` と同期フォルダの間で最終更新日時が新しいファイルを正として相互同期できる。
* ユーザーは Agent Explorer の同期ボタンを押下することで、`.codex/agents` と同期フォルダの間で最終更新日時が新しいファイルを正として相互同期できる。
* ユーザーは Agent 同期で `.codex/agents` から削除されたエージェントについて、`config.toml` の `[agents.<agent>]` エントリと `.codex/.codex-workspace/agents-disabled.json` の退避エントリが自動削除される。
* ユーザーは Agent 同期で追加されたエージェントについて、`config.toml` に最小構成の `[agents.<agent>]` エントリが自動追記される。
* 既存ユーザーはアップデート後も旧同期メタ（`.codex/.codex-sync/state.json`）から新同期メタ（`.codex/.codex-workspace/codex-sync.json`）へ移行され、同期機能を継続利用できる。
* 既存ユーザーはアップデート後も `.codex/codex-templates` の運用を変更せず、テンプレート選択を継続利用できる。
* ユーザーは Codex Core Explorer の履歴ボタン（codicon: `history`）から、エディタ領域に会話履歴ビューを開ける。
* ユーザーはコマンドパレットから会話履歴ビューを開ける。
* ユーザーは左ペインの日付フォルダ（`yyyy/mm/dd`）とタスクカードを使い、履歴を新しい順に閲覧できる。
* ユーザーはセッションカードを選択し、右ペインでユーザーメッセージ全文と AI メッセージ/思考過程を時系列で確認できる。
* ユーザーはユーザーメッセージ全文を対象に検索し、部分一致で一覧を絞り込み、カード表示で一致箇所をハイライト表示できる。
* ユーザーは検索クリアで全件表示へ戻せる。

---

## 5. ✅機能要件

### 5.1 ビュー（Explorer）構成

* 次のビューを提供する（同一 View Container 配下に配置）

  * Prompts Explorer
  * Skills Explorer
  * Template Explorer
  * Agent Explorer
  * MCP Explorer
  * Codex Core（`config.toml` / `AGENTS.md`）
* 各 Explorer は以下の固定ルートフォルダを持つ（UI ではルート直下の階層を表示し、ルート自体は表示しない）。

  * Prompts Explorer：`prompts`（`.codex/prompts`）
  * Skills Explorer：`skills`（`.codex/skills`）
  * Template Explorer：`codex-templates`（`.codex/codex-templates`）
  * Agent Explorer：`agents`（`.codex/agents`）
* 上記の固定ルートフォルダは **リネーム不可**とする。

### 5.2 利用可否判定（共通）

* 以下のいずれかに該当する場合、拡張機能は「利用不可」とする。

  * `~/.codex` が存在しない
  * `~/.codex/config.toml` が存在しない
  * `config.toml` が読み取れない
  * `config.toml` が TOML として parse できない
* 利用不可の場合、各ビューには同一の 1 アイテムのみ表示する。

  * 表示：`⚠ Codex Workspace を開けません: <理由>`
* 利用不可の場合、全コマンド操作は実行不可とする。

### 5.3 選択必須（共通）

* 削除/リネームなどの操作は対象選択が必須。
* 対象が未選択の場合は操作を実行せず、右下に簡易メッセージを表示する。

  * `showInformationMessage("操作する対象を選択してください。")`（英語環境では英語表示）

### 5.4 アイコン表示（共通）

* 以下の対象にはアイコンを設定する。
  * プロンプトファイル：`markdown32.png`
  * プロンプトフォルダ：`folder32.png`
  * エージェント（有効）：`agent_on.png`
  * エージェント（無効）：`agent_off.png`
  * MCP サーバー：`mcp32.png`
* MCP の ON/OFF はスイッチ風 UI として視認できること（アイコン表現を含む）。

### 5.5 ファイル/フォルダ操作（prompts / skills / codex-templates）

* フォルダ階層は自由。
* ファイルを選択した場合は、通常の VS Code Explorer と同様にエディタで開く（テキスト編集）。

#### 5.5.1 初回作成時のルートフォルダ自動作成

* ファイル追加/フォルダ追加の実行時に、対象 Explorer のルートフォルダ（`.codex/prompts` / `.codex/skills` / `.codex/codex-templates`）が存在しない場合は、拡張が自動で作成する。

#### 5.5.2 追加（ファイル/フォルダ）

* 作成先ルール

  * 選択対象がフォルダ：そのフォルダ配下に作成
  * 選択対象がファイル：そのファイルの親フォルダ配下に作成
  * 未選択：対象 Explorer のルートフォルダ配下に作成
* ファイル作成時の拡張子

  * 入力が拡張子なし：`.md` を付与
  * 入力が拡張子あり：入力を優先
* 命名重複時

  * ファイル：`_1`, `_2`… の連番候補を提示し、OK で連番名を採用して作成
  * フォルダ：同名が存在する場合はエラー表示で中止
* 入力名のバリデーション

  * ファイル名/フォルダ名に使用できない文字列は `_` に置換する

#### 5.5.3 編集（Open）

* 対象がファイルの場合、エディタで開く。
* 対象がフォルダの場合、編集操作は行わない（もしくは無効）。

#### 5.5.4 削除（物理削除）

* 対象：ファイル/フォルダ
* フォルダは再帰削除する（配下をすべて削除）
* 確認ダイアログは必須。文言例：

  * フォルダ：`このフォルダ以下をすべて削除してもよろしいですか？`
  * ファイル：`このファイルを削除してもよろしいですか？`
* 確認ダイアログには対象パス/名称を表示する。

#### 5.5.5 リネーム（Rename）

* 対象：ファイル/フォルダ
* ファイルは拡張子込みでリネーム対象とする。
* 固定ルートフォルダ（`prompts` / `skills` / `codex-templates`）は常にリネーム不可とする。

**ファイル**

* 目標名が存在しない場合：そのままリネーム
* 目標名が存在する場合：`_1`, `_2`… の連番候補を提示し、OK で連番名を採用してリネーム（キャンセルで中止）
* 大文字小文字のみの変更は許可する

**フォルダ**

* 目標名が存在する場合：リネーム不可（エラー表示）
* 大文字小文字のみの変更は許可する

### 5.6 テンプレート機能（`.codex/codex-templates` 固定）

* テンプレートフォルダは `.codex/codex-templates` に固定する（設定値は存在しない）。
* `.codex/codex-templates` 配下にテンプレートファイルが存在する場合のみ、ファイル作成時にテンプレート選択を可能とする。
* テンプレート選択対象は「ファイルのみ」とし、隠しファイル（`.` 始まり）は除外する。
* 選択したテンプレートファイルの内容を新規作成ファイルに適用する。
* Template Explorer ではテンプレートファイルを開いて編集できる。

### 5.7 MCP Explorer

#### 5.7.1 一覧抽出

* `config.toml` 内の `[mcp_servers.<id>]` を MCP サーバー定義として抽出する。
* `<id>` をサーバー名として表示する。
* 並び順は `config.toml` に出現した順（設定値順）とする。

#### 5.7.2 トグル UI（スイッチ風）

* MCP サーバーの ON/OFF は、Tree 上でスイッチ風に見える UI として提供する。

  * クリック操作で ON/OFF が切り替わる。
  * ON/OFF の状態はスイッチ表現（アイコンや装飾）で明確に視認できる。

#### 5.7.3 トグル仕様（enabled パッチ）

* ブロック内の `enabled` 行を検出し、値を `true/false` 反転する。
* `enabled` 行の検出はスペース有無を許容する（例：`enabled=true`, `enabled = true`）。
* 末尾コメント（例：`enabled = true # comment`）が存在する場合、コメントは保持する。
* `enabled` が無い場合は ON 扱いとし、トグル操作で OFF にするため、ヘッダ直下に `enabled = false` を挿入する。
* トグル成功後は通知を表示する。

  * `設定を更新しました。反映には Codex の再起動が必要です。`（英語環境では英語表示）

### 5.8 フォルダを開く

* Prompts/Skills/Template Explorer の「フォルダを開く」ボタンは、それぞれ `.codex/prompts` / `.codex/skills` / `.codex/codex-templates` を開く。
* Agent Explorer の「フォルダを開く」ボタンは `.codex/agents` を開く。
* Codex Core の「フォルダを開く」ボタンは `.codex` を開く。

### 5.9 Refresh

* Refresh 操作は Prompts / Skills / Template / Agent / MCP / Core の **全ビューを更新**する。

### 5.10 多言語対応（日本語・英語）

* 拡張機能のラベル/メッセージは **日本語・英語**を提供する。
* VS Code の表示言語が **日本語（ja）**の場合は日本語を表示する。
* VS Code の表示言語が **日本語以外**の場合はすべて英語を表示する。

### 5.11 同期（Sync）

* 同期先フォルダ設定を追加する（既定値はブランク）。
  * Codex Core Sync Folder（キー：`codexFolder`）
  * Prompts Sync Folder（キー：`promptsFolder`）
  * Skills Sync Folder（キー：`skillsFolder`）
  * Template Sync Folder（キー：`templatesFolder`）
  * Agent Sync Folder（キー：`agentFolder`）
* 拡張機能が作成するメタファイルの固定ルートは `.codex/.codex-workspace/` とする。
* 同期メタの保存先は `.codex/.codex-workspace/codex-sync.json` とする。
* 互換読み取りの優先順は `.codex/.codex-workspace/codex-sync.json` → `.codex/.codex-sync/state.json` とする。
* 新保存先が存在せず旧保存先が存在する場合、旧内容を新保存先へ原子的に移行し、移行後に旧 `state.json` を削除する。
* 移行に失敗した場合は旧保存先を保持し、処理を中断してエラー通知する。
* Codex Core
  * 同期ボタン（codicon: `sync`）を追加する。
  * `codexFolder` が未設定の場合は同期ボタンを非表示にする。
  * 押下時に確認メッセージを表示し、OK の場合に `.codex/AGENTS.md` と `.codex/config.toml` を `codexFolder` と相互同期する。
    * `.codex` と `codexFolder` の同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
    * いずれかで削除されたファイルは両方から削除する。
    * 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で対象エントリを削除する。
    * `.codex/.codex-workspace` 配下は隠しフォルダとして同期対象外とする。
    * 隠しフォルダ/隠しファイルは対象外とする。
    * 上書き中にエラーが発生した場合は該当ファイルのみスキップし、スキップした旨を簡易ダイアログで通知する。
    * 文言：`<パス> のファイルを上書きしますがよろしいですか？`
* Prompts Explorer
  * 同期ボタン（codicon: `sync`）を追加する。
  * `promptsFolder` が未設定の場合は同期ボタンを非表示にする。
  * 押下時に確認メッセージを表示し、OK の場合に `.codex/prompts` と `promptsFolder` を相互同期する。
    * `.codex/prompts` と `promptsFolder` の同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
    * いずれかで削除されたファイルは両方から削除する。
    * 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で対象エントリを削除する。
    * `.codex/.codex-workspace` 配下は隠しフォルダとして同期対象外とする。
    * 隠しフォルダ/隠しファイルは対象外とする。
    * 上書き中にエラーが発生した場合は該当ファイルのみスキップし、スキップした旨を簡易ダイアログで通知する。
    * 文言：`<パス> のファイルを上書きしますがよろしいですか？`
* Skills Explorer
  * 同期ボタン（codicon: `sync`）を追加する。
  * `skillsFolder` が未設定の場合は同期ボタンを非表示にする。
  * 押下時に確認メッセージを表示し、OK の場合に `.codex/skills` と `skillsFolder` を相互同期する。
    * `.codex/skills` と `skillsFolder` の同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
    * いずれかで削除されたファイルは両方から削除する。
    * 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で対象エントリを削除する。
    * `.codex/.codex-workspace` 配下は隠しフォルダとして同期対象外とする。
    * 隠しフォルダ/隠しファイルは対象外とする。
    * 上書き中にエラーが発生した場合は該当ファイルのみスキップし、スキップした旨を簡易ダイアログで通知する。
    * 文言：`<パス> のファイルを上書きしますがよろしいですか？`
* Template Explorer
  * 同期ボタン（codicon: `sync`）を追加する。
  * `templatesFolder` が未設定の場合は同期ボタンを非表示にする。
  * 押下時に確認メッセージを表示し、OK の場合に `.codex/codex-templates` と `templatesFolder` を相互同期する。
    * `.codex/codex-templates` と `templatesFolder` の同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
    * いずれかで削除されたファイルは両方から削除する。
    * 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で対象エントリを削除する。
    * `.codex/.codex-workspace` 配下は隠しフォルダとして同期対象外とする。
    * 隠しフォルダ/隠しファイルは対象外とする。
    * 上書き中にエラーが発生した場合は該当ファイルのみスキップし、スキップした旨を簡易ダイアログで通知する。
    * 文言：`<パス> のファイルを上書きしますがよろしいですか？`
* Agent Explorer
  * 同期ボタン（codicon: `sync`）を追加する。
  * `agentFolder` が未設定の場合は同期ボタンを非表示にする。
  * 押下時に確認メッセージを表示し、OK の場合に `.codex/agents` と `agentFolder` を相互同期する。
    * `.codex/agents` と `agentFolder` の同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
    * いずれかで削除されたファイルは両方から削除する。
    * 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で対象エントリを削除する。
    * `.codex/.codex-workspace` 配下は隠しフォルダとして同期対象外とする。
    * 隠しフォルダ/隠しファイルは対象外とする。
    * 上書き中にエラーが発生した場合は該当ファイルのみスキップし、スキップした旨を簡易ダイアログで通知する。
    * 文言：`<パス> のファイルを上書きしますがよろしいですか？`
    * 同期結果でエージェントファイルが削除された場合、対応する `[agents.<agent>]` を `config.toml` から削除する。
    * 同期結果でエージェントファイルが削除された場合、`.codex/.codex-workspace/agents-disabled.json` の対応エントリも削除する。
    * 同期結果でエージェントファイルが新規追加された場合、`config.toml` に最小構成の `[agents.<agent>]` を追記する。

### 5.12 Agent Explorer

#### 5.12.1 一覧表示と基本操作

* 固定ルート `.codex/agents` 配下の `*.toml` を一覧表示する。
* 一覧アイテム選択時は該当 `*.toml` をエディタで開く。
* 以下の操作を提供する。
  * 新規作成
  * リネーム
  * 削除
  * エディタで開く（選択時）

#### 5.12.2 追加・編集・削除フロー

* 追加フローは以下の順序で実施する。
  1. エージェント名入力
  2. 説明入力
  3. テンプレート選択（「空のファイル」を含む）
* 作成先は `.codex/agents/<agent>.toml` とする。
* 同名ファイルが既に存在する場合は作成を中断し、衝突通知する。
* 編集フローはエージェント名と説明の編集を提供する。
* 削除フローは確認ダイアログを表示し、OK 時のみ物理削除する。

#### 5.12.3 `config.toml` 連携

* `.codex/agents/<agent>.toml` 作成成功後に `config.toml` へ `[agents.<agent>]` を自動追記する。
* 自動追記の最小構成は以下とする。
  * `description`（空文字許可）
  * `config_file = "agents/<agent>.toml"`
* 既に `[agents.<agent>]` が存在する場合は上書きせず、通知する。

#### 5.12.4 有効/無効切り替え

* Agent Explorer のコンテキストメニューに `Agentを有効化` / `Agentを無効化` を追加する。
* Agent Explorer のインライン操作は文字列ではなくアイコンで表現し、有効化は `images/agent_on.png`、無効化は `images/agent_off.png` を使用する。
* 有効/無効の実体は `config.toml` の `[agents.<agent>]` の有無で表現する。
  * Enable：`[agents.<agent>]` を追加
  * Disable：`[agents.<agent>]` を削除
* Disable 時は削除ブロック（コメント含む）を `.codex/.codex-workspace/agents-disabled.json` に退避する。
* Enable 時は退避ブロックがあれば復元し、なければ最小構成ブロックを追加する。
* 切り替え後は再起動が必要な旨を通知する。

### 5.13 会話履歴ビュー（History）

* 呼び出し導線
  * Codex Core Explorer の上部に履歴ボタン（codicon: `history`）を追加する。
  * コマンドを追加し、コマンドパレットから会話履歴ビューを開けるようにする。
  * 表示先は WebviewPanel を利用した **エディタ領域**とする。
  * 既に履歴ビューが開いている場合は再利用し、前面表示する（単一インスタンス）。
  * 履歴ビュー追加により既存 Explorer 機能の挙動を変更しない。
* データソース / 解析対象
  * 履歴データは `$CODEX_HOME/sessions/.../rollout-*.jsonl` を正とする。
  * フォルダ階層は `年/月/日` を前提とする。
  * 新形式イベントのみを解析対象とする（旧形式ログは対象外）。
  * 1 タスクは `type:"event_msg"` かつ `payload.type:"task_started"`〜`payload.type:"task_complete"` の同一 `turn_id` 区間で定義する。
  * 1 タスク内の抽出対象は以下とする。
    * ユーザー: `type:"event_msg"` かつ `payload.type:"user_message"`（最初の 1 件）
    * AI回答: `type:"event_msg"` かつ `payload.type:"agent_message"`（複数件）
    * 思考過程: `type:"response_item"` かつ `payload.type:"reasoning"`（複数件）
  * `turn_id` が欠落したイベントは、`turn_context.turn_id` または単一アクティブタスクにフォールバックして紐づける。
  * `task_complete` が欠落する場合でも、ファイル末尾時点のアクティブタスクを確定する。
* 画面構成
  * 上部に検索エリア、下部に左右 2 ペイン（左 30% / 右 70%）を表示する。
  * 左ペインは日付フォルダ（`yyyy/mm/dd`）とタスクカード一覧を表示する。
  * 右ペインは選択タスクの会話プレビュー（Markdown レンダリング）を表示する。
* 左ペイン（ツリー＋カード）
  * 日付フォルダは `yyyy/mm/dd` 単位で表示する。
  * タスクカードは新しい順で表示する。
  * カードタイトルは `user_message` の全文を検索対象とし、表示は最大 100 文字で省略する。
  * カード先頭にローカル時刻 `[H:mm:ss]` を表示する。
  * 表示件数は「全体の最新タスク件数」を `maxHistoryCount`（=1タスク=1ユーザーメッセージ）で制限する。
    * 明示設定時のみ適用し、未設定時は全件表示する。
* 右ペイン（会話プレビュー）
  * タスク選択時に `user_message` 全文を表示する。
  * AI回答（`agent_message`）と思考過程（`response_item.reasoning`）は同一タイムラインで時系列表示する。
  * 思考過程は折りたたみ表示（chevron）とする。
  * `incrudeReasoningMessage=false` の場合、思考過程は表示しない。
  * ユーザーメッセージと AI回答にコピー操作（codicon `copy`）を提供する。
* 検索
  * 対象は `user_message` 全文とする。
  * 一致ルールは大文字小文字を区別しない部分一致とする。
  * 検索は入力時および Enter で実行する。
  * 結果はツリー絞り込み状態で表示し、一致語をハイライトする。
  * クリア操作で絞り込みを解除する。
  * 検索一致箇所への自動スクロールは実装しない。

---

## 6. 🛡️非機能要件

* ユーザビリティ（操作性、UI/UX要件）

  * UI 最上部のボタン操作により、InputBox を順に入力して各操作（追加/編集/削除/更新/フォルダを開く）を行えること。
  * ボタンは codicon を使用し、`new-folder` / `new-file` / `trash` / `edit` / `refresh` / `folder-opened` / `sync` を表示する。
  * 操作対象が未選択の場合は右下にメッセージを表示し、選択を促すこと。
  * MCP の ON/OFF はスイッチ風 UI で直感的に切り替えられること。
  * アイコンにより、プロンプトファイル/フォルダ、エージェント状態および MCP の視認性が高いこと。
  * ファイルを選択した場合は通常の Explorer と同等にエディタで開いて編集できること。
  * 会話履歴ビューは左右 2 ペイン（左 30% / 右 70%）で表示されること。
  * 会話履歴の時刻表示はローカル時刻で自然な表記になること。
  * 検索ハイライトは VS Code テーマ色に追従し、可読性を維持すること。
* ブランド要件（製品名、ブランド、アイコン、メタ情報など）

  * 拡張名：Codex Workspace
  * タグライン：Explore and edit your .codex workspace (config.toml, AGENTS.md, prompts, skill, mcp) in VS Code.
  * Keywords：`codex`, `.codex`, `codex-cli`, `workspace`, `config`, `config.toml`, `toml`, `agent`, `AGENTS.md`, `prompts`, `prompt`, `skills`, `mcp`, `mcp server`, `explorer`, `tree view`, `editor`
* 保守性（拡張性、コード品質、ドキュメント）

  * ビュー（prompts/skills/templates/agents/mcp/core）ごとに責務を分離し、将来拡張（再起動支援等）を追加しやすい構造とすること。
  * UI とファイル操作ロジックを分離し、テスト容易性を確保すること。

---

## 7. 🔒制約条件

* 開発環境や言語、フレームワークに制約はありますか？

  * VS Code 拡張機能として開発する（TypeScript/Node.js および VS Code Extension API を想定）。
  * `.codex` はホームディレクトリ直下の `~/.codex` を対象とし、プロジェクトローカル（`workspace/.codex`）は扱わない。
  * 拡張のユーザー設定項目（設定値）は同期先フォルダ設定に加え、履歴表示設定（`maxHistoryCount` / `incrudeReasoningMessage`）を提供する。
  * 拡張機能メタファイルは `.codex/.codex-workspace/` に保存する。
  * 会話履歴データの参照先は `$CODEX_HOME/sessions/.../rollout-*.jsonl` のみとする。
* 外部システムとの連携は必要ですか？

  * Codex CLI の起動/終了/再起動などのプロセス制御は行わない（将来拡張で検討）。
  * MCP の切替は `config.toml` の編集により実施し、反映には再起動が必要である旨を通知する。
  * 会話履歴ビューは WebView を用いてエディタ領域に表示し、WebviewView は採用しない。

---

## 8. ⚠️リスクと課題

* 想定されるリスクや懸念点

  * `config.toml` のフォーマットや MCP 設定の仕様変更により、`[mcp_servers.<id>]` 抽出や `enabled` 行のパッチが将来的に動作しなくなる可能性。
  * ファイル/フォルダの物理削除や上書き削除を伴う操作により、ユーザーが意図せずデータを失うリスク（確認ダイアログで緩和）。
  * OS 依存のファイル名禁則（特に Windows）による作成/リネーム失敗（禁止文字 `_` 置換で緩和）。
  * `.codex/prompts` / `.codex/skills` / `.codex/codex-templates` の初回自動作成により、ユーザーの意図しないディレクトリ生成が発生する可能性（初回操作時に限定）。
  * `[agents.<agent>]` ブロックの追加/削除時に `config.toml` の構造を壊すと、エージェント有効/無効切替が失敗する可能性。
  * 旧同期メタ（`.codex/.codex-sync/state.json`）から新同期メタ（`.codex/.codex-workspace/codex-sync.json`）への移行失敗により、同期が中断される可能性。
  * 多言語対応により、文言の更新や追加時に翻訳漏れが発生する可能性。
  * `rollout-*.jsonl` のイベント形式変化により、`task_started/task_complete` 境界や `turn_id` 紐づけの抽出に失敗する可能性。
  * 会話履歴件数が多い日の一覧描画で、表示性能が低下する可能性。
* 解決すべき前提条件や依存関係

  * `enabled = true/false` が Codex 側で MCP の有効/無効として解釈されること（前提）。
  * `.codex/codex-templates` 配下にテンプレートファイルが存在する場合のみテンプレ選択が可能であること。
  * VS Code の表示言語判定（日本語か否か）に基づき表示言語を切り替えられること。
  * `$CODEX_HOME/sessions` が年/月/日ディレクトリ構成であり、`rollout-*.jsonl` が配置されること。
