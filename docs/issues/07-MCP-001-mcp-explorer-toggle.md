# 🧾`MCP-001 MCP Explorer一覧とトグル`

## 🎯背景/目的

- MCP サーバーの有効/無効を VS Code 上から視覚的に切り替えられるようにする。

## 📌要件

- 5.1
- 5.4
- 5.7

## 🛠️スコープ / 作業内容

- `config.toml` の `[mcp_servers.<id>]` を出現順で抽出して一覧表示する
- `enabled` 行の検出/反転/挿入とコメント保持ロジックを実装する
- スイッチ風 UI と `mcp32.png` のアイコン表示を追加する
- UI/イベント/保存先: Tree クリックでトグル（保存先: `~/.codex/config.toml`）
- 参照: `docs/01_requirements.md`, `docs/02_architect.md`

## ✅AC（受け入れ基準）

- [ ] [機能] MCP サーバーが `config.toml` の出現順で表示される
- [ ] [機能] `enabled` がない場合はヘッダ直下に `enabled = false` が挿入される
- [ ] [状態/エラー] `enabled = true # comment` の末尾コメントが保持される
- [ ] [UI/UX] ON/OFF 状態がスイッチ風 UI とアイコンで視認できる
- [ ] [UI/UX] トグル成功時に再起動が必要な旨の通知が表示される
- [ ] [テスト] `enabled` パッチ処理の主要パターンがテストで検証できる

## 🔗依存関係

- DependsOn: #1

## 🧪テスト観点

- (ユニット / 統合)
- 検証方法：`npm test` でパッチ処理と UI 更新のテストを実行する

