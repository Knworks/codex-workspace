---
id: `HIST-002`
title: `rollout JSONL解析と履歴インデックス生成`
status: Done
---

# 🧾`HIST-002 rollout JSONL解析と履歴インデックス生成`

## 🎯背景/目的

- 履歴ビューで必要な情報だけを安全に抽出し、日付フォルダとタスクカードへ一貫したデータを供給する。

## 📌要件

- データソースは `$CODEX_HOME/sessions/.../rollout-*.jsonl` のみを使用する。
- 新形式イベントから `task_started`〜`task_complete` の同一 `turn_id` を 1 タスクとして抽出する。
- 1 タスク内で `user_message`（最初の 1 件）、`agent_message`（複数）、`response_item.reasoning`（複数）を取得する。
- 全体新着順ソートと、日付キー（`yyyy/mm/dd`）単位の表示インデックスを提供する。

## 🛠️スコープ / 作業内容

- セッションディレクトリ走査と `rollout-*.jsonl` 収集処理を実装する。
- イベント抽出器を実装し、`task_started/task_complete` 境界でタスクを確定する。
- `turn_id` 欠落イベントは `turn_context.turn_id` または単一アクティブタスクへフォールバックして紐づける。
- ローカル時刻 `[H:mm:ss]` 変換、AIタイムライン（assistant/reasoning）生成、日付キー単位のインデックス構築を実装する。

## ✅AC（受け入れ基準）

- AC：必要十分な項目数（最低3、目安5〜10、上限なし）
  - [x] [機能] `$CODEX_HOME/sessions/年/月/日/rollout-*.jsonl` を走査してタスク一覧を生成できる
  - [x] [機能] `task_started`〜`task_complete` の同一 `turn_id` で 1 タスクが構築される
  - [x] [機能] 1 タスク内で `user_message`（最初の 1 件）、`agent_message`（複数）、`response_item.reasoning`（複数）を抽出できる
  - [x] [機能] `task_complete` が欠落する場合でも、ファイル末尾でアクティブタスクを確定できる
  - [x] [UI/UX] カード時刻と各メッセージ時刻がローカル時刻 `[H:mm:ss]` で提供される
  - [x] [テスト] 抽出対象限定、turn_id フォールバック、ソート、日付インデックス生成のユニットテストが追加される

## 🔗依存関係

- DependsOn: HIST-001

## 🧪テスト観点

- ユニット / リクエスト
- 検証方法：
  - サンプル JSONL 入力から抽出結果・task 境界・ソート順・除外イベントを検証する
