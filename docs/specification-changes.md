# 🧾 追加・変更要件

## 🏷️ 概要

- カスタムエージェント（roles）管理を VS Code 拡張機能に追加する（MVP-3）
- エージェントファイルは **`.codex/agents` 固定ルート**で管理する
- エージェント追加時に **テンプレート適用の有無を選択**できる（プロンプト追加と同様のフロー）
- エージェント追加に合わせて `config.toml` の `[agents.<agent>]` を自動追加する
- エージェント有効/無効は **コンテキストメニュー**で切り替える
  - 実体は `config.toml` の `[agents.<agent>]` を **追加/削除**して実現する
  - 削除時の退避は **`.codex/.codex-workspace/agents-disabled.json`** に保存する
- 拡張機能が作成するメタファイルは **`.codex/.codex-workspace/`** に統一する
  - 既存の同期メタは **`.codex/.codex-sync/state.json`** から **`.codex/.codex-workspace/codex-sync.json`** へ移行する
- テンプレート基底フォルダは **`.codex/codex-templates` を継続利用**し、仕様変更しない
  - `.codex/codex-templates` は **ユーザーが編集する可能性のある領域**として扱う

## 🎭 ユースケース / ユーザーストーリー

- ユーザーは Agent Explorer で `.codex/agents` 配下の `*.toml` を一覧できる
- ユーザーは一覧から `*.toml` を選択し、内容を表示・編集できる
- ユーザーは Agent Explorer からエージェントを追加できる
  - 追加時にエージェント名を入力できる
  - テンプレートを適用するかどうかを選択できる（テンプレートがある場合）
- ユーザーはエージェントを追加すると、`config.toml` に `[agents.<agent>]` が自動で追記される
- ユーザーはエージェントを右クリックし、Enable/Disable を切り替えられる
- 既存ユーザーはアップデート後も同期機能が動作し、過去の同期状態が引き継がれる
- 既存ユーザーはアップデート後も `.codex/codex-templates` の運用を変更せずテンプレート選択が継続できる

## 🧩 機能要件

### 🧭 Agent Explorer

- 固定ルートとして `.codex/agents` を扱う
- `.codex/agents` 配下の `*.toml` を一覧表示する
- 一覧アイテムを選択すると、該当 `*.toml` をエディタで開き内容を表示する
- 以下の操作を提供する
  - 新規作成
  - リネーム
  - 削除
  - エディタで開く(選択時)
  - 同期
- アイコンは、有効時：images/agent_on.png、無効時：images/agent_off.pngを切り替え

### 🧩 エージェント追加フロー

- 追加操作は以下のウィザードフローとする
  1. エージェント名入力（例：`reviewer-security`）
  2. 説明を入力
  3. テンプレート選択
     - テンプレートを適用しない選択肢を含む（「空のファイル」を表示）
     - テンプレートが存在する場合、テンプレート選択を提示する
- 作成ファイルは `.codex/agents/<agent>.toml` とする
- 既に `.codex/agents/<agent>.toml` が存在する場合は作成を中断し、衝突を通知する

### 🧩 `config.toml` への role 定義の自動追記

- `.codex/agents/<agent>.toml` 作成成功後、`config.toml` に `[agents.<agent>]` を追記する
- 追記する最小構成は以下とする
  - `description` (追加時に入れたもの、空文字許可)
  - `config_file = "agents/<agent>.toml"`
- 既に `[agents.<agent>]` が存在する場合は上書きしない
  - 自動追記は行わず通知する

### 🧩 エージェント編集フロー

- 編集操作は以下のウィザードフローとする
  1. エージェント名を編集
  2. 説明を編集

### 🧩 エージェント削除フロー

  1. Agent Explorerでエージェントを選択
  2. 削除ボタンを押下
  3. 削除確認メッセージを表示
  4. OKボタンが押下されたら、エージェントファイルを物理削除し、Agent Explorerを更新

### 🧩 エージェントファイルの同期フロー

- 他のExploreと同じように、`agents/` 配下のファイルを設定値で指定したフォルダと同期することができる。
- 同期先フォルダ設定（既定値はブランク）を追加する。
  - `agentFolder`
- Agent Explorer に同期ボタン（codicon: `sync`）を追加する。
  - 同期先フォルダが未設定の場合は同期ボタンを非表示にする。
  - 同期時は確認メッセージを表示し、OK の場合のみ相互同期を実行する。
  - 同名ファイルは最終更新日時が新しい方を正として古い方を上書きする。
  - いずれかで削除されたファイルは両方から削除する。
  - 削除同期の判定に必要なメタ情報は `.codex/.codex-workspace/codex-sync.json` に保存し、削除が両方に反映された時点で削除する。
  - `.codex/.codex-workspace` は隠しフォルダとする。
  - 隠しフォルダ/隠しファイルは同期対象外とする。
  - 上書き中にエラーが発生した場合は該当ファイルのみスキップし、簡易ダイアログで通知する。

### 🧩 エージェント有効/無効の切り替え

- Agent Explorer のコンテキストメニューに以下を追加する
  - `Agentを有効化`
  - `Agentを無効化`
- 有効/無効の実体は `config.toml` の `[agents.<agent>]` の有無で表現する
  - Enable は `[agents.<agent>]` を追加する
  - Disable は `[agents.<agent>]` を削除する
- Disable 実行時、削除するブロック（コメント含む）を退避する
  - 退避先は `.codex/.codex-workspace/agents-disabled.json` とする
- Enable 実行時、退避がある場合は退避内容を復元する
  - 退避がない場合は最小構成ブロックを追加する
- 変更後は「再起動が必要」通知を表示する

#### 🗂️ `agents-disabled.json` 仕様

- 退避データはエージェント名をキーとする辞書構造で保持する
- 退避内容は `[agents.<agent>]` ブロックの生テキストを保持する（コメント含む）
- 例

```json
{
  "version": 1,
  "disabledAgents": {
    "reviewer_security": {
      "disabledAt": "2026-02-22T12:34:56+09:00",
      "source": "config.toml",
      "block": "[agents.reviewer_security]\ndescription = \"...\"\nconfig_file = \"agents/reviewer_security.toml\"\n"
    }
  }
}
```

### 🧩 拡張機能メタファイル配置の統一

- 拡張機能が作成するメタファイルの固定ルートを `.codex/.codex-workspace/` とする
- `.codex/.codex-workspace/` は拡張機能の管理領域として扱う

### 🔁 同期メタの保存先変更とマイグレーション

- 新保存先は `.codex/.codex-workspace/codex-sync.json` とする
- 旧保存先 `.codex/.codex-sync/state.json` からの互換読み取りを行う
- 読み込み優先順は以下とする
  - `.codex/.codex-workspace/codex-sync.json`
  - `.codex/.codex-sync/state.json`
- 新が存在せず旧が存在する場合、旧の内容を新へ移行する
- 移行は原子的に行い（テンポラリファイル→リネーム）、新の再読み込みで正当性を確認する
- 移行が成功した場合、旧 `state.json` は自動削除する
- 移行に失敗した場合、旧は保持し、処理を中断してエラー通知する

### 🗂️ テンプレートの扱い

- テンプレートの基底フォルダは **`.codex/codex-templates` を継続利用**する
- `.codex/codex-templates` は **ユーザーが編集する可能性のある領域**として扱う
- 拡張機能は `.codex/codex-templates` に対して **自動移動・自動削除を行わない**
- `.codex/.codex-workspace/` は拡張機能が管理するメタ領域であり、テンプレートの基底フォルダとしては使用しない
- テンプレートに関するマイグレーション処理は実施しない

## 🛡️ 非機能要件

- 変更なし

## 🔒 制約事項

- 変更なし