import * as assert from 'assert';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { expandParentFolder } from '../services/treeViewExpansion';

type RevealOptions = {
	expand?: boolean | number;
	focus?: boolean;
	select?: boolean;
};

suite('Tree view expansion', () => {
	test('Given root selection When expanding Then reveal is not called', async () => {
		// Arrange
		const reveals: Array<{
			item: CodexTreeItem;
			options: RevealOptions | undefined;
		}> = [];
		const viewStub = {
			reveal: async (
				item: CodexTreeItem,
				options?: RevealOptions,
			) => {
				reveals.push({ item, options });
			},
		} as unknown as vscode.TreeView<CodexTreeItem>;
		const views = {
			prompts: viewStub,
			skills: viewStub,
			templates: viewStub,
		};
		const selection = new CodexTreeItem(
			'root',
			'prompts',
			'prompts',
			vscode.TreeItemCollapsibleState.Expanded,
			'/root/prompts',
		);

		// Act
		await expandParentFolder(selection, views);

		// Assert
		assert.strictEqual(reveals.length, 0);
	});

	test('Given folder selection When expanding Then reveal is called', async () => {
		// Arrange
		const reveals: Array<{
			item: CodexTreeItem;
			options: RevealOptions | undefined;
		}> = [];
		const viewStub = {
			reveal: async (
				item: CodexTreeItem,
				options?: RevealOptions,
			) => {
				reveals.push({ item, options });
			},
		} as unknown as vscode.TreeView<CodexTreeItem>;
		const views = {
			prompts: viewStub,
			skills: viewStub,
			templates: viewStub,
		};
		const selection = new CodexTreeItem(
			'folder',
			'prompts',
			'prompts',
			vscode.TreeItemCollapsibleState.Collapsed,
			'/root/prompts',
		);

		// Act
		await expandParentFolder(selection, views);

		// Assert
		assert.strictEqual(reveals.length, 1);
		assert.strictEqual(reveals[0].item, selection);
		assert.deepStrictEqual(reveals[0].options, {
			expand: true,
			focus: false,
			select: false,
		});
	});

	test('Given file selection When expanding Then reveal is called', async () => {
		// Arrange
		const reveals: Array<{
			item: CodexTreeItem;
			options: RevealOptions | undefined;
		}> = [];
		const viewStub = {
			reveal: async (
				item: CodexTreeItem,
				options?: RevealOptions,
			) => {
				reveals.push({ item, options });
			},
		} as unknown as vscode.TreeView<CodexTreeItem>;
		const views = {
			prompts: viewStub,
			skills: viewStub,
			templates: viewStub,
		};
		const selection = new CodexTreeItem(
			'file',
			'prompts',
			'note.md',
			vscode.TreeItemCollapsibleState.None,
			'/root/prompts/note.md',
		);

		// Act
		await expandParentFolder(selection, views);

		// Assert
		assert.strictEqual(reveals.length, 1);
		assert.strictEqual(reveals[0].item, selection);
		assert.deepStrictEqual(reveals[0].options, {
			expand: true,
			focus: false,
			select: false,
		});
	});
});
