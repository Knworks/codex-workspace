---
id: `CORE-002`
title: `Core View 診断タブと信頼ディレクトリ`
status: Reviewing
---

# 🧾 CORE-002 Core View 診断タブと信頼ディレクトリ

## 🎯 背景/目的

- Core View に診断と信頼ディレクトリ管理を追加し、Codex の読み込み状態と信頼設定を把握しやすくする。

## 📌 要件

- AGENTS Loading Chain は Codex Workspace による推定結果として表示する。
- AGENTS Loading Chain は候補列挙ではなく、現在有効なファイル、無視された候補、要確認項目を中心に表示する。
- 存在しない候補は既定で非表示とし、詳細候補トグルで表示できるようにする。
- AGENTS Loading Chain の文言は日本語と英語でローカライズする。
- 信頼するディレクトリは `trust_level = "trusted"` のみ一覧対象とする。
- タブごとの Refresh は現在タブのみ再読み込みする。

## 🛠️ スコープ / 作業内容

- AGENTS Loading Chain 推定サービスを追加する。
- Core View に AGENTS Loading Chain タブを追加する。
- AGENTS Loading Chain 左ペインを `現在有効` / `無視された候補` / `要確認` / `詳細候補` の診断表示へ整理する。
- AGENTS Loading Chain 右ペインを、理由が分かる説明中心の詳細表示へ変更する。
- AGENTS Loading Chain の表示文言を `package.nls.json` / `package.nls.ja.json` で管理する。
- 信頼するディレクトリの一覧、追加、削除を実装する。
- `config.toml` 不正時の表示と操作制限を実装する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] ワークスペースルート基準で、現在有効なファイル、無視された候補、要確認項目を診断表示できる。
- [x] [UI/UX] `候補なし` は既定で非表示で、詳細候補トグルをONにした場合のみ表示できる。
- [x] [UI/UX] 状態を色だけでなくバッジ、文字、トーン差で識別できる。
- [x] [多言語] AGENTS Loading Chain の主要文言が日本語と英語でローカライズされている。
- [x] [機能] trusted な `[projects."<path>"]` のみを一覧表示できる。
- [x] [状態/エラー] `config.toml` 不正時は信頼ディレクトリの追加削除を無効化し、エラー内容を表示する。
- [x] [テスト] Loading Chain 判定、信頼ディレクトリ追加削除、タブ Refresh をテストする。

## 🔗 依存関係

- DependsOn: #1

## 🧪 テスト観点

- Global / Project / Standard / Override / Fallback の候補判定。
- `使用中` / `未使用` / `問題あり` / `候補なし` の表示変換。
- `候補なし` の既定非表示と詳細候補トグル。
- 日本語と英語での表示文言。
- trusted project の追加、更新、削除。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
