# 🧾`CORE-001 Codex Core Explorer表示`

## 🎯背景/目的

- `config.toml` と `AGENT.md` をすぐ開ける導線を提供し、日常的な編集作業の入口を整える。

## 📌要件

- 5.1
- 5.2

## 🛠️スコープ / 作業内容

- `package.json` の `contributes.viewsContainers`/`contributes.views` を拡張して Core を表示する
- `src/extension.ts` から Core 用の TreeDataProvider を登録する（例: `src/views/coreView.ts`）
- Core に `config.toml` / `AGENT.md` を表示し、クリックでエディタを開く
- UI/イベント/保存先: Tree クリックでファイルを開く（保存先: `~/.codex/config.toml`, `~/.codex/AGENT.md`）
- 参照: `docs/01_requirements.md`, `docs/02_architect.md`

## ✅AC（受け入れ基準）

- [ ] [UI/UX] アクティビティバーに Codex Workspace の View Container が表示される
- [ ] [機能] Core の `config.toml` と `AGENT.md` をクリックするとエディタで開ける
- [ ] [状態/エラー] 利用不可時は Core でもエラーノードのみが表示される
- [ ] [テスト] Core アイテムが正しいパスで開かれることをテストで確認できる

## 🔗依存関係

- DependsOn: #1

## 🧪テスト観点

- (統合)
- 検証方法：`npm test` で Core 表示とファイルオープンの検証を行う

