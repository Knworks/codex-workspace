# 🧾 仕様変更 実装計画

## 🧩 目的

- Agent Explorer とエージェント有効/無効管理を追加し、`.codex/agents` と `config.toml` を一貫して運用できるようにする。
- 拡張機能メタファイル配置を `.codex/.codex-workspace/` に統一し、同期メタ保存先変更を既存ユーザー互換を保って実施する。

## 🔍 変更要件整理

- Agent Explorer を追加し、固定ルート `.codex/agents` 配下の `*.toml` を一覧・編集可能にする。
- Agent ファイル同期フローを追加し、`.codex/agents` と `agentFolder` の相互同期を可能にする。
- エージェント追加時に名前入力・説明入力・テンプレート選択（空ファイル含む）を提供する。
- エージェント追加成功時に `config.toml` へ `[agents.<agent>]` を自動追記する。
- エージェント有効/無効はコンテキストメニューで切り替え、`[agents.<agent>]` の追加/削除で実現する。
- 無効化時は削除ブロックを `.codex/.codex-workspace/agents-disabled.json` へ退避し、有効化時は復元する。
- 拡張機能メタの固定ルートを `.codex/.codex-workspace/` に統一する。
- 同期メタ保存先を `.codex/.codex-sync/state.json` から `.codex/.codex-workspace/codex-sync.json` へ変更し、互換読み取りと原子的移行を実施する。
- テンプレート基底フォルダは `.codex/codex-templates` を継続利用し、自動移動・自動削除・テンプレート移行は行わない。

## 🛠️ 実装タスク

- Agent Explorer の TreeDataProvider / コマンド / アイコン切替（`agent_on.png` / `agent_off.png`）を追加する。
- Agent 追加・編集・削除のウィザードフローを実装する。
- Agent 追加時の `config.toml` 追記処理（重複時は非上書き）を実装する。
- Agent 有効化/無効化時の `config.toml` ブロック操作と再起動通知を実装する。
- `agents-disabled.json` の退避/復元ロジック（コメント保持）を実装する。
- 同期メタ保存先を `.codex/.codex-workspace/codex-sync.json` に切り替える。
- 旧 `.codex/.codex-sync/state.json` から新保存先への原子的移行処理を追加する。
- `agentFolder` 設定追加、Agent Explorer 同期ボタン表示条件、同期実行処理を実装する。
- テンプレート機能が `.codex/codex-templates` 継続利用となることを保証し、関連処理がメタ領域へ誤移行しないことを確認する。
- ユニット/統合テストを追加する。

## 🧾 Issue 一覧

- AGENT-001: Agent Explorer 基盤（一覧・ファイル操作・アイコン）
- AGENT-002: Agent 追加/編集/削除フローと `config.toml` 自動追記
- AGENT-003: Agent 有効化/無効化と `agents-disabled.json` 退避復元
- META-001: メタファイル配置統一と同期メタ移行
- SYNC-001: Agent ファイル同期フロー（設定/ボタン/相互同期）
- TEST-001: 仕様変更分のテスト追加

## ✅ 受け入れ基準

- Agent Explorer に `.codex/agents` 配下の `*.toml` が表示され、選択でエディタ表示できる。
- Agent 追加時に名前・説明・テンプレート選択の順で入力でき、テンプレート未適用（空ファイル）を選択できる。
- `.codex/agents/<agent>.toml` の作成成功時に `config.toml` へ `[agents.<agent>]` が自動追記される。
- 既存の `[agents.<agent>]` がある場合は上書きせず、通知して処理を継続する。
- Agent 無効化時に `[agents.<agent>]` が削除され、削除ブロック（コメント含む）が `.codex/.codex-workspace/agents-disabled.json` に退避される。
- Agent 有効化時に退避データがあれば復元され、退避データがない場合は最小構成ブロックが追加される。
- Agent 有効/無効切替後に再起動が必要な旨の通知が表示される。
- `agentFolder` 設定が追加され、未設定時は Agent Explorer の同期ボタンが非表示になる。
- Agent Explorer の同期ボタン押下時、確認後に `.codex/agents` と `agentFolder` が相互同期される。
- Agent 同期でも同名ファイルは新しい最終更新日時を正として上書きされる。
- Agent 同期でも削除同期が有効で、判定メタが `.codex/.codex-workspace/codex-sync.json` で管理される。
- 同期メタの保存先が `.codex/.codex-workspace/codex-sync.json` に変更される。
- 新保存先が無く旧保存先がある場合、旧から新へ原子的に移行し、成功時に旧 `state.json` が削除される。
- 移行失敗時は旧保存先を保持して中断し、エラー通知される。
- テンプレート機能は `.codex/codex-templates` を継続利用し、メタ領域への自動移動/削除が行われない。
- 追加仕様に対応するユニット/統合テストが追加される。
