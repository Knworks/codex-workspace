---
id: `AGENT-002`
title: `AGENTS Manager View と ON/OFF 管理`
status: Reviewing
---

# 🧾 AGENT-002 AGENTS Manager View と ON/OFF 管理

## 🎯 背景/目的

- サブエージェントの詳細確認と有効無効切替を、一覧性の高い管理画面で扱えるようにする。

## 📌 要件

- AGENTS Manager View は単一 WebviewPanel とする。
- ON/OFF は `[agents.<name>]` の有無で表現し、`enabled` は追加しない。
- OFF 時は `agents-disabled.json` へ退避し、ON 時は復元する。

## 🛠️ スコープ / 作業内容

- `[agents.<name>]` と `config_file` 先 TOML から表示情報を組み立てる。
- AGENTS Manager View と Webview メッセージ処理を追加する。
- 検索、開く、ON/OFF トグルを実装する。
- 退避復元と同名上書き時の通知を実装する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] 名前、説明、モデル、推論の深さ、サンドボックスモード、ON/OFF を一覧表示できる。
- [x] [UI/UX] 未指定項目は `継承` と表示し、OFF の項目は暗いトーンで表示する。
- [x] [機能] OFF 操作で `[agents.<name>]` を退避して `config.toml` から削除できる。
- [x] [機能] ON 操作で退避定義を復元し、同名定義がある場合は退避済み定義で上書きできる。
- [x] [テスト] OFF、ON、復元上書き、`config_file` 解決をテストする。

## 🔗 依存関係

- DependsOn: #4

## 🧪 テスト観点

- ON/OFF 判定。
- 退避、復元、上書き。
- `config_file` の相対解決と存在しない場合のエラー。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
