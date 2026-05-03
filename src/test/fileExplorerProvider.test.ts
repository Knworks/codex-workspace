import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { FileExplorerProvider } from '../views/fileExplorerProvider';
import { getUnavailableLabel } from '../services/workspaceStatus';

const contextStub = {
	asAbsolutePath: (target: string) => path.join('root', target),
} as vscode.ExtensionContext;

suite('File explorer provider', () => {
	test('returns root children when available', () => {
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
			],
		);
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, 'docs');
		assert.strictEqual(
			items[0].collapsibleState,
			vscode.TreeItemCollapsibleState.Collapsed,
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
		const children = provider.getChildren() as vscode.TreeItem[];
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
				{
					name: 'config.yml',
					fullPath: path.join('root', 'config.yml'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: 'document.docx',
					fullPath: path.join('root', 'document.docx'),
					isDirectory: false,
					isFile: true,
				},
				{
					name: 'favicon.ico',
					fullPath: path.join('root', 'favicon.ico'),
					isDirectory: false,
					isFile: true,
				},
			],
		);

		// Act
		const children = provider.getChildren() as vscode.TreeItem[];
		const byLabel = (label: string): vscode.TreeItem =>
			children.find((item) => item.label === label) as vscode.TreeItem;
		const folderItem = byLabel('docs');
		const markdownItem = byLabel('note.md');
		const pythonItem = byLabel('script.py');
		const defaultItem = byLabel('plain.txt');
		const settingsItem = byLabel('config.yml');
		const wordItem = byLabel('document.docx');
		const iconItem = byLabel('favicon.ico');
		const expectedIconPath = (fileName: string): string =>
			vscode.Uri.file(
				contextStub.asAbsolutePath(path.join('images', fileName)),
			).fsPath;

		// Assert
		const folderIconPath = folderItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			folderIconPath.light.fsPath,
			expectedIconPath('folder32.png'),
		);
		assert.strictEqual(
			folderIconPath.dark.fsPath,
			expectedIconPath('folder32.png'),
		);

		const markdownIconPath = markdownItem.iconPath as {
			light: vscode.Uri;
			dark: vscode.Uri;
		};
		assert.strictEqual(
			markdownIconPath.light.fsPath,
			expectedIconPath('markdown32.png'),
		);
		assert.strictEqual(
			markdownIconPath.dark.fsPath,
			expectedIconPath('markdown32.png'),
		);

		const pythonIconPath = pythonItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			pythonIconPath.light.fsPath,
			expectedIconPath('python32.png'),
		);
		assert.strictEqual(
			pythonIconPath.dark.fsPath,
			expectedIconPath('python32.png'),
		);

		const defaultIconPath = defaultItem.iconPath as {
			light: vscode.Uri;
			dark: vscode.Uri;
		};
		assert.strictEqual(
			defaultIconPath.light.fsPath,
			expectedIconPath('text32.png'),
		);
		assert.strictEqual(
			defaultIconPath.dark.fsPath,
			expectedIconPath('text32.png'),
		);

		const settingsIconPath = settingsItem.iconPath as {
			light: vscode.Uri;
			dark: vscode.Uri;
		};
		assert.strictEqual(
			settingsIconPath.light.fsPath,
			expectedIconPath('settingsfile32.png'),
		);
		assert.strictEqual(
			settingsIconPath.dark.fsPath,
			expectedIconPath('settingsfile32.png'),
		);

		const wordIconPath = wordItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			wordIconPath.light.fsPath,
			expectedIconPath('office_word32.png'),
		);
		assert.strictEqual(
			wordIconPath.dark.fsPath,
			expectedIconPath('office_word32.png'),
		);

		const iconIconPath = iconItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			iconIconPath.light.fsPath,
			expectedIconPath('image32.png'),
		);
		assert.strictEqual(
			iconIconPath.dark.fsPath,
			expectedIconPath('image32.png'),
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
		const children = provider.getChildren() as vscode.TreeItem[];
		const labels = children.map((item) => item.label as string);

		// Assert
		assert.deepStrictEqual(labels, ['public', 'visible.md']);
	});

	test('skills explorer combines multiple skill locations with location metadata', () => {
		const entriesByRoot = new Map([
			[
				path.join(process.env.HOME ?? '', '.codex', 'skills'),
				[
					{
						name: 'workspace-skill',
						fullPath: path.join(process.env.HOME ?? '', '.codex', 'skills', 'workspace-skill'),
						isDirectory: true,
						isFile: false,
					},
				],
			],
			[
				path.join(process.env.HOME ?? '', '.agents', 'skills'),
				[
					{
						name: 'user-skill',
						fullPath: path.join(process.env.HOME ?? '', '.agents', 'skills', 'user-skill'),
						isDirectory: true,
						isFile: false,
					},
				],
			],
		]);
		const provider = new FileExplorerProvider(
			'skills',
			contextStub,
			() => ({ isAvailable: true }),
			undefined,
			(targetPath) => entriesByRoot.get(targetPath) ?? [],
		);

		const children = provider.getChildren() as vscode.TreeItem[];
		assert.ok(children.some((item) => item.label === 'workspace-skill'));
		assert.ok(children.some((item) => item.label === 'user-skill'));
		const userSkill = children.find((item) => item.label === 'user-skill');
		assert.ok(String(userSkill?.tooltip).includes('User Skills'));
	});

	test('skills explorer shows status icons only for skill root folders and SKILL.md', () => {
		const workspaceSkillsRoot = path.join(process.env.HOME ?? '', '.codex', 'skills');
		const enabledSkillRoot = path.join(workspaceSkillsRoot, 'enabled-skill');
		const disabledSkillRoot = path.join(workspaceSkillsRoot, 'disabled-skill');
		const entriesByRoot = new Map<string, Array<{
			name: string;
			fullPath: string;
			isDirectory: boolean;
			isFile: boolean;
		}>>([
			[
				workspaceSkillsRoot,
				[
					{
						name: 'enabled-skill',
						fullPath: enabledSkillRoot,
						isDirectory: true,
						isFile: false,
					},
					{
						name: 'disabled-skill',
						fullPath: disabledSkillRoot,
						isDirectory: true,
						isFile: false,
					},
					{
						name: 'notes',
						fullPath: path.join(workspaceSkillsRoot, 'notes'),
						isDirectory: true,
						isFile: false,
					},
				],
			],
			[
				enabledSkillRoot,
				[
					{
						name: 'SKILL.md',
						fullPath: path.join(enabledSkillRoot, 'SKILL.md'),
						isDirectory: false,
						isFile: true,
					},
					{
						name: 'guide.md',
						fullPath: path.join(enabledSkillRoot, 'guide.md'),
						isDirectory: false,
						isFile: true,
					},
					{
						name: 'examples',
						fullPath: path.join(enabledSkillRoot, 'examples'),
						isDirectory: true,
						isFile: false,
					},
				],
			],
			[
				disabledSkillRoot,
				[
					{
						name: 'SKILL.md',
						fullPath: path.join(disabledSkillRoot, 'SKILL.md'),
						isDirectory: false,
						isFile: true,
					},
				],
			],
			[
				path.join(workspaceSkillsRoot, 'notes'),
				[],
			],
		]);
		const enabledByPath = new Map<string, boolean>([
			[path.resolve(path.join(disabledSkillRoot, 'SKILL.md')), false],
		]);
		const provider = new FileExplorerProvider(
			'skills',
			contextStub,
			() => ({ isAvailable: true }),
			undefined,
			(targetPath) => entriesByRoot.get(targetPath) ?? [],
			() => enabledByPath,
		);

		const rootChildren = provider.getChildren() as vscode.TreeItem[];
		const byLabel = (items: vscode.TreeItem[], label: string): vscode.TreeItem =>
			items.find((item) => item.label === label) as vscode.TreeItem;

		const enabledRoot = byLabel(rootChildren, 'enabled-skill');
		assert.ok(enabledRoot.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((enabledRoot.iconPath as vscode.ThemeIcon).id, 'folder-library');

		const disabledRoot = byLabel(rootChildren, 'disabled-skill');
		assert.ok(disabledRoot.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((disabledRoot.iconPath as vscode.ThemeIcon).id, 'circle-slash');
		assert.strictEqual(
			(disabledRoot.iconPath as vscode.ThemeIcon).color?.id,
			'disabledForeground',
		);

		const normalRoot = byLabel(rootChildren, 'notes');
		const normalRootIcon = normalRoot.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			normalRootIcon.light.fsPath,
			vscode.Uri.file(contextStub.asAbsolutePath(path.join('images', 'folder32.png'))).fsPath,
		);

		const enabledChildren = provider.getChildren(enabledRoot as CodexTreeItem) as vscode.TreeItem[];
		const skillFile = byLabel(enabledChildren, 'SKILL.md');
		assert.ok(skillFile.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((skillFile.iconPath as vscode.ThemeIcon).id, 'agent');

		const guideFile = byLabel(enabledChildren, 'guide.md');
		const guideIcon = guideFile.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			guideIcon.light.fsPath,
			vscode.Uri.file(contextStub.asAbsolutePath(path.join('images', 'markdown32.png'))).fsPath,
		);

		const examplesFolder = byLabel(enabledChildren, 'examples');
		const examplesIcon = examplesFolder.iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			examplesIcon.light.fsPath,
			vscode.Uri.file(contextStub.asAbsolutePath(path.join('images', 'folder32.png'))).fsPath,
		);

		const disabledChildren = provider.getChildren(disabledRoot as CodexTreeItem) as vscode.TreeItem[];
		const disabledSkillFile = byLabel(disabledChildren, 'SKILL.md');
		assert.ok(disabledSkillFile.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((disabledSkillFile.iconPath as vscode.ThemeIcon).id, 'circle-slash');
		assert.strictEqual(
			(disabledSkillFile.iconPath as vscode.ThemeIcon).color?.id,
			'disabledForeground',
		);
	});
});
