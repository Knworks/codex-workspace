# 🚩 Feature Flags の同期とサポート範囲

## 🧭 採用基準

Manager で表示・変更できるのは、同梱カタログに存在し、Codex CLI の成熟度が **Stable または Experimental** のフラグです。Experimental は実験段階の設定として表示します。Under development・Deprecated・Removed は変更対象にしません。CLI の一覧に存在しない旧キーや未知のキーも、サービス側で書き込みを拒否します。既存の `config.toml` に残る対象外キーは自動削除しません。

`src/data/codexFeatureFlags.json` が単一の同期データです。比較のために対象外を含む全キーを保持し、Manager は採用基準で絞り込みます。現在の基準は **codex-cli 0.160.0、154件** です。実行時に CLI を起動する必要はありません。別バージョンの CLI と自動同期する仕組みではないため、利用中の CLI が異なる場合は一覧・既定値も異なる可能性があります。

## 📚 更新元と状態の意味

更新元は対象バージョンの `codex --version` と `codex features list` です。公式のコマンド仕様では、一覧の真偽値は実効状態を表します。

- 公式仕様: <https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-features>
- 取得処理: [feature-flags.mjs](../scripts/feature-flags.mjs)
- 同期データ: [codexFeatureFlags.json](../src/data/codexFeatureFlags.json)

取得処理は新規の一時 `CODEX_HOME` と作業ディレクトリを使用し、ユーザー・プロジェクトの設定と認証情報を読み込みません。その状態で返された真偽値を既定値として記録します。OS・CLI ビルドによる既定値の差はあり得るため、差分をレビューしてください。取得先の一時ディレクトリは成功・失敗のどちらでも削除します。

Manager の実効値表示は従来どおり、管理対象 `config.toml` の明示値、なければ同梱カタログの既定値です。プロファイル、リモート設定、組織ポリシーなどを含む CLI セッション全体の実効状態を取得する表示ではありません。

## 🔄 CLI 更新時の手順

1. 対象バージョンの CLI を PATH に配置します。別の実行ファイルを使う場合は `CODEX_FEATURES_CLI` に実行ファイルのパスを指定します。シェルコマンドや追加引数は指定しません。
2. 比較コマンドを実行します。バージョン、追加・削除キー、成熟度、既定値の変更を表示し、差があれば終了コード1を返します。CLI がない場合や未知の出力形式も失敗とします。

```sh
rtk npm run features:check
```

3. 差分を確認したうえで同期データを更新します。対象バージョンへの更新は、カタログ全体の置き換えとして記録されます。

```sh
rtk npm run features:update
rtk git diff -- src/data/codexFeatureFlags.json
```

4. 採用基準で新規・昇格フラグが表示されること、Removed・削除キーが操作できないことを確認します。説明が必要な項目は `coreManagerConfigService.ts` と翻訳を更新します。Hooks など別の導線が使用するキーも確認します。
5. 検証を実行し、同期データと関連変更を一緒にレビューします。

```sh
rtk npm run features:check
rtk npm test
```

通常のビルド・テストは同梱データで動作し、CLI のインストールを要求しません。`features:check` は CLI 更新時に追加実行する互換性チェックです。
