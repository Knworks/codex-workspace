import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getUnavailableLabel } from '../services/workspaceStatus';
import {
	AgentExplorerProvider,
	parseEnabledAgentIds,
} from '../views/agentExplorerProvider';

const contextStub = {
	asAbsolutePath: (target: string) => path.join('root', target),
} as vscode.ExtensionContext;

suite('Agent explorer provider', () => {
	test('returns only .toml files with open command and status icons', () => {
		const provider = new AgentExplorerProvider(
			contextStub,
			() => ({ isAvailable: true }),
			() => [
				{
					name: 'beta.toml',
					fullPath: path.join('root', 'agents', 'beta.toml'),
					isFile: true,
				},
				{
					name: 'alpha.toml',
					fullPath: path.join('root', 'agents', 'alpha.toml'),
					isFile: true,
				},
				{
					name: 'README.md',
					fullPath: path.join('root', 'agents', 'README.md'),
					isFile: true,
				},
				{
					name: 'nested',
					fullPath: path.join('root', 'agents', 'nested'),
					isFile: false,
				},
			],
			() => new Set(['alpha']),
		);

		const items = provider.getChildren() as vscode.TreeItem[];
		assert.deepStrictEqual(
			items.map((item) => item.label),
			['alpha.toml', 'beta.toml'],
		);
		assert.strictEqual(items[0].command?.command, 'codex-workspace.openFile');
		assert.strictEqual(items[1].command?.command, 'codex-workspace.openFile');
		assert.strictEqual(items[0].contextValue, 'codex-agent-file-enabled');
		assert.strictEqual(items[1].contextValue, 'codex-agent-file-disabled');

		const expectedIconPath = (fileName: string): string =>
			vscode.Uri.file(
				contextStub.asAbsolutePath(path.join('images', fileName)),
			).fsPath;

		const alphaIconPath = items[0].iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(alphaIconPath.light.fsPath, expectedIconPath('agent_on.png'));
		assert.strictEqual(alphaIconPath.dark.fsPath, expectedIconPath('agent_on.png'));

		const betaIconPath = items[1].iconPath as { light: vscode.Uri; dark: vscode.Uri };
		assert.strictEqual(betaIconPath.light.fsPath, expectedIconPath('agent_off.png'));
		assert.strictEqual(betaIconPath.dark.fsPath, expectedIconPath('agent_off.png'));
	});

	test('returns unavailable item when not available', () => {
		const provider = new AgentExplorerProvider(
			contextStub,
			() => ({ isAvailable: false, reason: 'missing' }),
			() => [],
			() => new Set<string>(),
		);
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, getUnavailableLabel('missing'));
	});

	test('parseEnabledAgentIds parses normal and quoted headers', () => {
		const parsed = parseEnabledAgentIds([
			'[agents.alpha]',
			'description = "Alpha"',
			'[agents."beta-prod"]',
			'description = "Beta"',
		].join('\n'));
		assert.deepStrictEqual(Array.from(parsed).sort(), ['alpha', 'beta-prod']);
	});
});
