import * as vscode from 'vscode';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';

export class EmptyExplorerProvider extends CodexTreeDataProvider<vscode.TreeItem> {
	constructor(statusProvider?: WorkspaceStatusProvider) {
		super(statusProvider);
	}

	protected getAvailableChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
		return [];
	}
}
