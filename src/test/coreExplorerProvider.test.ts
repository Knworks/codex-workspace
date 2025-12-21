import * as assert from 'assert';
import * as vscode from 'vscode';
import { CoreExplorerProvider } from '../views/coreExplorerProvider';
import { getUnavailableLabel } from '../services/workspaceStatus';

suite('Core explorer provider', () => {
	test('returns core items when available', () => {
		const provider = new CoreExplorerProvider(() => ({ isAvailable: true }));
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 2);
		assert.strictEqual(items[0].label, 'config.toml');
		assert.strictEqual(items[1].label, 'AGENTS.md');
	});

	test('returns unavailable item when not available', () => {
		const provider = new CoreExplorerProvider(() => ({
			isAvailable: false,
			reason: 'missing',
		}));
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, getUnavailableLabel('missing'));
	});

	test('config and agent items carry open command', () => {
		const provider = new CoreExplorerProvider(() => ({ isAvailable: true }));
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
});
