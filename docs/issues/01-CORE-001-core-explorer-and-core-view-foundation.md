---
id: `CORE-001`
title: `Codex Core Explorer と Core View 基盤`
status: Reviewing
---

# 🧾 CORE-001 Codex Core Explorer と Core View 基盤

## 🎯 背景/目的

- Codex Core の操作は `config.toml` が壊れている場合でも修正導線を維持する必要がある。
- 既存の会話履歴画面を Core View の初期タブへ移し、後続タブ追加の基盤を作る。

## 📌 要件

- `docs/specification-changes.md` の Codex Core Explore / Codex Core View。
- `config.toml` が TOML として不正でも、Core ファイル、Core View、Core Sync は利用可能にする。
- Core同期対象に `AGENTS.override.md` を含める。

## 🛠️ スコープ / 作業内容

- Core Explorer に `AGENTS.override.md` を存在時のみ表示する。
- Core Explorer 専用に、`config.toml` 不正時でも表示できる状態判定を追加する。
- `config.toml` 不正時は `config.toml` アイテムに警告を表示する。
- `codex-workspace.openHistoryView` の導線を Core View 起動へ置き換え、Core View 初期タブに既存履歴 UI を表示する。
- Core同期対象を `.codex/config.toml`、`.codex/AGENTS.md`、`.codex/AGENTS.override.md` にする。
- 関連テストを更新する。

## ✅ AC（受け入れ基準）

- [x] [機能] `config.toml`、`AGENTS.md`、存在する `AGENTS.override.md` を Core Explorer に表示できる。
- [x] [状態/エラー] `config.toml` が TOML として不正でも Core ファイル、Core View、Core Sync は利用できる。
- [x] [UI/UX] `config.toml` 不正時は Core Explorer 上で警告アイコンまたは警告ツールチップを表示する。
- [x] [機能] Codex Core View は単一 WebviewPanel として開き、初期タブに会話履歴を表示する。
- [x] [テスト] Core Explorer、状態判定、Core同期対象の単体テストを更新する。

## 🔗 依存関係

- DependsOn: なし

## 🧪 テスト観点

- Core Explorer の表示項目。
- TOML parse 失敗時の Core 操作許可。
- Core Sync の対象ファイル。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
