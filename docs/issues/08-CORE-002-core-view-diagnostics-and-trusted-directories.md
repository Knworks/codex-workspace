---
id: `CORE-002`
title: `Core View 診断タブと信頼ディレクトリ`
status: Reviewing
---

# 🧾 CORE-002 Core View 診断タブと信頼ディレクトリ

## 🎯 背景/目的

- Core View に診断と信頼ディレクトリ管理を追加し、Codex の読み込み状態、feature flag 設定、hooks source 状態、信頼設定を把握しやすくする。

## 📌 要件

- AGENTS Loading Chain は Codex Workspace による推定結果として表示する。
- AGENTS Loading Chain は候補列挙ではなく、現在有効なファイル、無視された候補、要確認項目を中心に表示する。
- 存在しない候補は既定で非表示とし、詳細候補トグルで表示できるようにする。
- AGENTS Loading Chain の文言は日本語と英語でローカライズする。
- 信頼するディレクトリは `trust_level = "trusted"` のみ一覧対象とする。
- Feature Flags タブでは、主要な feature flag の説明、成熟度、既定値、現在値、設定有無を表示し、トグル変更できる。
- Hooks タブでは、Hooks機能状態、Project Hooks状態、source一覧、選択source配下のentry一覧、warning を表示する。
- Hooks タブの文言は日本語と英語でローカライズする。
- Hooks タブでは、存在する source の Open、存在しない `hooks.json` / `config.toml` の作成と Open を提供する。
- `Codex Workspace: Organize config.toml` コマンドでは、管理対象セクションを整理し、書き換え前に `.codex/.codex-workspace/config.toml.bk` を更新する。
- タブごとの Refresh は現在タブのみ再読み込みする。

## 🛠️ スコープ / 作業内容

- AGENTS Loading Chain 推定サービスを追加する。
- Core View に AGENTS Loading Chain タブを追加する。
- AGENTS Loading Chain 左ペインを `現在有効` / `無視された候補` / `要確認` / `詳細候補` の診断表示へ整理する。
- AGENTS Loading Chain 右ペインを、理由が分かる説明中心の詳細表示へ変更する。
- AGENTS Loading Chain の表示文言を `package.nls.json` / `package.nls.ja.json` で管理する。
- 信頼するディレクトリの一覧、追加、削除を実装する。
- Feature Flags 一覧モデルと更新処理を追加する。
- Core View に Feature Flags タブを追加する。
- Hooks source / entry 診断サービスを追加する。
- Core View に Hooks タブを追加し、左ペイン source 選択、右ペイン entry 表示を実装する。
- Hooks warning、source file Open、missing source 作成を実装する。
- `config.toml` 整理コマンド、バックアップ、同種セクション集約を実装する。
- `config.toml` 不正時の表示と操作制限を実装する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] ワークスペースルート基準で、現在有効なファイル、無視された候補、要確認項目を診断表示できる。
- [x] [UI/UX] `候補なし` は既定で非表示で、詳細候補トグルをONにした場合のみ表示できる。
- [x] [UI/UX] 状態を色だけでなくバッジ、文字、トーン差で識別できる。
- [x] [多言語] AGENTS Loading Chain の主要文言が日本語と英語でローカライズされている。
- [x] [機能] trusted な `[projects."<path>"]` のみを一覧表示できる。
- [x] [機能] Feature Flags タブで主要 feature flag の説明、成熟度、既定値、現在値、設定有無を表示できる。
- [x] [機能] Feature Flags タブで対応 flag をトグル変更すると `config.toml` の `[features]` が更新される。
- [x] [機能] Hooks タブで hooks 機能状態、Project Hooks状態、source一覧、選択source配下のentry一覧を表示できる。
- [x] [UI/UX] Hooks タブでは source ごとに entry を切り替えて確認でき、source がない場合は作成導線を表示できる。
- [x] [多言語] Hooks タブの主要文言と warning が日本語と英語でローカライズされている。
- [x] [機能] `Codex Workspace: Organize config.toml` で管理対象セクションを先頭出現位置ごとに集約できる。
- [x] [状態/エラー] 整理コマンド実行時は `.codex/.codex-workspace/config.toml.bk` を更新し、バックアップ失敗時は `config.toml` を書き換えない。
- [x] [状態/エラー] `config.toml` 不正時は信頼ディレクトリの追加削除を無効化し、エラー内容を表示する。
- [x] [テスト] Loading Chain 判定、信頼ディレクトリ追加削除、Feature Flags、Hooks、`config.toml` 整理、タブ Refresh をテストする。

## 🔗 依存関係

- DependsOn: #1

## 🧪 テスト観点

- Global / Project / Standard / Override / Fallback の候補判定。
- `使用中` / `未使用` / `問題あり` / `候補なし` の表示変換。
- `候補なし` の既定非表示と詳細候補トグル。
- 日本語と英語での表示文言。
- trusted project の追加、更新、削除。
- feature flag 一覧、既定値、現在値、トグル更新。
- hooks source の active/inactive 判定、entry 件数、source 選択切替。
- hooks warning の表示と source file 作成 / Open。
- `config.toml` 整理時のクラスタ集約、`mcp_servers.<id>.env` 親直後配置、バックアップ更新。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
