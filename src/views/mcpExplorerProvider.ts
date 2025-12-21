import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeDataProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import { readMcpServers } from '../services/mcpService';
import { resolveCodexPaths } from '../services/workspaceStatus';

export class McpExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		super();
		this.context = context;
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const configPath = resolveCodexPaths().configPath;
		const servers = readMcpServers(configPath);
		return servers.map((server) => {
			const label = `${server.enabled ? '$(toggle-on)' : '$(toggle-off)'} ${server.id}`;
			const item = new CodexTreeItem(
				'mcpServer',
				'mcp',
				label,
				vscode.TreeItemCollapsibleState.None,
			);
			item.contextValue = 'codex-mcp-server';
			item.command = {
				command: 'codex-workspace.mcp.toggle',
				title: 'Toggle MCP',
				arguments: [server.id],
			};
			const iconPath = this.context.asAbsolutePath(path.join('images', 'mcp32.png'));
			const iconUri = vscode.Uri.file(iconPath);
			item.iconPath = { light: iconUri, dark: iconUri };
			return item;
		});
	}
}
