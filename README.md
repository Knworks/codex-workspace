# Codex Workspace

Explore and manage your .codex workspace (config.toml, AGENTS.md, prompts, skills, templates, mcp) in VS Code.

## Features

- Dedicated explorers for Prompts, Skills, Templates, MCP, and Codex Core
- Create, rename, and delete files or folders under each root
- Open files in the editor with a single click
- Open each root folder in the OS file explorer
- Bidirectional sync between Codex Core/Prompts/Skills/Templates and configured folders
- Sync respects latest modified timestamps and excludes hidden files
- Toggle MCP servers on or off from the MCP Explorer
- Open Codex CLI conversation history in an editor WebView from Codex Core or Command Palette
- Filter history cards by keyword and preview extracted conversation blocks (`user_message` + final answer)

## Views

![alt text](images/views.png)

### CODEX CORE

Quick access to `config.toml` and `AGENTS.md`, plus shortcuts to open the `.codex` folder, launch the history view, and bidirectionally sync with a configured folder.

### PROMPTS EXPLORE

Manage prompt files under `~/.codex/prompts`, and bidirectionally sync them with a configured folder.

### SKILLS EXPLORE

Manage skill files under `~/.codex/skills`, and bidirectionally sync them with a configured folder.

### TEMPLATE EXPLORE

Manage template files under `~/.codex/codex-templates`, including template selection on file creation and bidirectional sync with a configured folder.

### MCP EXPLORE

View MCP servers from `config.toml` and toggle them on or off.

### HISTORY VIEW (EDITOR WEBVIEW)

Open Codex CLI sessions from `$CODEX_HOME/sessions/.../rollout-*.jsonl` in an editor WebView with a 2-pane layout:
- Left: date tree and session cards (newest first)
- Right: markdown-rendered conversation preview (`user_message` and `task_complete.last_agent_message` only)
- Search: explicit run (button/Enter), case-insensitive partial match on card titles, clear to reset

## USAGE

1. Ensure `~/.codex` exists.
2. Open **Codex Workspace** from the Activity Bar.
3. Use the view title buttons to add files/folders, open the root folder, or sync with a configured folder.
4. Click a file to open it in the editor.
5. Open conversation history from the Codex Core history button or from the Command Palette command.

## Privacy/Telemetry

This extension does not send any usage data (telemetry).

## License

MIT
