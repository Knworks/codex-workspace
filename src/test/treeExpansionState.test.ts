import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { TreeExpansionState } from '../services/treeExpansionState';

suite('Tree expansion state', () => {
	test('renames expanded paths under renamed folder', () => {
		const state = new TreeExpansionState();
		const rootPath = path.join('root', 'docs');
		const childPath = path.join(rootPath, 'child');
		state.registerExpanded(
			'prompts',
			new CodexTreeItem(
				'folder',
				'prompts',
				'docs',
				vscode.TreeItemCollapsibleState.Collapsed,
				rootPath,
			),
		);
		state.registerExpanded(
			'prompts',
			new CodexTreeItem(
				'folder',
				'prompts',
				'child',
				vscode.TreeItemCollapsibleState.Collapsed,
				childPath,
			),
		);

		const renamedRoot = path.join('root', 'docs-renamed');
		state.renamePaths('prompts', rootPath, renamedRoot);

		const expanded = state.listExpanded('prompts').sort();
		assert.deepStrictEqual(expanded, [renamedRoot, path.join(renamedRoot, 'child')].sort());
	});

	test('collapsed paths are removed from expansion state', () => {
		const state = new TreeExpansionState();
		const rootPath = path.join('root', 'docs');
		const item = new CodexTreeItem(
			'folder',
			'prompts',
			'docs',
			vscode.TreeItemCollapsibleState.Collapsed,
			rootPath,
		);
		state.registerExpanded('prompts', item);
		state.registerCollapsed('prompts', item);

		assert.deepStrictEqual(state.listExpanded('prompts'), []);
	});
});
