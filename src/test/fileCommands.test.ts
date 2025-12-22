import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { isRootNode } from '../commands/fileCommands';

suite('File commands', () => {
	test('Given root node When checking Then returns true', () => {
		const item = new CodexTreeItem(
			'root',
			'prompts',
			'prompts',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/prompts',
		);

		assert.strictEqual(isRootNode(item), true);
	});

	test('Given folder node When checking Then returns false', () => {
		const item = new CodexTreeItem(
			'folder',
			'prompts',
			'docs',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/prompts/docs',
		);

		assert.strictEqual(isRootNode(item), false);
	});
});
