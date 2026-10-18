# 🧪 CLI Agent 互換性検証

## 🎯 対象と根拠

- 対応版: `codex-cli 0.163.0`（Windows x64、2026-10-19 実測）。他の版への互換性は未検証。
- 公式資料: <https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents>
- 対象版ソース: <https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/agent-roles/src/loader.rs>
- 再帰探索: <https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/agent-roles/src/discovery.rs>
- 必須項目・本文 metadata: <https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/agent-roles/src/agent_role_config.rs>
- 設定型: <https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/config.schema.json>

公式資料はホームと Project の単独 TOML、必須の `name` / `description` / `developer_instructions`、本文の名前による識別を案内している。版固定ソースでは、読み込まれた設定レイヤーの隣の `agents` を再帰探索し、同レイヤーの有効な宣言が参照済みのファイルを単独探索から除外する。宣言の `config_file` は宣言元のディレクトリ基準で解決され、参照ファイルに名前があれば宣言キーより優先される。

## 🔬 実 CLI の検証方法

`scripts/verify-agent-cli.cjs` は一時 CODEX_HOME と一時 Project を作り、各観測で新しい `codex exec` を起動する。モデル接続先はループバック HTTP サーバーのみとし、CLI が生成した spawn ツールの Agent 一覧を検査する。サーバーは常に HTTP 400 を返すため、モデル推論・ツール実行・Agent 起動を行わない。認証情報は作成・複製しない。CLI 生成設定では `agents.enabled = true`、`features.code_mode = false` とする。

一時 Project は `.probe-root` をルートマーカーとし、信頼済み設定を入れる。Windows の trust 登録には、CLI に渡す実パスと同じ区切り文字の表記を使う。スラッシュへ変換した信頼パスでは今回 Project が検出されず、実パス表記へ修正後に検出された。

```powershell
npm run compile-tests
node scripts/verify-agent-cli.cjs C:/absolute/path/to/codex.exe
```

実行ファイルを直接指定する。スクリプトは版が `0.163.0` でない場合に拒否する。サービスはコンパイル済みの実装を読み、VS Code API は言語・workspace 情報のみを置き換える。一時物の削除前に検証子プロセスを終了し、Windows の一時的なディレクトリロックを待つ。

## ✅ 観測結果

| 観点 | 実 CLI の結果 | 共通サービスへの反映 |
| --- | --- | --- |
| CODEX_HOME/agents の外部作成定義 | 宣言なしで検出 | 単独定義として列挙 |
| 信頼済み Project/.codex/agents | 検出 | 認識済み Project ルートを列挙 |
| agents/subdir/*.toml | 検出 | 再帰探索 |
| Project/.agents/agents | 検出されない | Explorer の fallback を CLI ルートから除外 |
| ファイル名と本文 name が異なる | 本文 name で検出 | ファイル名・宣言キー・name を別々に保持 |
| 必須3項目を1つずつ省略 | 該当定義を除外し警告 | 有効扱いしない |
| enabled = false を追加 | unknown field の警告で定義全体を除外 | OFF フラグとして使わない |
| *.toml.disabled | 検出されない | 本文を保持して拡張子で退避 |
| 共通サービスで OFF → 新規セッション | 該当 Agent が消える | enabled=false / disabled と一致 |
| 共通サービスで ON → 新規セッション | 該当 Agent が戻る | enabled=true / available と一致 |
| 宣言キーと参照ファイル name が異なる | 本文 name で検出 | roleKey と name を分離 |
| 単独形式の参照先を残し宣言だけ削除 | Agent が引き続き検出される | この OFF を理由付きで拒否 |
| 旧形式の宣言参照を OFF / ON 後に新規セッション | OFF で消え、ON で戻る | 既存 store を使用した状態と一致 |

スクリプトの11観測はすべて期待値と一致し、終了コード0を確認した。HTTP 400 による CLI 自体の終了コード1は意図した観測手段であり、Agent 一覧を取得できない場合はスクリプト側で失敗させる。

## 🧩 API と制約

`cliAgentService.ts` の `listCliAgentRecords()` は宣言参照型と単独定義を共通モデルで返す。`setCliAgentEnabled()` は最新版を推測せず、対応契約の版に限定する。`enabled` は認識済み設定元における当該定義の利用可否で、`availability` と `reason` を必ず合わせて扱う。

- `available`: 対応する検証範囲で利用できる定義。
- `disabled`: 単独実体を退避済み、または既存の宣言退避にある定義。
- `invalid`: 必須項目不足、型不正、読み取り失敗など。
- `unverified`: 共通サービスの検証範囲外の設定を含む定義。有効・無効を断定せず、変更操作を拒否する。

単独ファイルの検証範囲は必須3項目と `model`、`model_reasoning_effort`、`sandbox_mode`。宣言側は `description` と `config_file` を検証する。その他の合法な CLI 設定も検出されるが、状態は未検証となる。未知項目、本文、コメントは消去・変換しない。model の利用権限や実際にモデルへ適用した結果は検証していない。

設定レイヤー全体の合成、trust 自動判定、選択 Profile の解決、同名定義の勝者判定は対象外。同名の別有効定義があれば、変更後の CLI 名の利用可否を保証できないため変更を拒否する。既存 Base / Profile / Project の宣言と disabled store を自動移行しない。既存 Manager / Explorer の UI と登録フローはこの新 API に切り替えていない。

## 🛡️ 回帰確認

`src/test/cliAgentService.test.ts` は、必須項目不足・空白・不正型・不正 TOML、同名別スコープ、ファイル名と名前の相違、ON/OFF の本文バイト保持と安定 ID、既存 store、未知設定保持、退避先衝突、未対応版、消えた行 ID、危険な宣言 OFF の拒否を確認する。既存 Agent Manager / locations のテストも継続する。

```powershell
npm run pretest
node --use-system-ca node_modules/@vscode/test-cli/out/bin.mjs --grep 'CLI Agent service|Agent manager service|Agent locations'
```

この環境では VS Code ダウンロード時に Node 標準の証明書ストアでは検証に失敗した。OS の証明書ストアを使う `--use-system-ca` で取得・実行した。TLS 検証は無効化していない。
