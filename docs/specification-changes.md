# 🧾 追加・変更要件

## 🏷️ 概要

本変更では、Codex Workspaceの各Exploreを、Codex CLIの現行仕様と利用実態に合わせて整理する。

主な変更方針は以下とする。

- Skills Exploreを複数保存場所対応に拡張し、Skill Manager Viewを追加する。
- AGENTS Exploreをサブエージェント専用に整理し、AGENTS Manager Viewを追加する。
- MCP Exploreは現行仕様を維持し、MCP Manager Viewを追加する。
- PROMPTS ExploreはObsolete機能として扱い、現行仕様を維持する。
- Template Exploreは変更不要とし、現行仕様を維持する。
- Codex Core Exploreを整理し、Codex Core Viewを追加する。
- 既存の会話履歴画面は、Codex Core Viewの会話履歴タブへ移行する。
- Codex Core Viewには、会話履歴、AGENTS Loading Chain、信頼するディレクトリをタブ表示する。

## 🎭 ユースケース / ユーザーストーリー

- ユーザーはSkills Exploreで、複数保存場所に存在するSkillを1つの一覧として確認できる。
- ユーザーはSkill Manager Viewで、Skill名、説明、ファイルパス、有効状態を一覧で確認できる。
- ユーザーはSkill Manager Viewから`SKILL.md`を開ける。
- ユーザーはAGENTS Exploreで、サブエージェント定義ファイルのみを確認・操作できる。
- ユーザーはAGENTS Manager Viewで、サブエージェントの名前、説明、モデル、推論の深さ、サンドボックスモードを確認できる。
- ユーザーはAGENTS Manager Viewで、サブエージェントのON/OFFを切り替えられる。
- ユーザーはMCP Exploreで、従来通りMCPサーバーのON/OFFを切り替えられる。
- ユーザーはMCP Manager Viewで、MCPサーバーを追加、編集、削除できる。
- ユーザーはCodex Core Exploreから`config.toml`、`AGENTS.md`、`AGENTS.override.md`を開ける。
- ユーザーは`config.toml`が壊れていても、Codex Core Exploreから`config.toml`を開いて修正できる。
- ユーザーはCodex Core Viewの会話履歴タブで、現行の会話履歴を閲覧・検索・コピーできる。
- ユーザーはAGENTS Loading Chainタブで、現在有効なAGENTS系ファイル、無視された候補、要確認項目を確認できる。
- ユーザーは信頼するディレクトリタブで、信頼済みディレクトリを一覧表示できる。
- ユーザーはフォルダ選択ダイアログから信頼するディレクトリを追加できる。
- ユーザーは確認ダイアログ後に信頼するディレクトリのエントリを削除できる。

## 🧩 機能要件

### 🧠 Skills Explore / Skill Manager View

#### 🗂️ 対象保存場所

Skills ExploreおよびSkill Manager Viewは、以下の保存場所を対象とする。

| 種別 | 表示名 | パス | 優先度 |
| --- | --- | --- | --- |
| `project` | Project Skills | `project/.codex/skills` | 1 |
| `workspace` | Workspace Skills | `.codex/skills` | 2 |
| `user` | User Skills | `$HOME/.agents/skills` | 3 |

- 一覧表示は、保存場所の優先度順に表示する。
- 同一保存場所内では、名称昇順で表示する。
- 同名Skillが複数存在する場合も、特別な競合カテゴリは設けない。
- 同名Skillは、アイコンとツールチップのパス表示で区別する。
- 内部IDは、Skill名ではなく、保存場所種別と実体パスから生成する。

#### 🧭 Skills Exploreの表示

- Skills Exploreは、複数保存場所に存在するSkillを単一一覧として表示する。
- 保存場所ごとに異なるアイコンを表示する。
- ツールチップには、保存場所種別と絶対パスを表示する。
- 無効化されたSkillは、暗いトーンで表示する。
- Skill Manager Viewでトグル操作が行われた場合、Skills Exploreの表示を更新する。

#### 📄 新規ファイル

- 新規ファイル作成時は、作成先の保存場所を選択できる。
- 作成先選択肢は以下とする。
  - Workspace Skills
  - User Skills
  - Project Skills
- 選択中のSkillがある場合は、そのSkillの保存場所を初期候補にする。
- 未選択時は、既存互換のためWorkspace Skillsを初期候補にする。
- 作成先保存場所が存在しない場合は、自動作成する。
- ファイル名に拡張子がない場合は、従来通り`.md`を付与する。
- 禁止文字は従来通り`_`に置換する。
- 同名ファイルが存在する場合は、従来通り`_1`、`_2`の連番候補を提示する。

#### 📁 新規フォルダ

- 新規フォルダ作成時は、作成先の保存場所を選択できる。
- 作成先選択肢は以下とする。
  - Workspace Skills
  - User Skills
  - Project Skills
- 選択中のSkillがある場合は、そのSkillの保存場所を初期候補にする。
- 未選択時は、既存互換のためWorkspace Skillsを初期候補にする。
- 作成先保存場所が存在しない場合は、自動作成する。
- 同名フォルダが存在する場合は、従来通りエラー表示で中止する。

#### ✏️ リネーム

- リネームは、選択している実体パスのファイルまたはフォルダを対象とする。
- 保存場所のルートフォルダ自体はリネーム不可とする。
- ファイルは拡張子込みでリネーム対象とする。
- 目標名が存在しない場合は、そのままリネームする。
- 目標名が存在する場合、ファイルは従来通り連番候補を提示する。
- 目標名が存在する場合、フォルダは従来通りエラー表示で中止する。
- 確認ダイアログまたは入力UIには、保存場所種別と対象パスを表示する。

#### 🗑️ 削除

- 削除は、選択している実体パスのファイルまたはフォルダを対象とする。
- フォルダは従来通り再帰削除する。
- 削除前に確認ダイアログを表示する。
- 確認ダイアログには、保存場所種別、対象名、絶対パスを表示する。
- User Skillsの削除時は、他プロジェクトにも影響する可能性がある旨を表示する。

#### 📂 フォルダを開く

| 選択状態 | 開く場所 |
| --- | --- |
| フォルダ選択中 | 選択中のフォルダ |
| ファイル選択中 | 選択中ファイルの親フォルダ |
| 未選択 | 従来通り`.codex/skills` |

#### 🔄 同期

- 同期は、既存互換のため従来通り`.codex/skills`と`skillsFolder`の相互同期のみを対象とする。
- `project/.codex/skills`は同期対象外とする。
- `$HOME/.agents/skills`は同期対象外とする。
- 同期ボタンの表示条件は従来通り`skillsFolder`が設定されている場合のみとする。
- 同期処理の上書き、削除同期、隠しファイル除外、エラー時スキップの仕様は従来通りとする。

#### 🔁 Refresh

- Refresh操作は、Skills ExploreとSkill Manager Viewの双方を更新対象に含める。
- Skill Manager Viewが開いている場合、一覧を再取得して再描画する。
- Skill Manager Viewでトグル操作を行った場合も、Skills Exploreを更新する。

#### 🖥️ Skill Manager View

- Skill Manager Viewは、Skillの一覧確認と有効/無効切り替えに特化した管理画面とする。
- Skill Manager Viewは、WebviewPanelを利用してエディタ領域に表示する。
- Skill Manager Viewは、単一インスタンスとする。
- 既に開いている場合は、新規作成せず前面表示する。
- Skill Manager Viewは、Codex Coreの会話履歴ビューと同じ視覚スタイルを踏襲する。
- Skill Manager Viewは、ヘッダペインとボディペインで構成する。
- ヘッダペインには検索エリアを配置する。
- ボディペインにはSkill一覧を表示する。

#### 🔎 Skill Manager Viewの検索

- 検索対象は以下とする。
  - Skill名
  - 説明
  - ファイルパス
- 大文字小文字を区別しない部分一致で絞り込む。
- 検索文字列をクリアすると全件表示に戻す。

#### 📋 Skill Manager Viewの一覧項目

| 表示項目 | 内容 |
| --- | --- |
| アイコン | 保存場所を表すアイコン |
| Skill名 | `SKILL.md`から取得した名称。取得できない場合はフォルダ名 |
| 説明 | `SKILL.md`から取得した説明 |
| ファイルパス | `SKILL.md`の絶対パス |
| トグル | Skillの有効/無効状態 |
| 開く | 対象の`SKILL.md`をVS Codeエディタで開く |

- 保存場所は、アイコンとツールチップで識別できるようにする。
- ツールチップには、保存場所種別と絶対パスを表示する。
- 無効なSkillは、アイコン、Skill名、説明、ファイルパスを暗いトーンで表示する。
- 開く操作では、対象Skillの`SKILL.md`をVS Codeエディタで開く。

#### 🔘 Skill有効/無効トグル

- Skill Manager Viewでは、各Skillの有効/無効をトグルで切り替えられる。
- トグルONはSkill有効を表す。
- トグルOFFはSkill無効を表す。
- トグルOFF時、対象Skillを暗いトーンで表示する。
- トグル操作後は`config.toml`を更新する。
- トグル操作後は、Skill Manager ViewとSkills Exploreの表示を更新する。
- トグル成功後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

#### ⚙️ Skillのconfig.toml更新仕様

Skillの有効/無効は、`config.toml`の`[[skills.config]]`に反映する。

対象の`[[skills.config]]`が存在しない状態でOFFにする場合、以下を追加する。

```toml
[[skills.config]]
path = 'C:\Users\Kaz\.codex\skills\find-skills\SKILL.md'
enabled = false
```

対象の`[[skills.config]]`が存在する場合は、`enabled`の値のみを切り替える。

```toml
[[skills.config]]
path = 'C:\Users\Kaz\.codex\skills\find-skills\SKILL.md'
enabled = true
```

```toml
[[skills.config]]
path = 'C:\Users\Kaz\.codex\skills\find-skills\SKILL.md'
enabled = false
```

- `path`は`SKILL.md`の絶対パスとする。
- Windowsパスはシングルクォート文字列で出力する。
- 既存の`path`表記は可能な限り保持する。
- 既存の`enabled`行がある場合は、値のみ切り替える。
- 既存コメントがある場合は、可能な限り保持する。

#### 🚫 Skill Manager Viewで提供しない操作

初期リリースでは、Skill Manager Viewは一覧、検索、有効/無効トグル、開く操作に限定する。

Skill Manager Viewでは、以下を提供しない。

- 新規追加
- 削除
- リネーム
- 移動
- Webview内インライン編集

### 🧑‍💻 AGENTS Explore / AGENTS Manager View

#### 🗂️ 対象範囲

AGENTS ExploreおよびAGENTS Manager Viewでは、以下のみを対象とする。

| 対象 | 扱い |
| --- | --- |
| サブエージェント定義 | 対象 |
| `config.toml`の`[agents.<name>]` | 対象 |
| `config_file`先のTOMLファイル | 対象 |
| `AGENTS.md` | 対象外。Codex Core Exploreで扱う |
| `AGENTS.override.md` | 対象外。Codex Core Exploreで扱う |

#### 🗂️ 対象保存場所

AGENTS ExploreおよびAGENTS Manager Viewは、Skillsと同じ考え方で以下の保存場所を対象とする。

| 種別 | 表示名 | 参照ルート | 優先度 |
| --- | --- | --- | --- |
| `project` | Project Agents | `project/.codex/agents` | 1 |
| `workspace` | Workspace Agents | `.codex/agents` | 2 |
| `user` | User Agents | `$HOME/.codex/agents` | 3 |

- 一覧表示は、保存場所の優先度順に表示する。
- 同一保存場所内では、ファイル名昇順で表示する。
- 同名ファイルが複数存在する場合も、特別な競合カテゴリは設けない。
- 同名ファイルは、アイコンとツールチップのパス表示で区別する。
- 内部IDはファイル名ではなく、保存場所種別と実体パスから生成する。

#### 🧭 AGENTS Exploreの表示

- AGENTS Exploreは、サブエージェント定義ファイルを単一一覧として表示する。
- AGENTS Exploreでは、ファイル名のみを表示する。
- 保存場所ごとに異なるアイコンを表示する。
- ツールチップには、保存場所種別とファイルパスを表示する。
- AGENTS Exploreでは、ON/OFFトグルを提供しない。
- ON/OFF操作は、AGENTS Manager Viewへ移動する。
- AGENTS Manager Viewでトグル操作が行われた場合、AGENTS Exploreの表示を更新する。

#### 📄 新規ファイル

- 新規ファイル作成時は、作成先の保存場所を選択できる。
- 作成先選択肢は以下とする。
  - Workspace Agents
  - User Agents
  - Project Agents
- 選択中のサブエージェントがある場合は、その保存場所を初期候補にする。
- 未選択時は、既存互換のためWorkspace Agentsを初期候補にする。
- 作成先保存場所が存在しない場合は、自動作成する。
- 入力が拡張子なしの場合は、`.toml`を付与する。
- 入力が拡張子ありの場合は、入力を優先する。
- 禁止文字は従来通り`_`に置換する。
- 同名ファイルが存在する場合は、従来通り`_1`、`_2`の連番候補を提示する。

#### 📁 新規フォルダ

- 新規フォルダ作成時は、作成先の保存場所を選択できる。
- 作成先選択肢は以下とする。
  - Workspace Agents
  - User Agents
  - Project Agents
- 選択中のサブエージェントがある場合は、その保存場所を初期候補にする。
- 未選択時は、既存互換のためWorkspace Agentsを初期候補にする。
- 作成先保存場所が存在しない場合は、自動作成する。
- 同名フォルダが存在する場合は、従来通りエラー表示で中止する。

#### ✏️ リネーム

- リネームは、選択している実体パスのファイルまたはフォルダを対象とする。
- 保存場所のルートフォルダ自体はリネーム不可とする。
- ファイルは拡張子込みでリネーム対象とする。
- 目標名が存在しない場合は、そのままリネームする。
- 目標名が存在する場合、ファイルは従来通り連番候補を提示する。
- 目標名が存在する場合、フォルダは従来通りエラー表示で中止する。
- 確認ダイアログまたは入力UIには、保存場所種別と対象パスを表示する。

#### 🗑️ 削除

- 削除は、選択している実体パスのファイルまたはフォルダを対象とする。
- フォルダは従来通り再帰削除する。
- 削除前に確認ダイアログを表示する。
- 確認ダイアログには、保存場所種別、対象名、絶対パスを表示する。
- User Agentsの削除時は、他プロジェクトにも影響する可能性がある旨を表示する。

#### 📂 フォルダを開く

| 選択状態 | 開く場所 |
| --- | --- |
| フォルダ選択中 | 選択中のフォルダ |
| ファイル選択中 | 選択中ファイルの親フォルダ |
| 未選択 | Workspace Agents |

#### 🔄 同期

- AGENTS Exploreの同期仕様は、現行仕様をそのまま維持する。
- 同期ボタンの有無、表示条件、同期元、同期先、同期方式は現行仕様から変更しない。
- 今回の変更では、AGENTS Exploreの同期仕様は変更対象外とする。
- AGENTS Manager Viewには同期機能を追加しない。
- AGENTS Manager ViewでON/OFFトグルを操作した場合は、AGENTS Exploreの表示を更新する。

#### 🔁 Refresh

- Refresh操作は、AGENTS ExploreとAGENTS Manager Viewの双方を更新対象に含める。
- AGENTS Exploreを再読み込みする。
- AGENTS Manager Viewが開いている場合、一覧を再取得して再描画する。
- AGENTS Manager Viewでトグル操作を行った場合も、AGENTS Exploreを更新する。

#### 🖥️ AGENTS Manager View

- AGENTS Manager Viewは、サブエージェントの一覧確認とON/OFF切り替えに特化した管理画面とする。
- AGENTS Manager Viewは、WebviewPanelを利用してエディタ領域に表示する。
- AGENTS Manager Viewは、単一インスタンスとする。
- 既に開いている場合は、新規作成せず前面表示する。
- AGENTS Manager Viewは、Codex Coreの会話履歴ビューと同じ視覚スタイルを踏襲する。
- AGENTS Manager Viewは、ヘッダペインとボディペインで構成する。
- ヘッダペインには検索エリアを配置する。
- ボディペインにはサブエージェント一覧を表示する。

#### 🔎 AGENTS Manager Viewの検索

- 検索対象は以下とする。
  - 名前
  - 説明
  - モデル
  - 推論の深さ
  - サンドボックスモード
  - ファイルパス
- 大文字小文字を区別しない部分一致で絞り込む。
- 検索文字列をクリアすると全件表示に戻す。

#### 📋 AGENTS Manager Viewの一覧項目

| 表示項目 | 取得元 |
| --- | --- |
| アイコン | 保存場所 |
| 名前 | `[agents.<name>]`の`<name>` |
| 説明 | `[agents.<name>].description` |
| モデル | `config_file`先TOMLの`model` |
| 推論の深さ | `config_file`先TOMLの`model_reasoning_effort` |
| サンドボックスモード | `config_file`先TOMLの`sandbox_mode` |
| ON/OFF | `config.toml`登録あり / `agents-disabled.json`退避あり |
| 開く | `config_file`先TOML |

- 未指定項目は、空欄ではなく`継承`と表示する。
- 保存場所は、アイコンとツールチップで識別できるようにする。
- ツールチップには、保存場所種別と絶対パスを表示する。
- OFFのサブエージェントは、アイコン、名前、説明、ファイルパスを暗いトーンで表示する。

#### 🔘 AGENTS Manager ViewのON/OFFトグル

- AGENTS Manager Viewでは、サブエージェントのON/OFFをトグルで切り替えられる。
- AGENTS Exploreでは、サブエージェントのON/OFFトグルを提供しない。
- ON状態は、`config.toml`に対象サブエージェントの`[agents.<name>]`エントリが存在する状態とする。
- OFF状態は、`config.toml`に対象サブエージェントの`[agents.<name>]`エントリが存在しない状態とする。
- OFF操作時は、対象の`[agents.<name>]`エントリを`$HOME/.codex/.codex-workspace/agents-disabled.json`に退避し、`config.toml`から削除する。
- ON操作時は、`agents-disabled.json`から対象エントリを復元し、`config.toml`に`[agents.<name>]`エントリを再登録する。
- ON操作で復元に成功した場合、`agents-disabled.json`から対象エントリを削除する。
- ON/OFF操作では、`config_file`が参照するサブエージェント定義ファイルは削除しない。
- `[agents.<name>]`には`enabled`を追加しない。
- `[[agents.config]]`のような未確認の設定形式は使用しない。
- `agents-disabled.json`はCodex Workspace独自の退避ファイルであり、Codex CLI公式設定ではない。
- トグル成功後は、設定変更の反映にCodexの再起動が必要である旨を通知する。
- トグル操作後は、AGENTS Manager ViewとAGENTS Exploreの表示を更新する。

#### 🔁 ON復元時の上書き

- ON操作時に、`config.toml`に同名の`[agents.<name>]`が既に存在する場合は、`agents-disabled.json`に退避している定義で上書きする。
- 上書き時は確認ダイアログを表示しない。
- 処理完了後に簡易通知を表示する。
- 簡易通知には、上書きしたサブエージェント名を含める。

通知文言例は以下とする。

```txt
[agents.code-reviewer] を退避済み定義で上書きしました。
```

英語環境では以下とする。

```txt
[agents.code-reviewer] was overwritten with the disabled definition.
```

#### 📂 開くボタン

- AGENTS Manager Viewの開くボタンは、対象サブエージェントの`config_file`先TOMLファイルを開く。
- `config_file`が相対パスの場合は、対象の`config.toml`からの相対パスとして解決する。
- `config_file`先のファイルが存在する場合、VS Codeエディタで開く。
- `config_file`先のファイルが存在しない場合、エラー表示する。

### 🔌 MCP Explore / MCP Manager View

#### 🔌 MCP Explore

MCP Exploreは、現行仕様を維持する。

- `config.toml`の`[mcp_servers.<id>]`を一覧表示する。
- 表示順は、`config.toml`の出現順とする。
- MCPサーバーのON/OFFトグルを提供する。
- ON/OFFトグルの処理は現行仕様を維持する。
- `enabled`が未定義の場合はONとして扱う。
- OFF操作時に`enabled`が未定義の場合は、対象ブロックに`enabled = false`を追加する。
- `enabled`行が存在する場合は、`true` / `false`を切り替える。
- `enabled`行の末尾コメントは可能な限り保持する。
- MCP Manager Viewで編集、追加、削除が行われた場合は、MCP Exploreを更新する。

#### 🖥️ MCP Manager View

- MCP Manager Viewは、MCPサーバーの詳細確認、編集、追加、削除を行う管理画面とする。
- MCP Manager Viewは、WebviewPanelを利用してエディタ領域に表示する。
- MCP Manager Viewは、単一インスタンスとする。
- 既に開いている場合は、新規作成せず前面表示する。
- MCP Manager Viewは、Codex Coreの会話履歴ビューと同じ視覚スタイルを踏襲する。
- MCP Manager Viewは、ヘッダペインとボディペインで構成する。
- ヘッダペインには検索エリアを配置する。
- ボディペインは、左側ペインと右側ペインで構成する。

#### 🔎 MCP Manager Viewの検索

- MCP Manager Viewの検索対象は、サーバー名のみとする。
- 検索対象は`[mcp_servers.<id>]`の`<id>`とする。
- 大文字小文字を区別しない部分一致で絞り込む。
- 検索文字列をクリアすると全件表示に戻す。

#### 📋 左側ペイン

左側ペインには、MCPサーバー一覧を表示する。

| 表示項目 | 内容 |
| --- | --- |
| アイコン | MCPアイコン固定 |
| サーバー名 | `[mcp_servers.<id>]`の`<id>` |
| ON/OFFトグル | `enabled`の状態 |

- 左側ペインには、MCPサーバー追加ボタンを表示する。
- 左側ペインには、MCPサーバー削除ボタンを表示する。
- 左側ペインのON/OFFトグルは、即時保存する。
- ON/OFFトグルの更新処理は、MCP Exploreの現行処理と同じものを使用する。

#### 📝 右側ペイン

- 右側ペインには、選択中MCPサーバーの編集フォームを表示する。
- MCPサーバーの開くボタンは提供しない。
- 右側ペインで編集できる項目は、初期リリースでは最低限の主要項目に限定する。
- 必須項目には`※`を表示する。
- 編集内容は即時保存せず、保存ボタン押下時に`config.toml`へ反映する。
- キャンセルボタン押下時は、最後に読み込んだ状態へ戻す。

#### 🧾 編集項目

| 項目 | UI | 必須 | 備考 |
| --- | --- | --- | --- |
| サーバー名 | TextBox | ※ | `[mcp_servers.<id>]`の`<id>` |
| Transport | Select | ※ | `stdio` / `http` |
| Command | TextBox | ※ | `stdio`の場合のみ表示 |
| Args | TextArea |  | `stdio`の場合のみ表示。1行1引数 |
| URL | TextBox | ※ | `http`の場合のみ表示 |
| Required | Toggle |  | `required` |
| Startup Timeout | NumberBox |  | `startup_timeout_sec` |
| Tool Timeout | NumberBox |  | `tool_timeout_sec` |
| Enabled Tools | TextArea |  | `enabled_tools`。1行1ツール名 |
| Disabled Tools | TextArea |  | `disabled_tools`。1行1ツール名 |

初期リリースでは、以下の項目は編集対象外とする。

- `env`
- `http_headers`
- `env_http_headers`
- `bearer_token_env_var`
- OAuth関連項目
- その他、フォーム未対応のMCP設定項目

ただし、既存の`config.toml`にフォーム未対応項目が存在する場合は、保存時に削除せず保持する。

#### 🔀 Transport切替

stdio選択時に表示する項目は以下とする。

- サーバー名
- Transport
- Command
- Args
- Required
- Startup Timeout
- Tool Timeout
- Enabled Tools
- Disabled Tools

保存時には、現在のTransportに不要な`url`を削除する。

http選択時に表示する項目は以下とする。

- サーバー名
- Transport
- URL
- Required
- Startup Timeout
- Tool Timeout
- Enabled Tools
- Disabled Tools

保存時には、現在のTransportに不要な`command`と`args`を削除する。

#### 💾 保存

- 右側ペインの編集フォームは、保存ボタン押下時に`config.toml`へ反映する。
- 保存時に入力値を検証する。
- 検証に成功した場合、対象の`[mcp_servers.<id>]`ブロックを更新する。
- 保存後、未保存状態を解除する。
- 保存後、MCP ExploreとMCP Manager Viewを更新する。
- 保存後、設定変更の反映にCodexの再起動が必要である旨を通知する。
- フォーム未対応項目は、保存時に削除せず保持する。

#### ↩️ キャンセル

- キャンセルボタン押下時は、フォーム入力内容を最後に読み込んだ状態へ戻す。
- `config.toml`は更新しない。
- 未保存状態を解除する。
- 新規追加中の場合は、未保存の新規フォームを破棄する。

#### ⚠️ 未保存状態での操作

未保存状態のまま、別サーバー選択、追加、削除を実行する場合は確認を表示する。

| 選択肢 | 動作 |
| --- | --- |
| 保存して続行 | 現在の変更を保存してから操作を続行する |
| 破棄して続行 | 現在の変更を破棄して操作を続行する |
| キャンセル | 操作を中止し、現在の編集状態を維持する |

#### 🛡️ 保存時バリデーション

| 項目 | エラー条件 |
| --- | --- |
| サーバー名 | 空の場合 |
| サーバー名重複 | 変更後の`[mcp_servers.<id>]`が既に存在する場合 |
| Transport | `stdio` / `http`が未選択の場合 |
| Command | `stdio`で空の場合 |
| URL | `http`で空の場合 |
| Timeout | 数値ではない、または負数の場合 |
| Tools | `enabled_tools`と`disabled_tools`の両方に入力がある場合 |

`enabled_tools`と`disabled_tools`が同時に入力されている場合は、保存不可とする。

警告文言例は以下とする。

```txt
enabled_tools と disabled_tools は同時に設定できません。
どちらか一方のみ入力してください。
```

#### ➕ MCPサーバー追加

- MCP Manager Viewには、MCPサーバー追加ボタンを表示する。
- 追加ボタンは、左側ペインのMCPサーバー一覧上部に配置する。
- 追加操作では、新しい`[mcp_servers.<id>]`ブロックを作成する。
- 追加時は、サーバー名を入力する。
- 追加時は、Transportを選択する。
- Transportは`stdio` / `http`から選択する。
- Transport選択後、右側ペインに未保存の新規フォームを表示する。
- 新規MCPサーバーは、保存ボタン押下時に`config.toml`へ反映する。
- 保存前にキャンセルした場合は、`config.toml`に何も追加しない。
- 新規追加時のEnabled状態はONとする。
- `enabled`は未定義時ON扱いのため、初期状態では`enabled = true`を明示出力しない。
- 保存後は、MCP ExploreとMCP Manager Viewを更新する。
- 保存後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

#### 🗑️ MCPサーバー削除

- MCP Manager Viewには、MCPサーバー削除ボタンを表示する。
- 削除ボタンは、左側ペインのMCPサーバー一覧上部に配置する。
- 削除操作では、選択中の`[mcp_servers.<id>]`ブロックを`config.toml`から削除する。
- 削除前に確認ダイアログを表示する。
- 確認ダイアログには、削除対象の`[mcp_servers.<id>]`を表示する。
- 削除対象は`config.toml`のMCPサーバーブロックのみとする。
- MCPサーバー本体、外部サービス、環境変数、認証情報、関連ファイルは削除しない。
- 削除後は、MCP ExploreとMCP Manager Viewを更新する。
- 削除後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

削除確認文言例は以下とする。

```txt
MCPサーバー [mcp_servers.github] を削除します。
この操作は config.toml から対象ブロックを削除します。
よろしいですか？
```

英語環境では以下とする。

```txt
Delete MCP server [mcp_servers.github]?
This will remove the server block from config.toml.
```

#### 🔘 MCP Manager ViewのON/OFFトグル

- MCP Manager Viewの左側ペインには、ON/OFFトグルを表示する。
- ON/OFFトグルは即時保存する。
- ON/OFFトグルの処理はMCP Exploreの現行処理と同じものを使用する。
- `enabled`が未定義の場合はONとして扱う。
- OFF操作時に`enabled`が未定義の場合は、対象ブロックに`enabled = false`を追加する。
- `enabled`行が存在する場合は、`true` / `false`を切り替える。
- トグル後は、MCP ExploreとMCP Manager Viewを更新する。
- トグル後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

### 💬 PROMPTS Explore

- PROMPTS Exploreは、Obsolete機能として扱う。
- PROMPTS Exploreの現行仕様は維持する。
- PROMPTS Exploreには、今回の変更では新機能を追加しない。
- PROMPTS Explore用のManager Viewは追加しない。
- PROMPTS Exploreは、Codex CLIまたはVS Code拡張の公式カスタムスラッシュコマンド管理機能としては扱わない。
- PROMPTS Exploreで管理するPromptが、Codex CLIまたはVS Code拡張でカスタムスラッシュコマンドとして利用できることは保証しない。
- PROMPTS Exploreの表示/非表示は、既存のユーザー設定に従う。
- PROMPTS Exploreの同期仕様は、現行仕様を維持する。

### 📦 Template Explore

- Template Exploreは、今回の変更対象外とする。
- Template Exploreの現行仕様は維持する。
- Template Exploreには、今回の変更では新機能を追加しない。
- Template Explore用のManager Viewは追加しない。
- Template Exploreの同期仕様は、現行仕様を維持する。

### 🧭 Codex Core Explore / Codex Core View

#### 🧭 Codex Core Explore

Codex Core Exploreには、以下の一覧項目を表示する。

- `config.toml`
- `AGENTS.md`
- `AGENTS.override.md`

Codex Core Exploreには、以下のボタンを表示する。

- `.codex`フォルダを開く
- Codex Core Viewを開く
- Sync

既存の会話履歴ボタンは廃止し、Codex Core Viewを開くボタンへ置き換える。

#### 📄 Coreファイルを開く

- `config.toml`は、`.codex/config.toml`を開く。
- `AGENTS.md`は、`.codex/AGENTS.md`を開く。
- `AGENTS.override.md`は、`.codex/AGENTS.override.md`を開く。
- `AGENTS.override.md`が存在しない場合は、一覧に表示しない。
- `config.toml`がTOMLとして解析できない場合でも、ファイルとして存在し読み取り可能であれば開ける。

#### ⚠️ config.toml不正時の扱い

- `config.toml`が存在し、ファイルとして読み取り可能な場合は、TOMLとして解析できない状態でもVS Codeエディタで開ける。
- `config.toml`がTOMLとして解析できない場合、Codex Core Exploreでは`config.toml`に警告アイコンを表示する。
- `config.toml`の解析に失敗している場合でも、`.codex`フォルダを開く操作、`AGENTS.md`を開く操作、`AGENTS.override.md`を開く操作、Codex Core Viewを開く操作は利用可能とする。
- `config.toml`の解析に依存するMCP一覧、信頼するディレクトリ一覧、Skills/AGENTS/MCPの設定更新操作は無効化する。
- Codex Core Viewの会話履歴タブとAGENTS Loading Chainタブは、`config.toml`の解析に失敗していても表示可能とする。
- 信頼するディレクトリタブは表示可能とするが、`config.toml`の解析に失敗している場合はエラー内容を表示し、追加・削除操作を無効化する。
- Core Syncは無効化せず、不正アイコンで警告表示する。

#### 🔄 Codex Core同期

Codex Core同期は、以下を対象とする。

- `.codex/config.toml`
- `.codex/AGENTS.md`
- `.codex/AGENTS.override.md`

同期処理の基本仕様は、現行のCodex Core同期仕様を維持する。

#### 🖥️ Codex Core View

- Codex Core Viewは、Core関連の詳細画面をタブで表示する管理画面とする。
- Codex Core Viewは、WebviewPanelを利用してエディタ領域に表示する。
- Codex Core Viewは、単一インスタンスとする。
- 既に開いている場合は、新規作成せず前面表示する。
- Codex Core Viewは、タブ切り替え形式で複数のCore関連画面を表示する。
- Codex Core Viewの初期表示タブは、会話履歴タブとする。
- Codex Core Viewには、以下のタブを表示する。
  - 会話履歴
  - AGENTS Loading Chain
  - 信頼するディレクトリ
- 各タブには、タブごとのRefreshボタンを表示する。
- Refresh操作は、現在開いているタブのみ再読み込みする。

#### 📜 会話履歴タブ

- 会話履歴タブは、現行の会話履歴画面仕様をそのまま踏襲する。
- 会話履歴タブは、Codex Core Viewの初期表示タブとする。
- 既存の会話履歴画面で提供している検索、一覧、詳細表示、Markdownプレビュー、コピー操作は維持する。
- 会話履歴データの取得元、解析方式、表示順、表示件数制限は現行仕様を維持する。
- 既存の会話履歴ボタンは廃止し、Codex Core Viewボタンへ置き換える。
- Codex Core Viewボタンを押下した場合、Codex Core Viewを開き、会話履歴タブを表示する。
- Codex Core Viewが既に開いている場合は、既存インスタンスを前面表示し、会話履歴タブへ切り替える。

#### 🧬 AGENTS Loading Chainタブ

AGENTS Loading Chainタブは、Codex WorkspaceがCodexのAGENTS読み込みルールに基づいて推定した診断表示とする。

- Codex本体から実際の読み込み結果を取得するものではない。
- AGENTS Loading Chainタブは、VS Codeのワークスペースルートを基準にAGENTS読み込みチェーンを表示する。
- 画面上で基準ディレクトリを変更する操作は提供しない。
- ヘッダには、基準として使用しているワークスペースルートのパスを表示する。
- マルチルートワークスペースの場合は、先頭のワークスペースルートを基準にする。
- ワークスペースが開かれていない場合は、AGENTS Loading Chainを表示せず、ワークスペースを開く必要がある旨を表示する。
- `config.toml`がTOMLとして不正な場合は、`project_doc_fallback_filenames`を取得できないため、fallback候補なしで表示する。

##### 🎨 AGENTS Loading Chainの表示

- AGENTS Loading Chainタブは、AGENTS系ファイルの候補列挙ではなく、現在の推定読み込み状態を診断するUIとする。
- 左ペインは、以下の4セクションで構成する。
  - `現在有効`
  - `無視された候補`
  - `要確認`
  - `詳細候補`
- `現在有効`には、各レイヤーで現在採用されるファイルを表示する。
- `無視された候補`には、存在するが優先順位の関係で採用されないファイルを表示する。
- `要確認`には、存在するが読み取りに失敗したファイルを表示する。
- `詳細候補`には、候補として探索したが存在しないファイルを表示する。
- `詳細候補`セクションは、既定では非表示とし、`詳細候補を表示`トグルをONにした場合のみ表示する。
- 各エントリには、ファイル名、種別、状態バッジ、短い理由文を表示する。
- `無視された候補`と`詳細候補`は、現在有効な項目より暗いトーンで表示する。
- 状態の識別は、色だけでなく、バッジ、文字、トーン差の組み合わせで表現する。
- ヘッダには、基準ワークスペースルートと、使用中件数、未使用件数、問題あり件数、非表示候補件数を表示する。

##### 🧬 AGENTS Loading Chainの表示状態

UI上の表示状態は、以下の4種類とする。

| 表示状態 | 意味 |
| --- | --- |
| `使用中` | Codexの読み込み対象として現在採用される |
| `未使用` | 存在するが、優先順位の関係で採用されない |
| `問題あり` | 存在するが、読み取りに失敗した |
| `候補なし` | 候補として探索したが、ファイルが存在しない |

内部判定では、従来どおり `Active` / `Skipped` / `Missing` / `Error` を使用してよいが、UIには上記の表示状態を使う。

種別は、以下を組み合わせて表示する。

| 種別 | 意味 |
| --- | --- |
| `Global` | `$CODEX_HOME` / `~/.codex`配下 |
| `Project` | ワークスペース配下 |
| `Standard` | `AGENTS.md` |
| `Override` | `AGENTS.override.md` |
| `Fallback` | `project_doc_fallback_filenames`指定ファイル |

- `未使用`、`候補なし`、`問題あり`の項目には、理由を短い補足テキストとして表示する。

##### 🧭 AGENTS Loading Chainの判定根拠

- 判定には、`CODEX_HOME`、VS Codeワークスペースルート、`config.toml`の`project_doc_fallback_filenames`、ファイルシステム上の存在確認、読み取り結果を使用する。
- グローバルAGENTSは、`$CODEX_HOME`または`~/.codex`配下の`AGENTS.override.md`、`AGENTS.md`を候補とする。
- プロジェクトAGENTSは、VS Codeワークスペースルート配下の`AGENTS.override.md`、`AGENTS.md`、`project_doc_fallback_filenames`指定ファイルを候補とする。
- 同じ階層では、`AGENTS.override.md`、`AGENTS.md`、fallback指定ファイルの順に優先する。
- 同じ階層で最初に存在し読み取り可能なファイルを`Active`とする。
- 同じ階層で存在するが、より優先度の高いファイルにより採用されないファイルを`Skipped`とする。
- 存在するが読み取りに失敗したファイルを`Error`とする。
- `Missing`は内部判定として保持するが、UIでは既定非表示とし、`詳細候補を表示`トグルON時のみ表示する。

##### 📄 AGENTS Loading Chainの右ペイン

右ペインには、左ペインで選択した項目の状態理由、詳細情報、本文プレビューを表示する。

- 右ペインには、ファイル名、状態、分類、絶対パス、説明を表示する。
- `使用中`の項目には、現在どのレイヤーで採用されているかを説明する。
- `未使用`の項目には、優先された別ファイルがあることを説明する。
- `候補なし`の項目には、候補として探索されたが存在しないことを説明する。
- `問題あり`の項目には、読み取り失敗理由とエラーメッセージを表示する。
- ファイルが存在し、読み取り可能な場合は本文プレビューを表示する。
- 右ペインでは、AGENTSファイル本文のインライン編集は提供しない。

#### 🔐 信頼するディレクトリタブ

- 信頼するディレクトリタブでは、`config.toml`の`[projects."<path>"]`のうち、`trust_level = "trusted"`のエントリを一覧表示する。
- 一覧には、`Trust Level`列は表示しない。
- 一覧には、信頼済みディレクトリを示すアイコン、ディレクトリパス、削除操作を表示する。
- ディレクトリが存在する場合は、通常の信頼済みディレクトリアイコンで表示する。
- ディレクトリが存在しない、または参照できない場合は、警告アイコンを表示する。
- 存在しない理由は、ツールチップまたは補足テキストで表示する。
- `trust_level`は内部判定にのみ使用する。
- `trust_level`が`trusted`以外のエントリは、初期リリースでは一覧対象外とする。

##### ➕ 信頼するディレクトリの追加

- 信頼するディレクトリタブには、追加ボタンを表示する。
- 追加ボタン押下時は、フォルダ選択ダイアログを表示する。
- ユーザーがディレクトリを選択した場合、`config.toml`に`[projects."<path>"]`エントリを追加する。
- 追加するエントリには、`trust_level = "trusted"`を設定する。
- 同じパスの`[projects."<path>"]`が既に存在する場合は、重複追加せず、`trust_level = "trusted"`に更新する。
- 追加後は、信頼するディレクトリ一覧を更新する。
- 追加後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

##### 🗑️ 信頼するディレクトリの削除

- 信頼するディレクトリタブには、削除ボタンを表示する。
- 削除ボタン押下時は、確認ダイアログを表示する。
- 確認ダイアログには、削除対象のディレクトリパスを表示する。
- OKの場合、`config.toml`から対象の`[projects."<path>"]`エントリを削除する。
- 削除対象は`config.toml`の信頼設定のみとし、実際のフォルダやファイルは削除しない。
- 削除後は、信頼するディレクトリ一覧を更新する。
- 削除後は、設定変更の反映にCodexの再起動が必要である旨を通知する。

削除確認文言例は以下とする。

```txt
信頼するディレクトリ [/Users/kaz/projects/CodexRateLimit] を一覧から削除します。
この操作では config.toml の信頼設定のみを削除し、実際のフォルダは削除しません。
よろしいですか？
```

英語環境では以下とする。

```txt
Remove trusted directory [/Users/kaz/projects/CodexRateLimit]?
This only removes the trust entry from config.toml and does not delete the actual folder.
```

## 🛡️ 非機能要件

### 🎨 UI / UX

- 各Manager Viewは、Codex Coreの会話履歴ビューと同じ視覚スタイルを踏襲する。
- Skill Manager View、AGENTS Manager View、MCP Manager View、Codex Core Viewは、WebviewPanelを利用してエディタ領域に表示する。
- 各Manager Viewは、単一インスタンスとする。
- 無効状態のSkillまたはサブエージェントは、VS Codeテーマに追従した暗いトーンで表示する。
- 保存場所アイコンは、視覚的に区別しやすいものを使用する。
- アイコンの種類は保存場所を表し、アイコンのトーンはON/OFF状態を表す。
- トグルは、状態が直感的に分かるスイッチ風UIとする。
- MCP Manager Viewでは、ユーザーの入力負担を減らすため、初期リリースでは編集項目を主要項目に限定する。
- Codex Core Viewは、タブ切り替え形式でCore関連画面を表示する。
- AGENTS Loading Chainは、現在有効な項目を先頭に整理した診断ビューとする。
- AGENTS Loading Chainの状態識別は、色だけに依存せず、バッジ、文字、トーン差を組み合わせる。
- 信頼するディレクトリ一覧では、存在しないディレクトリのみ警告アイコンで示す。
- `config.toml`が不正な場合は、`config.toml`に警告アイコンを表示し、修正可能であることをツールチップで示す。

### 🧯 安全性

- 削除・リネーム時は、保存場所種別と絶対パスを表示する。
- User SkillsおよびUser Agentsの削除時は、他プロジェクトへ影響する可能性を表示する。
- Skill Manager Viewでは、誤操作防止のため削除・リネーム・移動を提供しない。
- AGENTS Manager Viewでは、誤操作防止のため削除・リネーム・移動・インライン編集を提供しない。
- MCP Manager Viewの右側フォームの編集内容は、保存ボタン押下時のみ`config.toml`に反映する。
- MCP Manager ViewのON/OFFトグルのみ即時保存する。
- MCPサーバー追加は、保存ボタン押下時まで`config.toml`に反映しない。
- MCPサーバー削除は、確認OK後に即時反映する。
- MCPサーバー削除では、MCPサーバー本体、外部サービス、環境変数、認証情報、関連ファイルは削除しない。
- `enabled_tools`と`disabled_tools`の同時入力時は保存不可とする。
- フォーム未対応項目は保存時に削除しない。
- `config.toml`がTOMLとして不正でも、存在して読み取り可能ならエディタで開ける。
- `config.toml`の解析に依存する更新操作は、解析失敗時に無効化する。
- 信頼するディレクトリの削除では、実際のフォルダやファイルは削除しない。
- AGENTS Loading Chainは、Codex本体の実行結果ではなく、Codex Workspaceによる推定結果として扱う。
- `config.toml`更新時は、既存の設定やコメントを可能な限り保持する。

### 🧪 テスト観点

| テスト項目 | 確認内容 |
| --- | --- |
| Skills複数保存場所検出 | `project` / `workspace` / `user`のSkillを検出できる |
| Skill Manager表示 | 名前、説明、パス、トグル、開く操作が表示される |
| Skillトグル | `[[skills.config]]`が追加または更新される |
| AGENTS対象除外 | `AGENTS.md` / `AGENTS.override.md`がAGENTS Exploreに表示されない |
| AGENTS複数保存場所検出 | `project` / `workspace` / `user`のサブエージェントを検出できる |
| AGENTS Manager表示 | 名前、説明、モデル、推論の深さ、サンドボックスモードが表示される |
| AGENTSトグルOFF | `[agents.<name>]`が退避され、`config.toml`から削除される |
| AGENTSトグルON | 退避済み定義が`config.toml`に復元される |
| AGENTS復元上書き | 同名`[agents.<name>]`がある場合に上書きされ、簡易通知が表示される |
| MCP Explore維持 | MCP Exploreの現行ON/OFF仕様が維持される |
| MCP Manager起動 | MCP Manager ViewがWebviewPanelとして表示される |
| MCP検索 | サーバー名で絞り込みできる |
| MCP編集保存 | 保存ボタンで`[mcp_servers.<id>]`が更新される |
| MCP追加 | 未保存フォームから保存時に新規ブロックが追加される |
| MCP削除 | 確認OK後に対象ブロックのみ削除される |
| MCP未対応項目保持 | フォーム未対応項目が保存後も残る |
| PROMPTS現行維持 | PROMPTS Exploreに新機能が追加されない |
| Template現行維持 | Template Exploreの現行仕様が維持される |
| Core一覧表示 | `config.toml`、`AGENTS.md`、`AGENTS.override.md`が表示される |
| Core View起動 | Codex Core ViewがWebviewPanelとして表示される |
| 会話履歴タブ | 現行の会話履歴仕様が維持される |
| AGENTS Loading Chain | ワークスペースルート基準で診断ビューが表示される |
| Loading Chainセクション表示 | 現在有効 / 無視された候補 / 要確認 / 詳細候補が表示される |
| Loading Chain詳細候補トグル | `候補なし`が既定非表示で、トグルON時のみ表示される |
| Loading Chain種別表示 | Global / Project / Standard / Override / Fallbackが表示される |
| Loading Chain右ペイン | 状態、分類、パス、説明、本文プレビューが表示される |
| 信頼ディレクトリ一覧 | `trust_level = "trusted"`のエントリだけ表示される |
| 信頼ディレクトリ追加 | フォルダ選択後に`[projects."<path>"] trust_level = "trusted"`が追加される |
| 信頼ディレクトリ削除 | 確認後に信頼設定のみ削除される |
| config不正時Open | 壊れた`config.toml`でも存在して読めれば開ける |
| config不正時操作制限 | 解析依存の更新操作が無効化される |
| タブRefresh | 現在開いているタブだけ再読み込みされる |

## 🔒 制約事項

- 既存ユーザーへの破壊的変更を避けるため、既存同期設定キーは維持する。
- `codex-workspace.skillsFolder`は引き続きWorkspace Skillsの同期先として扱う。
- Skills同期機能は、引き続き`.codex/skills`と`skillsFolder`の相互同期のみを対象とする。
- AGENTS Exploreの同期仕様は現行仕様を維持し、今回の変更対象外とする。
- PROMPTS ExploreはObsolete機能として扱い、今回の変更では拡張しない。
- Template Exploreは今回の変更対象外とする。
- Skill Manager Viewは、初期リリースでは一覧、検索、トグル、開く操作専用とする。
- AGENTS Manager Viewでは、初期リリースでは追加、削除、リネーム、移動、インライン編集を提供しない。
- MCP Manager Viewでは、MCPサーバーの開くボタンを提供しない。
- MCP Manager Viewでは、初期リリースでは編集項目を主要項目に限定する。
- `enabled_tools`と`disabled_tools`は同時設定不可とする。
- AGENTS Loading Chainは、Codex本体から実際の読み込み結果を取得するものではない。
- AGENTS Loading Chainは、Codex WorkspaceがAGENTS読み込みルールを再現した推定結果として表示する。
- AGENTS Loading Chainの基準ディレクトリはVS Codeワークスペースルートとし、画面上で変更する操作は提供しない。
- マルチルートワークスペースでは、先頭のワークスペースルートを基準にする。
- 信頼するディレクトリタブでは、`trust_level = "trusted"`以外のエントリは初期リリースでは一覧対象外とする。
- 信頼するディレクトリの削除は、`config.toml`の信頼設定のみを削除し、実フォルダは削除しない。
- 会話履歴タブは現行仕様をそのままタブ化し、解析仕様や表示仕様は変更しない。
- `incrudeReasoningMessage`は既存互換を優先し、今回の変更では名称変更しない。

## ⚠️ 保留事項

- `env` / `http_headers` / `env_http_headers`のKeyValue編集UIをMCP Manager Viewに追加するかは将来対応とする。
- `bearer_token_env_var`をMCP Manager Viewの編集対象に含めるかは将来対応とする。
- OAuth関連項目をMCP Manager Viewで扱うかは将来対応とする。
- MCPサーバー接続テスト機能を追加するかは将来対応とする。
- MCPサーバーが提供するツール一覧を実際に取得して表示するかは将来対応とする。
- 信頼するディレクトリタブで、`trust_level = "trusted"`以外のプロジェクト設定を将来表示するかは未確定とする。
- `incrudeReasoningMessage`はタイポの可能性があるが、既存互換を優先し、将来`includeReasoningMessage`への移行を検討する。

## ✅ まとめ

今回の変更では、既存Exploreを壊さず、管理・診断・編集が必要な領域をManager ViewまたはCodex Core Viewへ分離する。

- Skillsは、複数保存場所対応とSkill Manager Viewを追加する。
- AGENTSは、サブエージェント専用に整理し、AGENTS Manager Viewを追加する。
- MCPは、Exploreの現行ON/OFF仕様を維持し、MCP Manager Viewを追加する。
- PROMPTSは、Obsolete機能として現行維持する。
- Templateは、変更不要として現行維持する。
- Codex Coreは、Codex Core Viewを追加し、会話履歴、AGENTS Loading Chain、信頼するディレクトリをタブで扱う。
