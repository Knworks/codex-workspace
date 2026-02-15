# Change Log

All notable changes to the "codex-workspace" extension will be documented in this file.

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
