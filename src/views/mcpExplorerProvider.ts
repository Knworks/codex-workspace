import * as vscode from 'vscode';
import { CodexTreeDataProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import { messages } from '../i18n';
import { readMcpServers } from '../services/mcpService';
import { resolveCodexPaths } from '../services/workspaceStatus';
import { listPluginMcpRecords } from '../services/pluginService';

export class McpExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	constructor(_context: vscode.ExtensionContext) {
		super();
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const configPath = resolveCodexPaths().configPath;
		const servers = readMcpServers(configPath);
		const normalItems = servers.map((server) => {
			const item = new CodexTreeItem(
				'mcpServer',
				'mcp',
				server.id,
				vscode.TreeItemCollapsibleState.None,
			);
			item.contextValue = 'codex-mcp-server';
			item.command = {
				command: 'codex-workspace.mcp.toggle',
				title: messages.mcpToggleAction,
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
		const normalIds = new Set(servers.map((server) => server.id));
		const pluginItems = listPluginMcpRecords({ configPath, normalMcpIds: normalIds }).map((server) => {
			const item = new CodexTreeItem(
				'mcpServer',
				'mcp',
				server.name,
				vscode.TreeItemCollapsibleState.None,
			);
			item.id = `plugin-mcp:${server.pluginId}:${server.definitionPath}:${server.name}`;
			item.contextValue = 'codex-plugin-mcp-server';
			item.description = server.pluginDisplayName;
			item.tooltip = `${server.pluginDisplayName}: ${server.name}\n${server.definitionPath}`;
			item.iconPath = server.enabled && !server.conflict
				? new vscode.ThemeIcon('plug')
				: new vscode.ThemeIcon(
					server.conflict ? 'warning' : 'circle-slash',
					new vscode.ThemeColor(server.conflict ? 'editorWarning.foreground' : 'disabledForeground'),
				);
			return item;
		});
		return [...normalItems, ...pluginItems];
	}
}
