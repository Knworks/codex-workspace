import * as vscode from 'vscode';

export type FileViewKind = 'prompts' | 'skills' | 'templates';
export type NodeKind = FileViewKind | 'core' | 'mcp';
export type NodeType = 'root' | 'folder' | 'file' | 'command' | 'mcpServer';

export class CodexTreeItem extends vscode.TreeItem {
	constructor(
		public readonly nodeType: NodeType,
		public readonly kind: NodeKind,
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly fsPath?: string,
	) {
		super(label, collapsibleState);
	}
}
