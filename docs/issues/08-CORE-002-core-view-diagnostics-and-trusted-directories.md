---
id: `CORE-002`
title: `Core View 診断タブと信頼ディレクトリ`
status: Todo
---

# 🧾 CORE-002 Core View 診断タブと信頼ディレクトリ

## 🎯 背景/目的

- Core View に診断と信頼ディレクトリ管理を追加し、Codex の読み込み状態と信頼設定を把握しやすくする。

## 📌 要件

- AGENTS Loading Chain は Codex Workspace による推定結果として表示する。
- 信頼するディレクトリは `trust_level = "trusted"` のみ一覧対象とする。
- タブごとの Refresh は現在タブのみ再読み込みする。

## 🛠️ スコープ / 作業内容

- AGENTS Loading Chain 推定サービスを追加する。
- Core View に AGENTS Loading Chain タブを追加する。
- 信頼するディレクトリの一覧、追加、削除を実装する。
- `config.toml` 不正時の表示と操作制限を実装する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [ ] [機能] ワークスペースルート基準で Active / Skipped / Missing / Error のチェーンを表示できる。
- [ ] [UI/UX] 状態を色だけでなくバッジ、文字、トーン差で識別できる。
- [ ] [機能] trusted な `[projects."<path>"]` のみを一覧表示できる。
- [ ] [状態/エラー] `config.toml` 不正時は信頼ディレクトリの追加削除を無効化し、エラー内容を表示する。
- [ ] [テスト] Loading Chain 判定、信頼ディレクトリ追加削除、タブ Refresh をテストする。

## 🔗 依存関係

- DependsOn: #1

## 🧪 テスト観点

- Global / Project / Standard / Override / Fallback の候補判定。
- Missing と Error の表示。
- trusted project の追加、更新、削除。
- 検証方法: `npm run compile`、関連テスト、`npm test`。

