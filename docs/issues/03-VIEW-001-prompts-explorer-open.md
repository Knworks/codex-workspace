# 🧾`VIEW-001 Prompts Explorer表示とファイルオープン`

## 🎯背景/目的

- Prompts のファイル/フォルダを VS Code 上で直接確認し、ファイルを素早く開けるようにする。

## 📌要件

- 5.1
- 5.5.3

## 🛠️スコープ / 作業内容

- Prompts Explorer を追加し、固定ルート `prompts` を表示する
- ファイル選択時はエディタで開く（フォルダ選択時は何もしない）
- `src/extension.ts` の登録に Prompts 用 TreeDataProvider を追加する
- UI/イベント/保存先: Tree クリックでファイルを開く（保存先: `~/.codex/prompts`）
- 参照: `docs/01_requirements.md`, `docs/02_architect.md`

## ✅AC（受け入れ基準）

- [ ] [機能] Prompts Explorer のルートに `prompts` が表示される
- [ ] [UI/UX] ファイルをクリックするとエディタで開く
- [ ] [状態/エラー] フォルダ選択時は編集操作が発生しない
- [ ] [テスト] Prompts の表示とファイルオープンがテストで検証できる

## 🔗依存関係

- DependsOn: #1

## 🧪テスト観点

- (統合)
- 検証方法：`npm test` で Tree 表示とファイルオープンの確認を行う

