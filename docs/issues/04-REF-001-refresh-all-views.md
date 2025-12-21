# 🧾`REF-001 全ビューRefresh`

## 🎯背景/目的

- 複数ビューの内容を即時更新できるようにし、状態の不整合を解消する。

## 📌要件

- 5.9

## 🛠️スコープ / 作業内容

- Prompts/Skills/Templates/MCP/Core の全ビューを更新する Refresh コマンドを実装する
- `package.json` の view/title アクションに Refresh を定義する
- `src/extension.ts` で各 TreeDataProvider の更新イベントを統一的に通知する
- UI/イベント/保存先: ビュー上部の Refresh クリックで再取得（保存先なし）
- 参照: `docs/01_requirements.md`, `docs/02_architect.md`

## ✅AC（受け入れ基準）

- [ ] [機能] Refresh 実行で Prompts/Skills/Templates/MCP/Core の全ビューが更新される
- [ ] [UI/UX] 各 Explorer の上部操作から Refresh を実行できる
- [ ] [状態/エラー] 利用不可時は Refresh しても表示が変化しない
- [ ] [テスト] Refresh 実行後に Tree が再取得されることをテストで確認できる

## 🔗依存関係

- DependsOn: #2

## 🧪テスト観点

- (統合)
- 検証方法：`npm test` で Refresh 実行後の再描画を確認する

