---
id: `AGENT-001`
title: `Agent Explorer基盤実装`
status: Todo
---

# 🧾`AGENT-001 Agent Explorer基盤実装`

## 🎯背景/目的

- `.codex/agents` をVS Code上で一元的に扱えるようにし、エージェント定義ファイルの可視性と運用性を確保する。

## 📌要件

- Agent Explorer を追加し、固定ルート `.codex/agents` 配下の `*.toml` を一覧表示する。
- 一覧選択時に該当 `*.toml` をエディタで開ける。
- Agent状態に応じて `agent_on.png` / `agent_off.png` を表示する。

## 🛠️スコープ / 作業内容

- Agent Explorer 用 TreeDataProvider を実装する。
- `.codex/agents` の存在確認と列挙処理（`*.toml` フィルタ）を実装する。
- Agentノードのアイコン判定ロジック（有効/無効）を実装する。
- Refresh時にAgent Explorerも更新対象へ含める。

## ✅AC（受け入れ基準）

- AC：必要十分な項目数（最低3、目安5〜10、上限なし）
  - [ ] [機能] Agent Explorerに`.codex/agents`配下の`*.toml`のみが表示される
  - [ ] [機能] Agentノード選択で対象ファイルがエディタ表示される
  - [ ] [UI/UX] 有効時`agent_on.png`、無効時`agent_off.png`が表示される
  - [ ] [機能] Refresh実行でAgent Explorerを含む全ビューが更新される
  - [ ] [テスト] Agent一覧取得とフィルタ条件のテストが追加される

## 🔗依存関係

- DependsOn: なし

## 🧪テスト観点

- (ユニット / 統合)
- 検証方法：
  - TreeDataProviderの列挙結果、拡張子フィルタ、クリック時のエディタオープンを確認する。
