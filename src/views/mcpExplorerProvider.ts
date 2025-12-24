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
			const item = new CodexTreeItem(
				'mcpServer',
				'mcp',
				server.id,
				vscode.TreeItemCollapsibleState.None,
			);
			item.contextValue = 'codex-mcp-server';
			item.command = {
				command: 'codex-workspace.mcp.toggle',
				title: 'Toggle MCP',
				arguments: [server.id],
			};
			const iconFileName = server.enabled ? 'status_run32.png' : 'status_run_grey32.png';
			const iconPath = this.context.asAbsolutePath(path.join('images', iconFileName));
			const iconUri = vscode.Uri.file(iconPath);
			item.iconPath = { light: iconUri, dark: iconUri };
			return item;
		});
	}
}
