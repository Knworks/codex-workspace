---
id: `AGENT-001`
title: `AGENTS 複数保存場所 Explorer`
status: Reviewing
---

# 🧾 AGENT-001 AGENTS 複数保存場所 Explorer

## 🎯 背景/目的

- AGENTS Explorer を AGENTS 系 Markdown ではなく、サブエージェント定義ファイル専用として整理する。

## 📌 要件

- Project / Workspace / User Agents を単一一覧として表示する。
- `AGENTS.md` と `AGENTS.override.md` は Core Explorer で扱い、AGENTS Explorer では扱わない。
- ON/OFF 操作は AGENTS Manager View へ移す。

## 🛠️ スコープ / 作業内容

- Agents 保存場所解決サービスを追加する。
- AGENTS Explorer の一覧を複数保存場所対応にする。
- AGENTS Explorer から ON/OFF コンテキストトグルを外す。
- 追加、リネーム、削除、フォルダを開くを保存場所対応にする。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] `AGENTS.md` と `AGENTS.override.md` は AGENTS Explorer に表示されない。
- [x] [機能] 3種類の Agents 保存場所を優先度順、同一保存場所内はファイル名昇順で表示できる。
- [x] [UI/UX] 保存場所種別と絶対パスをアイコンまたはツールチップで識別できる。
- [x] [状態/エラー] User Agents 削除時に他プロジェクト影響の警告を表示する。
- [x] [テスト] 複数保存場所検出、対象除外、保存場所別操作をテストする。

## 🔗 依存関係

- DependsOn: #1

## 🧪 テスト観点

- 保存場所検出と重複実体の扱い。
- `*.toml` のみ対象であること。
- Explorer に ON/OFF 操作が残っていないこと。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
