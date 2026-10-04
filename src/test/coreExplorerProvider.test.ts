import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoreExplorerProvider } from '../views/coreExplorerProvider';
import { getUnavailableLabel } from '../services/workspaceStatus';
import { CodexTreeItem } from '../models/treeItems';

const contextStub = {
	asAbsolutePath: (target: string) => path.join('root', target),
} as vscode.ExtensionContext;

suite('Core explorer provider', () => {
	let codexDir: string;
	let originalCodexHome: string | undefined;

	setup(() => {
		originalCodexHome = process.env.CODEX_HOME;
		codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-core-'));
		process.env.CODEX_HOME = codexDir;
		fs.writeFileSync(path.join(codexDir, 'config.toml'), 'title = "ok"', 'utf8');
	});

	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		fs.rmSync(codexDir, { recursive: true, force: true });
	});

	test('lists only direct profile config files with names and open commands', () => {
		fs.writeFileSync(path.join(codexDir, 'work.config.toml'), 'invalid = [', 'utf8');
		fs.writeFileSync(path.join(codexDir, 'personal.config.toml'), '', 'utf8');
		fs.writeFileSync(path.join(codexDir, '.config.toml'), '', 'utf8');
		fs.writeFileSync(path.join(codexDir, 'other.toml'), '', 'utf8');
		fs.writeFileSync(path.join(codexDir, 'work.config.toml.bak'), '', 'utf8');
		fs.mkdirSync(path.join(codexDir, 'directory.config.toml'));
		fs.writeFileSync(path.join(codexDir, 'directory.config.toml', 'nested.config.toml'), '', 'utf8');

		const items = new CoreExplorerProvider(contextStub).getChildren() as CodexTreeItem[];
		assert.deepStrictEqual(items.map((item) => item.label), [
			'config.toml', 'personal.config.toml', 'work.config.toml', 'AGENTS.md',
		]);
		for (const item of items.slice(0, 3)) {
			assert.strictEqual(item.fsPath, path.join(codexDir, item.label as string));
			assert.strictEqual(item.command?.command, 'codex-workspace.openFile');
			assert.deepStrictEqual(item.command?.arguments, [item]);
			const icon = item.iconPath as { light: vscode.Uri; dark: vscode.Uri };
			assert.strictEqual(path.basename(icon.light.fsPath), 'settingsfile32.png');
		}
	});

	test('refreshes the list after profile configs are created and removed', () => {
		const provider = new CoreExplorerProvider(contextStub);
		assert.strictEqual((provider.getChildren() as CodexTreeItem[]).length, 2);
		const profilePath = path.join(codexDir, 'new.config.toml');
		fs.writeFileSync(profilePath, '', 'utf8');
		provider.refresh();
		assert.deepStrictEqual((provider.getChildren() as CodexTreeItem[]).map((item) => item.label), [
			'config.toml', 'new.config.toml', 'AGENTS.md',
		]);
		fs.unlinkSync(profilePath);
		provider.refresh();
		assert.strictEqual((provider.getChildren() as CodexTreeItem[]).length, 2);
	});
	test('returns core items when available', () => {
		const provider = new CoreExplorerProvider(contextStub, () => ({ isAvailable: true }));
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 2);
		assert.strictEqual(items[0].label, 'config.toml');
		assert.strictEqual(items[1].label, 'AGENTS.md');
	});

	test('returns AGENTS.override.md when it exists', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-core-'));
		const originalHome = process.env.HOME;
		const originalUserProfile = process.env.USERPROFILE;
		const originalHomeDrive = process.env.HOMEDRIVE;
		const originalHomePath = process.env.HOMEPATH;
		try {
			delete process.env.CODEX_HOME;
			process.env.HOME = tempDir;
			process.env.USERPROFILE = tempDir;
			process.env.HOMEDRIVE = '';
			process.env.HOMEPATH = tempDir;
			const codexDir = path.join(tempDir, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'AGENTS.override.md'), 'override', 'utf8');
			fs.writeFileSync(path.join(codexDir, 'default.config.toml'), '', 'utf8');

			const provider = new CoreExplorerProvider(contextStub, () => ({ isAvailable: true }));
			const items = provider.getChildren() as vscode.TreeItem[];
			assert.deepStrictEqual(
				items.map((item) => item.label),
				['config.toml', 'default.config.toml', 'AGENTS.md', 'AGENTS.override.md'],
			);
			assert.strictEqual((items[1] as CodexTreeItem).fsPath, path.join(codexDir, 'default.config.toml'));
		} finally {
			for (const [key, value] of Object.entries({
				HOME: originalHome,
				USERPROFILE: originalUserProfile,
				HOMEDRIVE: originalHomeDrive,
				HOMEPATH: originalHomePath,
			})) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('marks config item with warning when config is invalid but core is available', () => {
		const provider = new CoreExplorerProvider(
			contextStub,
			() => ({
				isAvailable: true,
				isConfigInvalid: true,
				reason: 'invalid config',
			}),
			() => ({
				isAvailable: false,
				reason: 'invalid config',
			}),
		);

		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items[0].label, 'config.toml');
		assert.strictEqual(items[0].tooltip, 'invalid config');
		assert.ok(items[0].iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).id, 'warning');
	});

	test('returns unavailable item when not available', () => {
		const provider = new CoreExplorerProvider(contextStub, () => ({
			isAvailable: false,
			reason: 'missing',
		}));
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, getUnavailableLabel('missing'));
	});

	test('config and agent items carry open command', () => {
		const provider = new CoreExplorerProvider(contextStub, () => ({ isAvailable: true }));
		const items = provider.getChildren() as vscode.TreeItem[];
		const configCommand = items[0].command;
		assert.ok(configCommand);
		assert.strictEqual(configCommand?.command, 'codex-workspace.openFile');
		assert.ok(
			typeof (configCommand?.arguments?.[0] as { fsPath?: string })?.fsPath === 'string',
		);

		const agentCommand = items[1].command;
		assert.ok(agentCommand);
		assert.strictEqual(agentCommand?.command, 'codex-workspace.openFile');
	});

	test('config and agent items carry file icons', () => {
		const provider = new CoreExplorerProvider(contextStub, () => ({ isAvailable: true }));
		const items = provider.getChildren() as vscode.TreeItem[];
		const expectedIconPath = (fileName: string): string =>
			vscode.Uri.file(
				contextStub.asAbsolutePath(path.join('images', fileName)),
			).fsPath;

		const configIconPath = items[0].iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			configIconPath.light.fsPath,
			expectedIconPath('settingsfile32.png'),
		);
		assert.strictEqual(
			configIconPath.dark.fsPath,
			expectedIconPath('settingsfile32.png'),
		);

		const agentIconPath = items[1].iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(
			agentIconPath.light.fsPath,
			expectedIconPath('agents_light.png'),
		);
		assert.strictEqual(
			agentIconPath.dark.fsPath,
			expectedIconPath('agents_dark.png'),
		);
	});
});
