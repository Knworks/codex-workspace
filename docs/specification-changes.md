# 🧾 追加・変更要件

## 🏷️ 概要

現在、各種Explorerで編集したファイルは、`.codex` 配下のフォルダを直接編集するものとなっている。  
ユーザーがリポジトリで管理している別フォルダなどがある場合、それぞのファイルを同期するのに、コピーするなどの手間がかかる。  
そのため、以下のエクスプローラーに、同期ボタンを新たに追加し、同期ボタンを押下することで、予め設定した同期フォルダとの同期を実行したい。

- Codex Core
- Prompts Explorer
- Skills Explorer
- Template Explorer

## 🎭 ユースケース / ユーザーストーリー

- **U1**：ユーザーは、Codex Core の同期ボタンを押下することで、設定値で指定した同期フォルダにファイルをコピーすることができる。
- **U2**：ユーザーは、Prompts Explorer の同期ボタンを押下することで、設定値で指定した同期フォルダにプロンプトファイルをコピーすることができる。
- **U3**：ユーザーは、Skills Explorer の同期ボタンを押下することで、設定値で指定した同期フォルダにスキルファイルをコピーすることができる。
- **U4**：ユーザーは、Template Explorer の同期ボタンを押下することで、設定値で指定した同期フォルダにテンプレートファイルをコピーすることができる。

## 🧩 機能要件

- 以下の設定値を追加する。
  - Codex Core Sync Folder：Codex Coreの同期先フォルダのパス（既定値：ブランク）
    - キー：`codexFolder`
  - Prompts Sync Folder：Prompts Explorerの同期先フォルダのパス（既定値：ブランク）
    - キー：`promptsFolder`
  - Skills Sync Folder：Skills Explorerの同期先フォルダのパス（既定値：ブランク）
    - キー：`skillsFolder`
  - Template Sync Folder：Template Explorer の同期先フォルダのパス（既定値：ブランク）
    - キー：`templatesFolder`

- Codex Core
  - 同期ボタンを追加（codeIcon：`sync`）
    - `codexFolder` に値が設定されていない場合は、非表示とする
    - 同期ボタンを押下すると、確認メッセージを表示し、OKボタンを押下した場合、`.codex` 配下の `AGENTS.md` と `config.toml` を `codexFolder` で指定されたフォルダへコピーする。（上書き）
      - メッセージ：`<パス> のファイルを上書きしますがよろしいですか？`
- Prompts Explorer
  - 同期ボタンを追加（codeIcon：`sync`）
    - `promptsFolder` に値が設定されていない場合は、非表示
    - 同期ボタンを押下すると、確認メッセージを表示し、OKボタンを押下した場合、`.codex/prompts` 配下のファイルを全て `promptsFolder` で指定されたフォルダへコピーする。（上書き）
      - メッセージ：`<パス> のファイルを上書きしますがよろしいですか？`
- Skills Explorer
  - 同期ボタンを追加（codeIcon：`sync`）
    - `skillsFolder` に値が設定されていない場合は、非表示
    - 同期ボタンを押下すると、確認メッセージを表示し、OKボタンを押下した場合、`.codex/skills` 配下のファイルを全て `skillsFolder` で指定されたフォルダへコピーする。（上書き）
      - メッセージ：`<パス> のファイルを上書きしますがよろしいですか？`
- Template Explorer
  - 同期ボタンを追加（codeIcon：`sync`）
    - `templatesFolder` に値が設定されていない場合は、非表示
    - 同期ボタンを押下すると、確認メッセージを表示し、OKボタンを押下した場合、`.codex/codex-templates` 配下のファイルを全て `templatesFolder` で指定されたフォルダへコピーする。（上書き）
      - メッセージ：`<パス> のファイルを上書きしますがよろしいですか？`

## 🛡️ 非機能要件

- 変更なし

## 🔒 制約事項

- 変更なし