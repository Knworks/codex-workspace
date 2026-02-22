---
id: `SYNC-001`
title: `Agentファイル同期フロー実装`
status: Todo
---

# 🧾`SYNC-001 Agentファイル同期フロー実装`

## 🎯背景/目的

- Agentファイルを他Explorerと同等に同期できるようにし、運用時の編集経路差をなくす。

## 📌要件

- 同期先フォルダ設定 `agentFolder` を追加する（既定値はブランク）。
- Agent Explorer に同期ボタン（codicon: `sync`）を追加し、`agentFolder` 未設定時は非表示にする。
- `.codex/agents` と `agentFolder` の相互同期を実装し、既存同期仕様（更新日時優先・削除同期・隠し除外・エラースキップ）を適用する。

## 🛠️スコープ / 作業内容

- `package.json` の設定スキーマに `agentFolder` を追加する。
- Agent Explorer の view/title に同期ボタンと表示条件を追加する。
- Agent同期コマンドを実装し、確認ダイアログ後に相互同期を実行する。
- 同期メタ `.codex/.codex-workspace/codex-sync.json` を使った削除同期判定をAgent同期にも適用する。

## ✅AC（受け入れ基準）

- AC：必要十分な項目数（最低3、目安5〜10、上限なし）
  - [ ] [機能] `agentFolder` 設定が追加され、既定値が空文字になっている
  - [ ] [UI/UX] `agentFolder` 未設定時に Agent Explorer の同期ボタンが表示されない
  - [ ] [機能] `agentFolder` 設定時に Agent Explorer の同期ボタンから同期処理を実行できる
  - [ ] [機能] Agent同期で同名ファイルは最終更新日時が新しい側を正として上書きされる
  - [ ] [機能] Agent同期で削除同期が行われ、判定メタが `codex-sync.json` で管理される
  - [ ] [状態/エラー] 上書き中エラーは該当ファイルのみスキップされ、通知される
  - [ ] [テスト] Agent同期の表示条件・同期処理・削除同期のテストが追加される

## 🔗依存関係

- DependsOn: AGENT-001, META-001

## 🧪テスト観点

- (ユニット / 統合)
- 検証方法：
  - `agentFolder` 空/非空でのボタン表示、同期結果、削除同期メタ更新を確認する。
