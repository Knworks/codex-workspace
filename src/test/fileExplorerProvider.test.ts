import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileExplorerProvider } from '../views/fileExplorerProvider';
import { getUnavailableLabel } from '../services/workspaceStatus';

const contextStub = {
	asAbsolutePath: (target: string) => path.join('root', target),
} as vscode.ExtensionContext;

suite('File explorer provider', () => {
	test('returns root item when available', () => {
		const provider = new FileExplorerProvider(
			'prompts',
			contextStub,
			() => ({ isAvailable: true }),
			'root',
		);
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, 'prompts');
		assert.strictEqual(
			items[0].collapsibleState,
			vscode.TreeItemCollapsibleState.Expanded,
		);
	});

	test('returns unavailable item when not available', () => {
		const provider = new FileExplorerProvider(
			'prompts',
			contextStub,
			() => ({ isAvailable: false, reason: 'missing' }),
			'root',
		);
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, getUnavailableLabel('missing'));
	});

	test('file items include open command', () => {
		const provider = new FileExplorerProvider(
			'prompts',
			contextStub,
			() => ({ isAvailable: true }),
			'root',
			() => [
				{
					name: 'note.md',
					fullPath: path.join('root', 'note.md'),
					isDirectory: false,
					isFile: true,
				},
			],
		);
		const roots = provider.getChildren() as vscode.TreeItem[];
		const rootItem = roots[0] as vscode.TreeItem;
		const children = provider.getChildren(rootItem as never) as vscode.TreeItem[];
		assert.strictEqual(children.length, 1);
		const fileItem = children[0];
		assert.strictEqual(fileItem.command?.command, 'codex-workspace.openFile');
	});

	test('Given file types When listing children Then icons match', () => {
		// Arrange
		const provider = new FileExplorerProvider(
			'prompts',
			contextStub,
			() => ({ isAvailable: true }),
			'root',
			() => [
				{
					name: 'docs',
					fullPath: path.join('root', 'docs'),
					isDirectory: true,
					isFile: false,
				},
				{
					name: 'note.md',
					fullPath: path.join('root', 'note.md'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: 'script.py',
					fullPath: path.join('root', 'script.py'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: 'plain.txt',
					fullPath: path.join('root', 'plain.txt'),
					isDirectory: false,
					isFile: true,
				},
			],
		);

		// Act
		const roots = provider.getChildren() as vscode.TreeItem[];
		const rootItem = roots[0] as vscode.TreeItem;
		const children = provider.getChildren(rootItem as never) as vscode.TreeItem[];
		const byLabel = (label: string): vscode.TreeItem =>
			children.find((item) => item.label === label) as vscode.TreeItem;
		const folderItem = byLabel('docs');
		const markdownItem = byLabel('note.md');
		const pythonItem = byLabel('script.py');
		const defaultItem = byLabel('plain.txt');

		// Assert
		const folderIconPath = folderItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			folderIconPath.light.fsPath,
			path.join('root', 'images', 'folder32.png'),
		);
		assert.strictEqual(
			folderIconPath.dark.fsPath,
			path.join('root', 'images', 'folder32.png'),
		);

		const markdownIconPath = markdownItem.iconPath as {
			light: vscode.Uri;
			dark: vscode.Uri;
		};
		assert.strictEqual(
			markdownIconPath.light.fsPath,
			path.join('root', 'images', 'markdown32.png'),
		);
		assert.strictEqual(
			markdownIconPath.dark.fsPath,
			path.join('root', 'images', 'markdown32.png'),
		);

		const pythonIconPath = pythonItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			pythonIconPath.light.fsPath,
			path.join('root', 'images', 'python32.png'),
		);
		assert.strictEqual(
			pythonIconPath.dark.fsPath,
			path.join('root', 'images', 'python32.png'),
		);

		const defaultIconPath = defaultItem.iconPath as {
			light: vscode.Uri;
			dark: vscode.Uri;
		};
		assert.strictEqual(
			defaultIconPath.light.fsPath,
			path.join('root', 'images', 'text32.png'),
		);
		assert.strictEqual(
			defaultIconPath.dark.fsPath,
			path.join('root', 'images', 'text32.png'),
		);
	});

	test('Given hidden entries When listing children Then they are excluded', () => {
		// Arrange
		const provider = new FileExplorerProvider(
			'prompts',
			contextStub,
			() => ({ isAvailable: true }),
			'root',
			() => [
				{
					name: '.hidden.md',
					fullPath: path.join('root', '.hidden.md'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: 'visible.md',
					fullPath: path.join('root', 'visible.md'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: '.secret',
					fullPath: path.join('root', '.secret'),
					isDirectory: true,
					isFile: false,
				},
				{
					name: 'public',
					fullPath: path.join('root', 'public'),
					isDirectory: true,
					isFile: false,
				},
			],
		);

		// Act
		const roots = provider.getChildren() as vscode.TreeItem[];
		const rootItem = roots[0] as vscode.TreeItem;
		const children = provider.getChildren(rootItem as never) as vscode.TreeItem[];
		const labels = children.map((item) => item.label as string);

		// Assert
		assert.deepStrictEqual(labels, ['visible.md', 'public']);
	});
});
