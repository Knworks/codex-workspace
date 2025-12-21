import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';

export class CoreExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	constructor(statusProvider?: WorkspaceStatusProvider) {
		super(statusProvider);
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const paths = resolveCodexPaths();
		const configItem = new CodexTreeItem(
			'file',
			'core',
			'config.toml',
			vscode.TreeItemCollapsibleState.None,
			paths.configPath,
		);
		configItem.command = {
			command: 'codex-workspace.openFile',
			title: 'Open config.toml',
			arguments: [configItem],
		};

		const agentItem = new CodexTreeItem(
			'file',
			'core',
			'AGENTS.md',
			vscode.TreeItemCollapsibleState.None,
			path.join(paths.codexDir, 'AGENTS.md'),
		);
		agentItem.command = {
			command: 'codex-workspace.openFile',
			title: 'Open AGENTS.md',
			arguments: [agentItem],
		};

		return [configItem, agentItem];
	}
}
