import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { isRootNode, resolveSelectionForView } from '../commands/fileCommands';

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

	test('Given view selection When resolving Then returns selection', () => {
		const selection = new CodexTreeItem(
			'folder',
			'skills',
			'skills',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/skills',
		);
		const result = resolveSelectionForView(
			'skills',
			undefined,
			selection,
			'/root/skills',
		);

		assert.strictEqual(result, selection);
	});

	test('Given item from other view When resolving Then returns root', () => {
		const item = new CodexTreeItem(
			'folder',
			'prompts',
			'prompts',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/prompts',
		);
		const result = resolveSelectionForView(
			'skills',
			item,
			undefined,
			'/root/skills',
		);

		assert.strictEqual(result.nodeType, 'root');
		assert.strictEqual(result.fsPath, '/root/skills');
	});

	test('Given item in view When resolving Then returns item', () => {
		const item = new CodexTreeItem(
			'folder',
			'templates',
			'templates',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/templates',
		);
		const selection = new CodexTreeItem(
			'folder',
			'prompts',
			'prompts',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/prompts',
		);
		const result = resolveSelectionForView(
			'templates',
			item,
			selection,
			'/root/templates',
		);

		assert.strictEqual(result, item);
	});
});
