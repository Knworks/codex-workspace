import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { CodexTreeItem } from '../models/treeItems';
import {
	getCoreWorkspaceStatus,
	getWorkspaceStatus,
	resolveCodexPaths,
} from '../services/workspaceStatus';

export class CoreExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly context: vscode.ExtensionContext;
	private readonly configStatusProvider: WorkspaceStatusProvider;

	constructor(
		context: vscode.ExtensionContext,
		statusProvider: WorkspaceStatusProvider = getCoreWorkspaceStatus,
		configStatusProvider: WorkspaceStatusProvider = getWorkspaceStatus,
	) {
		super(statusProvider);
		this.context = context;
		this.configStatusProvider = configStatusProvider;
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const paths = resolveCodexPaths();
		const configStatus = this.configStatusProvider();
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
		if (!configStatus.isAvailable && configStatus.reason) {
			configItem.tooltip = configStatus.reason;
			configItem.iconPath = new vscode.ThemeIcon('warning');
		} else {
			configItem.iconPath = this.getIcon('settingsfile32.png');
		}

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
		agentItem.iconPath = this.getIcon('agents_light.png', 'agents_dark.png');

		const items = [configItem, agentItem];
		const overridePath = path.join(paths.codexDir, 'AGENTS.override.md');
		if (fs.existsSync(overridePath)) {
			const overrideItem = new CodexTreeItem(
				'file',
				'core',
				'AGENTS.override.md',
				vscode.TreeItemCollapsibleState.None,
				overridePath,
			);
			overrideItem.command = {
				command: 'codex-workspace.openFile',
				title: 'Open AGENTS.override.md',
				arguments: [overrideItem],
			};
			overrideItem.iconPath = this.getIcon('agents_light.png', 'agents_dark.png');
			items.push(overrideItem);
		}

		return items;
	}

	private getIcon(
		lightFileName: string,
		darkFileName?: string,
	): { light: vscode.Uri; dark: vscode.Uri } {
		const lightPath = this.context.asAbsolutePath(
			path.join('images', lightFileName),
		);
		const darkPath = this.context.asAbsolutePath(
			path.join('images', darkFileName ?? lightFileName),
		);
		return {
			light: vscode.Uri.file(lightPath),
			dark: vscode.Uri.file(darkPath),
		};
	}
}
