import * as vscode from 'vscode';
import { getUnavailableLabel, getWorkspaceStatus } from '../services/workspaceStatus';
import { messages } from '../i18n';

export type WorkspaceStatusProvider = () => { isAvailable: boolean; reason?: string };

export abstract class CodexTreeDataProvider<T extends vscode.TreeItem>
	implements vscode.TreeDataProvider<T>
{
	private readonly statusProvider: WorkspaceStatusProvider;
	private readonly changeEmitter = new vscode.EventEmitter<T | void>();

	constructor(statusProvider: WorkspaceStatusProvider = getWorkspaceStatus) {
		this.statusProvider = statusProvider;
	}

	get onDidChangeTreeData(): vscode.Event<T | void> {
		return this.changeEmitter.event;
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: T): vscode.TreeItem {
		return element;
	}

	getChildren(element?: T): vscode.ProviderResult<T[]> {
		const status = this.statusProvider();
		if (!status.isAvailable) {
			const label = getUnavailableLabel(status.reason ?? messages.unavailableUnknown);
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
			return [item as T];
		}

		return this.getAvailableChildren(element);
	}

	protected abstract getAvailableChildren(element?: T): vscode.ProviderResult<T[]>;
}
