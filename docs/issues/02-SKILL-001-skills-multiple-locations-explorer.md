---
id: `SKILL-001`
title: `Skills 複数保存場所 Explorer`
status: Reviewing
---

# 🧾 SKILL-001 Skills 複数保存場所 Explorer

## 🎯 背景/目的

- Codex CLI の利用実態に合わせ、Skills を Project / Workspace / User の複数保存場所から扱えるようにする。

## 📌 要件

- Skills Explore は複数保存場所を単一一覧として表示する。
- `System Skills` として `$HOME/.codex/skills/.system` も表示対象に含める。
- Project Skills は `project/.agents/skills` を優先し、存在しない場合のみ `project/.codex/skills` を読む。
- Project Skills の新規追加先は常に `project/.agents/skills` とする。
- 作成、リネーム、削除、フォルダを開く操作は実体パスに対して行う。
- 同期は既存互換のため Workspace Skills のみを対象に維持する。

## 🛠️ スコープ / 作業内容

- Skill 保存場所解決サービスを追加する。
- Skills Explorer の一覧を複数保存場所対応にする。
- 追加、リネーム、削除、フォルダを開くを保存場所対応にする。
- User Skills 削除時に影響警告を表示する。
- 関連テストを追加する。

## ✅ AC（受け入れ基準）

- [x] [機能] Project / Workspace / User / System の 4 種類の Skill 保存場所を優先度順、同一保存場所内は名称昇順で表示できる。
- [x] [UI/UX] 保存場所種別と絶対パスをアイコンまたはツールチップで識別できる。
- [x] [機能] Skills ルートからの新規ファイル・フォルダ作成時に保存場所を選択でき、Project Skills 選択時の作成先は常に `project/.agents/skills` になり、System Skills は作成先選択肢に含まれない。
- [x] [状態/エラー] User Skills 削除時に他プロジェクト影響の警告を表示する。
- [x] [テスト] 保存場所検出、作成先選択、同期対象維持をテストする。

## 🔗 依存関係

- DependsOn: #1

## 🧪 テスト観点

- 複数保存場所の検出、並び順、同名表示。
- 作成先選択と既存互換の初期候補。
- 同期対象が Workspace Skills のままであること。
- 検証方法: `npm run compile`、関連テスト、`npm test`。
