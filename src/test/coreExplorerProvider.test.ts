import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { CoreExplorerProvider } from '../views/coreExplorerProvider';
import { getUnavailableLabel } from '../services/workspaceStatus';

const contextStub = {
	asAbsolutePath: (target: string) => path.join('root', target),
} as vscode.ExtensionContext;

suite('Core explorer provider', () => {
	test('returns core items when available', () => {
		const provider = new CoreExplorerProvider(contextStub, () => ({ isAvailable: true }));
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 2);
		assert.strictEqual(items[0].label, 'config.toml');
		assert.strictEqual(items[1].label, 'AGENTS.md');
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
			expectedIconPath('markdown32.png'),
		);
		assert.strictEqual(
			agentIconPath.dark.fsPath,
			expectedIconPath('markdown32.png'),
		);
	});
});
