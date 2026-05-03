import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getUnavailableLabel } from '../services/workspaceStatus';
import {
	AgentExplorerProvider,
	parseEnabledAgentIds,
} from '../views/agentExplorerProvider';

const contextStub = {} as vscode.ExtensionContext;

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
			() => [
				{
					kind: 'workspace',
					label: 'Workspace Agents',
					rootPath: path.join('root', 'agents'),
					priority: 2,
				},
			],
		);

		const items = provider.getChildren() as vscode.TreeItem[];
		assert.deepStrictEqual(
			items.map((item) => item.label),
			['alpha.toml', 'beta.toml'],
		);
		assert.strictEqual(items[0].command?.command, 'codex-workspace.openFile');
		assert.strictEqual(items[1].command?.command, 'codex-workspace.openFile');
		assert.strictEqual(items[0].contextValue, 'codex-agent-file');
		assert.strictEqual(items[1].contextValue, 'codex-agent-file');
		assert.strictEqual(items[0].description, 'Workspace Agents');

		assert.ok(items[0].iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).id, 'hubot');
		assert.strictEqual((items[0].iconPath as vscode.ThemeIcon).color, undefined);

		assert.ok(items[1].iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((items[1].iconPath as vscode.ThemeIcon).id, 'circle-slash');
		assert.strictEqual(
			(items[1].iconPath as vscode.ThemeIcon).color?.id,
			'disabledForeground',
		);
	});

	test('returns unavailable item when not available', () => {
		const provider = new AgentExplorerProvider(
			contextStub,
			() => ({ isAvailable: false, reason: 'missing' }),
			() => [],
			() => new Set<string>(),
			() => [],
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
