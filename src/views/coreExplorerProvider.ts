import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';

export class CoreExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext, statusProvider?: WorkspaceStatusProvider) {
		super(statusProvider);
		this.context = context;
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
		configItem.iconPath = this.getIcon('settingsfile32.png');

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
		agentItem.iconPath = this.getIcon('markdown32.png');

		return [configItem, agentItem];
	}

	private getIcon(fileName: string): { light: vscode.Uri; dark: vscode.Uri } {
		const iconPath = this.context.asAbsolutePath(path.join('images', fileName));
		const iconUri = vscode.Uri.file(iconPath);
		return { light: iconUri, dark: iconUri };
	}
}
