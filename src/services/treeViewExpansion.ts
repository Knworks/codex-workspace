import * as vscode from 'vscode';
import { CodexTreeItem, FileViewKind } from '../models/treeItems';

export async function expandParentFolder(
	selection: CodexTreeItem,
	views: Record<FileViewKind, vscode.TreeView<CodexTreeItem>>,
): Promise<void> {
	if (
		selection.kind !== 'prompts' &&
		selection.kind !== 'skills' &&
		selection.kind !== 'templates'
	) {
		return;
	}

	try {
		await views[selection.kind].reveal(selection, {
			expand: true,
			focus: false,
			select: false,
		});
	} catch (error) {
		console.error(error);
	}
}
