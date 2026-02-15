# 🧾 仕様変更 実装計画

## 🧩 目的

- Codex CLI の会話履歴（`$CODEX_HOME/sessions/.../rollout-*.jsonl`）を読み取り、エディタ領域の WebView で閲覧できる履歴機能を追加する。
- 既存 Explorer 機能へ副作用を与えず、履歴機能を独立して追加する。

## 🔍 変更要件整理

- Codex Core の上部に履歴ボタン（codicon: `history`）を追加する。
- コマンドパレットから会話履歴ビューを起動できるコマンドを追加する。
- 履歴ビューは WebviewPanel でエディタ領域に表示し、単一インスタンスで再利用する。
- `$CODEX_HOME/sessions/年/月/日/rollout-*.jsonl` を読み、新形式イベントを 1 タスク単位で抽出する。
  - タスク開始：`type:"event_msg"` かつ `payload.type:"task_started"`
  - タスク完了：`type:"event_msg"` かつ `payload.type:"task_complete"`
  - ユーザー：`type:"event_msg"` かつ `payload.type:"user_message"`（最初の 1 件）
  - AI回答：`type:"event_msg"` かつ `payload.type:"agent_message"`（複数）
  - 思考過程：`type:"response_item"` かつ `payload.type:"reasoning"`（複数）
- 左ペインは日付フォルダ（`yyyy/mm/dd`）とタスクカードを新しい順で表示する。
- タスクカードはユーザーメッセージ全文を検索対象とし、表示は最大 100 文字で省略する。
- 右ペインはユーザーメッセージ全文と、AI回答/思考過程を同一タイムラインで時系列表示する。
- 検索は大文字小文字区別なし部分一致で、入力時または Enter で実行し、クリアで解除する。
- `maxHistoryCount` は明示設定時のみ適用し、全体新着順の先頭 N タスクだけを表示する（未設定時は全件）。
- `incrudeReasoningMessage` が `false` の場合、思考過程を表示しない。
- 既存機能（Prompts/Skills/Templates/MCP/Core の既存挙動）に影響を与えない。

## 🛠️ 実装タスク

- 履歴ビュー起動コマンド登録、Codex Core の履歴ボタン追加、WebviewPanel 単一インスタンス制御。
- セッション履歴の走査・解析サービス実装（新形式イベント抽出、task 境界管理、turn_id フォールバック、末尾確定）。
- 履歴 WebView UI 実装（上部検索 + 下部 2 ペイン、日付フォルダ、カード一覧、会話プレビュー、コピー、折りたたみ）。
- WebView と拡張ホスト間のメッセージング実装（初期データ、タスク選択、検索実行、クリア、コピー）。
- 設定値反映実装（`maxHistoryCount`、`incrudeReasoningMessage`）。
- 仕様準拠テスト追加（単一インスタンス、抽出対象、検索一致、時系列表示、設定反映、既存機能非回帰）。

## 🧾 Issue 一覧

- HIST-001: 履歴ビュー起動導線と単一インスタンス制御
- HIST-002: rollout JSONL 解析と履歴インデックス生成
- HIST-003: 履歴 WebView UI（2ペイン/検索/プレビュー）実装
- TEST-001: 会話履歴機能のテスト追加

## ✅ 受け入れ基準

- Codex Core の履歴ボタンとコマンドパレットから同一の履歴ビューを開ける。
- 履歴ビューは WebviewPanel でエディタ領域に表示され、再実行時は既存ビューを前面化する。
- 左ペインは日付フォルダ（`yyyy/mm/dd`）とタスクカードを新しい順で表示する。
- タスクは `task_started`〜`task_complete` の同一 `turn_id` 区間で抽出される。
- 右ペインはユーザーメッセージ全文と、AI回答/思考過程を時系列表示する。
- 検索はユーザーメッセージ全文への部分一致で絞り込み、入力時または Enter で反映される。
- 検索一致語は VS Code テーマ色に追従してハイライトされ、クリアで解除できる。
- `maxHistoryCount` は明示設定時のみ表示件数制限に反映される。
- `incrudeReasoningMessage=false` の場合、思考過程は表示されない。
- 既存 Explorer 機能と同期機能の既存挙動に回帰がない。
