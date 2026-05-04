---
id: `TEST-001`
title: `仕様変更回帰テストと品質確認`
status: Reviewing
---

# 🧾 TEST-001 仕様変更回帰テストと品質確認

## 🎯 背景/目的

- 大きな仕様変更による既存 Explorer の破壊を防ぎ、変更仕様の主要動作を自動テストで保証する。

## 📌 要件

- 変更仕様のテスト観点を網羅する。
- AGENTS Loading Chain の診断ビュー再設計とローカライズを回帰対象に含める。
- Feature Flags タブと Hooks タブの表示、更新、ローカライズを回帰対象に含める。
- `config.toml` 整理コマンドの集約ルールとバックアップ動作を回帰対象に含める。
- PROMPTS Explore と Template Explore は現行仕様を維持する。
- ビルド、セルフチェック、単体テストを完了する。

## 🛠️ スコープ / 作業内容

- 不足している単体テストと回帰テストを追加する。
- AGENTS Loading Chain の表示変換、詳細候補トグル、ローカライズ文字列利用を確認する。
- Feature Flags の一覧生成、設定更新、Hooks 連動更新を確認する。
- Hooks の source 一覧、source 切替、warning、source file 作成導線を確認する。
- `config.toml` 整理時のクラスタ集約、`mcp_servers.<id>.env` の親直後配置、バックアップ更新を確認する。
- PROMPTS / Template に新機能が混入していないことを確認する。
- `npm run compile` と `npm test` を実行する。
- セルフチェックで差分を確認する。

## ✅ AC（受け入れ基準）

- [x] [テスト] 仕様変更の主要テスト観点が自動テストで検証されている。
- [x] [機能] PROMPTS Explore と Template Explore の現行仕様が維持されている。
- [x] [状態/エラー] `config.toml` 不正時の許可操作と無効操作が仕様通りに分離されている。
- [x] [テスト] `npm run compile` が成功する。
- [x] [テスト] `npm test` が成功する、または環境依存の失敗理由が明確である。

## 🔗 依存関係

- DependsOn: #3, #5, #7, #8

## 🧪 テスト観点

- 変更仕様全体の未検証箇所。
- AGENTS Loading Chain の `使用中` / `未使用` / `問題あり` / `候補なし` 表示。
- `候補なし` の既定非表示と詳細候補トグル。
- 日本語と英語での表示差し替え。
- Feature Flags の description / maturity / default / effective / configured 表示。
- Feature Flags トグル更新と `codex_hooks` 変更時の Hooks タブ同期。
- Hooks source の active/inactive 判定、source 選択時の entry 切替、warning 表示。
- `hooks.json` / `config.toml` の作成導線と open 導線。
- `Codex Workspace: Organize config.toml` 実行時のセクション集約結果と `.codex/.codex-workspace/config.toml.bk` 更新。
- 既存仕様維持。
- ビルドとテスト実行結果。
- 検証方法: `npm run compile`、`npm test`。
