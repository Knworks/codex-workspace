import * as vscode from 'vscode';
import { CodexTreeDataProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import { readMcpServers } from '../services/mcpService';
import { resolveCodexPaths } from '../services/workspaceStatus';

export class McpExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	constructor(_context: vscode.ExtensionContext) {
		super();
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
			item.iconPath = server.enabled
				? new vscode.ThemeIcon('mcp')
				: new vscode.ThemeIcon(
						'circle-slash',
						new vscode.ThemeColor('disabledForeground'),
					);
			return item;
		});
	}
}
