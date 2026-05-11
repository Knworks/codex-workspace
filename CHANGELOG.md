# Change Log

All notable changes to the "codex-workspace" extension will be documented in this file.

## 1.1.2

Changes

- Updated Skill Manager so enabled skills remove their `[[skills.config]]` entry instead of writing `enabled = true`.
- Added agent config repair so `config.toml` descriptions and `config_file` values can be corrected from agent files.

Fixes

- Fixed Agent sync so returning agent files no longer reset `[agents.<id>]` descriptions to an empty string.

## 1.1.1

Changes

- Updated WebView styling to explicitly use the VS Code editor font.
- Updated Markdown previews to render as HTML instead of showing raw Markdown.
- Updated Feature Flags to match the latest Codex CLI feature set.
- Updated the Skill Explore add flow with preview-based inputs and inline child add actions.
- Refined explorer and manager UI spacing, icons, and layout consistency.

## 1.1.0

Changes

- Added `Codex Manager` with conversation history, AGENTS loading diagnostics, trusted directories, feature flags, and hooks tabs.
- Added dedicated manager views for Skills, Sub Agents, and MCP Server editing.
- Updated project-level Skills and Sub Agents handling to follow current Codex folder conventions while keeping legacy locations readable.
- Added `Organize config.toml` with one-file backup support for managed config sections.
- Refined explorer and manager UI with Codicon-based status icons, refreshed labels, and improved WebView layouts.

Fixes

- Fixed multiple `config.toml` update flows so managed sections stay grouped more consistently during normal edits.
- Fixed localization gaps across Codex Manager and MCP Manager runtime UI strings.
- Fixed several manager and diagnostics behaviors around MCP env entries, trusted directories, and AGENTS loading details.

## 1.0.5

Preview

- Added specification updates for Agent Explorer (`~/.codex/agents`).
  - Added specification updates for agent enable/disable by adding/removing `[agents.<agent>]` in `config.toml`.
  - Added specification updates for agent file sync flow (`agentFolder`, Agent Explorer sync button, bidirectional sync).
  - Added specification updates to store disabled agent blocks in `.codex/.codex-workspace/agents-disabled.json`.

Changes

- Added specification updates to migrate sync metadata from `.codex/.codex-sync/state.json` to `.codex/.codex-workspace/codex-sync.json`.
- Added a refresh button to MCP Explore.

Fixes

- Fixed an issue where `[mcp_servers.xxxxx.env]` entries were displayed in MCP Explorer.

## 1.0.4

Fixes

- Fixed an issue where icons in the history view were not displayed after publishing.

## 1.0.3

Changes

- Added a conversation history WebView in the editor area, accessible from Codex Core (`history` button) and Command Palette.

>**IMPORTANT:** We parse sessions from $CODEX_HOME/sessions/.../rollout-*.jsonl and extract the fields to display, so if the current log format changes, the conversation history may no longer be displayed.

## 1.0.2

Changes

- Added sync folder settings for Codex Core, Prompts, Skills, and Templates.
- Added bidirectional sync with deletion tracking between `.codex` and configured folders.

## 1.0.1

Changes

- Updated the AGENTS.md icon to use theme-specific light/dark assets.
- On name conflicts, files offer a numbered-name confirmation while folders stop with an error; overwrite/numbered selection options were removed.
- Unified the sort order of the folder/file list to folders first, then files.
- Allowed renaming that differs only by letter case (uppercase/lowercase).

Fixes

- Fixed an issue where folders/files could not be added to the root when no item was selected in the TreeView.
- Fixed an issue where the folder expansion state was not preserved after renaming a folder or adding a file.

## 1.0.0

- Initial release
