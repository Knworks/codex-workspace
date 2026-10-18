import * as vscode from 'vscode';
import type { AgentManagerRecord } from '../services/agentManagerService';

export type FileViewKind = 'prompts' | 'skills' | 'templates';
export type NodeKind = FileViewKind | 'core' | 'mcp' | 'agents';
export type NodeType = 'root' | 'folder' | 'file' | 'command' | 'mcpServer';

export class CodexTreeItem extends vscode.TreeItem {
	agentRecord?: AgentManagerRecord;
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
