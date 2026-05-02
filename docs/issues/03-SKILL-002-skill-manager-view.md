---
id: `SKILL-002`
title: `Skill Manager View`
status: Reviewing
---

# 🧾 SKILL-002 Skill Manager View

## 🎯 背景/目的

- Skill の一覧確認、検索、有効無効切替を Explorer 操作から分離し、管理画面で扱えるようにする。

## 📌 要件

- Skill Manager View は単一 WebviewPanel とする。
- 一覧、検索、開く、ON/OFF トグルのみを初期リリースで提供する。
- 有効無効は `config.toml` の `[[skills.config]]` へ反映する。

## 🛠️ スコープ / 作業内容

- `SKILL.md` frontmatter の name / description 抽出を実装する。
- Skill Manager View と Webview メッセージ処理を追加する。
- 検索、開く、ON/OFF トグルを実装する。
- `[[skills.config]]` の追加と既存 `enabled` 更新を実装する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] Skill名、説明、ファイルパス、有効状態を一覧表示できる。
- [x] [UI/UX] 検索文字列で Skill名、説明、ファイルパスを部分一致絞り込みできる。
- [x] [機能] 開く操作で対象 `SKILL.md` をエディタで開ける。
- [x] [状態/エラー] トグル操作後に `config.toml` と Skills Explorer / Manager View が更新される。
- [x] [テスト] `[[skills.config]]` の追加、既存 `enabled` 更新、検索をテストする。

## 🔗 依存関係

- DependsOn: #2

## 🧪 テスト観点

- `SKILL.md` metadata 抽出。
- `[[skills.config]]` の新規追加と既存更新。
- 検索と開く操作。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
