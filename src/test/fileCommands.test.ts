import * as assert from 'assert';
import path from 'path';
import {
	isCaseOnlyRename,
	isSamePath,
	requiresFolderSelectionForFileAdd,
	resolveAddViewSelection,
	shouldDeleteRenameTarget,
} from '../commands/fileCommands';
import { CodexTreeItem } from '../models/treeItems';

suite('File commands', () => {
	test('does not delete when source and target are identical', () => {
		const sourcePath = path.join('root', 'AGENTS.md');
		assert.strictEqual(shouldDeleteRenameTarget(sourcePath, sourcePath), false);
		assert.strictEqual(isSamePath(sourcePath, sourcePath), true);
	});

	test('detects case-only rename overwrite behavior', () => {
		const sourcePath = path.join('root', 'AGENTS.md');
		const targetPath = path.join('root', 'agents.md');
		const expected = process.platform === 'win32';
		assert.strictEqual(shouldDeleteRenameTarget(sourcePath, targetPath), !expected);
		assert.strictEqual(isCaseOnlyRename(sourcePath, targetPath), expected);
	});

test('resolveAddViewSelection ignores inactive selection', () => {
	const selection = new CodexTreeItem(
		'folder',
		'prompts',
		'docs',
		0,
		path.join('root', 'docs'),
	);
	const item = new CodexTreeItem(
		'folder',
		'prompts',
		'docs-2',
		0,
		path.join('root', 'docs-2'),
	);
	assert.strictEqual(
		resolveAddViewSelection(false, item, selection),
		undefined,
	);
});

	test('resolveAddViewSelection returns selection when active', () => {
		const selection = new CodexTreeItem(
			'folder',
			'prompts',
			'docs',
			0,
			path.join('root', 'docs'),
		);
		assert.strictEqual(resolveAddViewSelection(true, undefined, selection), selection);
	});

test('resolveAddViewSelection prefers item over selection', () => {
	const selection = new CodexTreeItem(
		'folder',
		'prompts',
		'docs',
		0,
		path.join('root', 'docs'),
	);
	const item = new CodexTreeItem(
		'folder',
		'prompts',
		'docs-2',
		0,
		path.join('root', 'docs-2'),
	);
	assert.strictEqual(resolveAddViewSelection(true, item, selection), item);
});

	test('requiresFolderSelectionForFileAdd requires a folder only for skills files', () => {
		const root = new CodexTreeItem(
			'root',
			'skills',
			'skills',
			0,
			path.join('root', 'skills'),
		);
		const file = new CodexTreeItem(
			'file',
			'skills',
			'guide.md',
			0,
			path.join('root', 'skills', 'sample', 'guide.md'),
		);
		const folder = new CodexTreeItem(
			'folder',
			'skills',
			'sample',
			0,
			path.join('root', 'skills', 'sample'),
		);
		const promptFolder = new CodexTreeItem(
			'folder',
			'prompts',
			'docs',
			0,
			path.join('root', 'prompts', 'docs'),
		);

		assert.strictEqual(requiresFolderSelectionForFileAdd(root), true);
		assert.strictEqual(requiresFolderSelectionForFileAdd(file), true);
		assert.strictEqual(requiresFolderSelectionForFileAdd(folder), false);
		assert.strictEqual(requiresFolderSelectionForFileAdd(promptFolder), false);
	});
});
