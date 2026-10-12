import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	listFeatureFlagRecords,
	listHookDiagnostics,
	setFeatureFlag,
	createHooksJsonFile,
} from '../services/coreManagerConfigService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-manager-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Core manager config service', () => {
	const events = ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];
	const handlers = [
		{ type: 'command', command: 'echo "hello" # hook', timeout: 30, statusMessage: 'Running' },
		{ type: 'mcp_tool', server_name: 'local', tool_name: 'check', arguments: { mode: 'safe' } },
		{ type: 'prompt', prompt: 'Check <input> # carefully' },
		{ type: 'agent', prompt: 'Review changes', model: 'test-model' },
	];

	for (const format of ['hooks.json', 'inline'] as const) {
		test(`listHookDiagnostics recognizes all 12 events and 4 handlers in ${format}`, () => {
			withTempDir((root) => {
				const home = path.join(root, 'home');
				const codexDir = path.join(home, '.codex');
				const configPath = path.join(codexDir, 'config.toml');
				fs.mkdirSync(codexDir, { recursive: true });
				if (format === 'hooks.json') {
					fs.writeFileSync(path.join(codexDir, 'hooks.json'), JSON.stringify({
						hooks: Object.fromEntries(events.map((event) => [event, [{ matcher: '*', hooks: handlers }]])),
					}));
				} else {
					fs.writeFileSync(configPath, events.map((event) => [
						`[[hooks.${event}]]`, 'matcher = "*"',
						...handlers.flatMap((handler) => [
							`[[hooks.${event}.hooks]]`,
							...Object.entries(handler).map(([key, value]) => `${key} = ${typeof value === 'object' ? '{ mode = "safe" }' : JSON.stringify(value)}`),
						]),
					].join('\n')).join('\n'));
				}
				const result = listHookDiagnostics(configPath, home, root);
				assert.strictEqual(result.entries.length, 48);
				assert.strictEqual(result.sources.find((source) => source.layer === 'user' && source.format === format)?.entryCount, 48);
				for (const event of events) {
					const entries = result.entries.filter((entry) => entry.event === event);
					assert.deepStrictEqual(entries.map((entry) => entry.handlerType), handlers.map((handler) => handler.type));
					assert.deepStrictEqual(JSON.parse(JSON.stringify(entries.map((entry) => entry.handler))), handlers);
					assert.ok(entries.every((entry) => entry.supported && !entry.warning));
					assert.strictEqual(entries[0].command, handlers[0].command);
					assert.strictEqual(entries[0].timeout, 30);
					assert.strictEqual(entries[0].statusMessage, 'Running');
				}
			});
		});
	}

	test('read-save-read preserves known and unknown hooks in both file formats', () => {
		withTempDir((root) => {
			const home = path.join(root, 'home');
			const codexDir = path.join(home, '.codex');
			const configPath = path.join(codexDir, 'config.toml');
			const jsonPath = path.join(codexDir, 'hooks.json');
			fs.mkdirSync(codexDir, { recursive: true });
			const definitions = {
				Stop: [{ hooks: [...handlers, { type: 'future_handler', custom: { keep: true } }] }],
				'Future.Event': [{ hooks: [{ type: 'command', command: 'echo future', future_key: 'keep' }] }],
			};
			const jsonContents = JSON.stringify({ hooks: definitions, future_root: { keep: true } });
			fs.writeFileSync(jsonPath, jsonContents);
			fs.writeFileSync(configPath, [
				'[features]', 'hooks = true',
				'[[hooks.Stop]]', '[[hooks.Stop.hooks]]', 'type = "command"', 'command = "echo stop"',
				'[[hooks.Stop.hooks]]', 'type = "future_handler"', 'custom = { keep = true }',
				'[[hooks."Future.Event"]]', '[[hooks."Future.Event".hooks]]', 'type = "command"', 'command = "echo future"', 'future_key = "keep"',
				'[unrelated]', 'type = "prompt"', 'command = "must not overwrite hook"',
			].join('\n'));
			const before = listHookDiagnostics(configPath, home, root);
			assert.strictEqual(before.entries.length, 9);
			assert.strictEqual(before.entries.filter((entry) => !entry.supported).length, 4);
			assert.ok(before.entries.filter((entry) => !entry.supported).every((entry) => entry.warning));
			assert.strictEqual(before.entries.find((entry) => entry.format === 'inline' && entry.event === 'Future.Event')?.command, 'echo future');
			setFeatureFlag(configPath, 'hooks', false);
			assert.strictEqual(listHookDiagnostics(configPath, home, root).hooksEnabled, false);
			setFeatureFlag(configPath, 'hooks', true);
			createHooksJsonFile(jsonPath);
			const after = listHookDiagnostics(configPath, home, root);
			assert.deepStrictEqual(after.entries, before.entries);
			assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), jsonContents);
		});
	});

	test('invalid inline TOML reports a source warning without hiding valid JSON hooks', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir);
			const configPath = path.join(codexDir, 'config.toml');
			fs.writeFileSync(configPath, '[[hooks.Stop]\ntype = "command"');
			fs.writeFileSync(path.join(codexDir, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: handlers }] } }));
			const result = listHookDiagnostics(configPath, root, root);
			assert.ok(result.sources.find((source) => source.layer === 'user' && source.format === 'inline')?.warning);
			assert.strictEqual(result.entries.filter((entry) => entry.layer === 'user').length, 4);
		});
	});
	test('listFeatureFlagRecords uses defaults when config is missing', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');

			const flags = listFeatureFlagRecords(configPath);

			assert.strictEqual(
				flags.find((flag) => flag.key === 'codex_hooks')?.enabled,
				true,
			);
			assert.strictEqual(
				flags.find((flag) => flag.key === 'memories')?.enabled,
				false,
			);
		});
	});

	test('setFeatureFlag appends and updates the features table', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, 'model = "gpt-5.5"\n', 'utf8');

			setFeatureFlag(configPath, 'memories', true);
			setFeatureFlag(configPath, 'codex_hooks', false);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('[features]'));
			assert.ok(contents.includes('memories = true'));
			assert.ok(contents.includes('codex_hooks = false'));

			setFeatureFlag(configPath, 'memories', false);
			const updated = fs.readFileSync(configPath, 'utf8');
			assert.ok(updated.includes('memories = false'));
		});
	});

	test('setFeatureFlag inserts before trailing section separator comments', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[features]',
					'',
					'# 複数エージェント機能',
					'multi_agent = true',
					'memories = true',
					'',
					'# ================================',
					'#  MCP',
					'# ================================',
					'',
					'[mcp_servers.context7]',
					'command = "cmd"',
				].join('\n'),
				'utf8',
			);

			setFeatureFlag(configPath, 'web_search', true);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('memories = true\nweb_search = true\n\n# ================================'));
			assert.ok(!contents.includes('# ================================\n\nweb_search = true'));
		});
	});

	test('listHookDiagnostics reads hooks.json and inline hooks with merge warning', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const workspaceRoot = path.join(root, 'workspace');
			const userCodexDir = path.join(homeDir, '.codex');
			const projectCodexDir = path.join(workspaceRoot, '.codex');
			const configPath = path.join(userCodexDir, 'config.toml');
			fs.mkdirSync(userCodexDir, { recursive: true });
			fs.mkdirSync(projectCodexDir, { recursive: true });
			fs.writeFileSync(
				configPath,
				[
					'[features]',
					'codex_hooks = true',
					'',
					`[projects.'${workspaceRoot}']`,
					'trust_level = "trusted"',
					'',
					'[[hooks.PreToolUse]]',
					'matcher = "^Bash$"',
					'[[hooks.PreToolUse.hooks]]',
					'type = "command"',
					'command = "echo user-inline"',
				].join('\n'),
				'utf8',
			);
			fs.writeFileSync(
				path.join(userCodexDir, 'hooks.json'),
				JSON.stringify(
					{
						hooks: {
							SessionStart: [
								{
									matcher: 'startup|resume',
									hooks: [
										{
											type: 'command',
											command: 'echo user-json',
										},
									],
								},
							],
						},
					},
					null,
					2,
				),
				'utf8',
			);
			fs.writeFileSync(
				path.join(projectCodexDir, 'config.toml'),
				[
					'[[hooks.PostToolUse]]',
					'matcher = "^Bash$"',
					'[[hooks.PostToolUse.hooks]]',
					'type = "command"',
					'command = "echo project-inline"',
					'timeout = 30',
				].join('\n'),
				'utf8',
			);

			const diagnostics = listHookDiagnostics(configPath, homeDir, workspaceRoot);

			assert.strictEqual(diagnostics.hooksEnabled, true);
			assert.strictEqual(diagnostics.projectTrusted, true);
			assert.ok(
				diagnostics.warnings.some((warning) =>
					warning.includes('both hooks.json and inline hooks'),
				),
			);
			assert.ok(
				diagnostics.entries.some(
					(entry) =>
						entry.event === 'SessionStart' &&
						entry.command === 'echo user-json' &&
						entry.active,
				),
			);
			assert.ok(
				diagnostics.entries.some(
					(entry) =>
						entry.event === 'PostToolUse' &&
						entry.command === 'echo project-inline' &&
						entry.active,
				),
			);
		});
	});

	test('listHookDiagnostics keeps project hooks inactive until the workspace is trusted', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const workspaceRoot = path.join(root, 'workspace');
			const userCodexDir = path.join(homeDir, '.codex');
			const projectCodexDir = path.join(workspaceRoot, '.codex');
			const configPath = path.join(userCodexDir, 'config.toml');
			fs.mkdirSync(userCodexDir, { recursive: true });
			fs.mkdirSync(projectCodexDir, { recursive: true });
			fs.writeFileSync(
				configPath,
				['[features]', 'codex_hooks = true'].join('\n'),
				'utf8',
			);
			fs.writeFileSync(
				path.join(projectCodexDir, 'config.toml'),
				[
					'[[hooks.Stop]]',
					'[[hooks.Stop.hooks]]',
					'type = "command"',
					'command = "echo stop"',
				].join('\n'),
				'utf8',
			);

			const diagnostics = listHookDiagnostics(configPath, homeDir, workspaceRoot);

			assert.strictEqual(diagnostics.projectTrusted, false);
			assert.ok(
				diagnostics.warnings.some((warning) =>
					warning.includes('inactive until this workspace is trusted'),
				),
			);
			assert.ok(
				diagnostics.entries.some(
					(entry) => entry.event === 'Stop' && entry.active === false,
				),
			);
		});
	});
});
