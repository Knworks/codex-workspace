import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import {
	listFeatureFlagRecords,
	parseFeatureFlagOutput,
	planFeatureFlagCleanup,
	removeObsoleteFeatureFlags,
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

async function withTempDirAsync(run: (root: string) => Promise<void>): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-cleanup-'));
	try {
		await run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

const CLEANUP_CLI_OUTPUT = [
	'active stable true', 'experimental experimental false', 'developing under development false',
	'legacy deprecated true', 'removed_flag removed false',
].join('\n');

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

	test('read-save-read preserves known and unknown hooks in both file formats', async () => {
		await withTempDirAsync(async (root) => {
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
			const run = async (args: string[]): Promise<string> => {
				if (args[1] !== 'list') {
					const enabled = args[1] === 'enable';
					fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace(/hooks = (true|false)/, `hooks = ${enabled}`));
				}
				return `hooks stable ${listHookDiagnostics(configPath, home, root).hooksEnabled}`;
			};
			await setFeatureFlag(configPath, 'hooks', false, run);
			assert.strictEqual(listHookDiagnostics(configPath, home, root).hooksEnabled, false);
			await setFeatureFlag(configPath, 'hooks', true, run);
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
	test('cleanup identifies only removed and unlisted configured feature keys', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, '[features]\nactive = true\nexperimental = false\ndeveloping = false\nlegacy = true\nremoved_flag = true\nunknown_flag = false\n');
			const plan = planFeatureFlagCleanup(configPath, parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT));
			assert.deepStrictEqual(plan.settings, [
				{ key: 'removed_flag', value: true, reason: 'removed' },
				{ key: 'unknown_flag', value: false, reason: 'unlisted' },
			]);
		});
	});

	test('cleanup removes reviewed assignments and preserves other bytes and profiles', async () => {
		await withTempDirAsync(async (root) => {
			const configPath = path.join(root, 'config.toml');
			const contents = [
				'# header', 'model = "test-model"', '["features"] # flags',
				'# keep this comment', 'active = true # keep inline',
				'"removed_flag" = true # obsolete', "'unknown_flag' = false",
				'legacy = true', '', '[profiles.test.features]', 'unknown_flag = true',
				'[mcp_servers.test]', 'command = "test"', '',
			].join('\r\n');
			fs.writeFileSync(configPath, contents);
			const profilePath = path.join(root, 'test.config.toml');
			fs.writeFileSync(profilePath, '[features]\nunknown_flag = true\n');
			const plan = planFeatureFlagCleanup(configPath, parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT));
			const count = await removeObsoleteFeatureFlags(plan, async () => CLEANUP_CLI_OUTPUT);
			assert.strictEqual(count, 2);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents
				.replace('"removed_flag" = true # obsolete\r\n', '')
				.replace("'unknown_flag' = false\r\n", ''));
			assert.strictEqual(fs.readFileSync(profilePath, 'utf8'), '[features]\nunknown_flag = true\n');
		});
	});

	test('cleanup aborts when the file or CLI support changes after review', async () => {
		await withTempDirAsync(async (root) => {
			const configPath = path.join(root, 'config.toml');
			const contents = '[features]\nremoved_flag = true\n';
			fs.writeFileSync(configPath, contents);
			const plan = planFeatureFlagCleanup(configPath, parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT));
			fs.appendFileSync(configPath, '# edited while confirming\n');
			await assert.rejects(removeObsoleteFeatureFlags(plan, async () => CLEANUP_CLI_OUTPUT), /changed/);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents + '# edited while confirming\n');
			fs.writeFileSync(configPath, contents);
			await assert.rejects(removeObsoleteFeatureFlags(plan, async () => 'removed_flag stable true'), /changed/);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
			await assert.rejects(removeObsoleteFeatureFlags(plan, async () => { throw new Error('CLI failed'); }), /CLI failed/);
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
		});
	});

	test('cleanup rejects ambiguous TOML edits without changing the file', async () => {
		await withTempDirAsync(async (root) => {
			const configPath = path.join(root, 'config.toml');
			for (const contents of [
				'features = { unknown_flag = true }\n',
				'features.unknown_flag = true\n',
				'notes = """\n[features]\nunknown_flag = true\n"""\nfeatures = { unknown_flag = true }\n',
			]) {
				fs.writeFileSync(configPath, contents);
				await assert.rejects(async () => {
					const plan = planFeatureFlagCleanup(configPath, parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT));
					await removeObsoleteFeatureFlags(plan, async () => CLEANUP_CLI_OUTPUT);
				}, /safely/);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
			}
		});
	});

	test('cleanup handles absent settings and refuses malformed config and empty registry', async () => {
		await withTempDirAsync(async (root) => {
			const configPath = path.join(root, 'config.toml');
			const records = parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT);
			const plan = planFeatureFlagCleanup(configPath, records);
			assert.deepStrictEqual(plan.settings, []);
			assert.strictEqual(await removeObsoleteFeatureFlags(plan, async () => { throw new Error('must not run'); }), 0);
			assert.ok(!fs.existsSync(configPath));
			fs.writeFileSync(configPath, '[features]\nunknown_flag = "not a boolean"\n');
			assert.throws(() => planFeatureFlagCleanup(configPath, records), /safely/);
			fs.writeFileSync(configPath, '[features\n');
			assert.throws(() => planFeatureFlagCleanup(configPath, records));
			assert.throws(() => planFeatureFlagCleanup(configPath, []), /changed/);
		});
	});

	test('cleanup aborts if an editor becomes dirty while rechecking the CLI', async () => {
		await withTempDirAsync(async (root) => {
			const configPath = path.join(root, 'config.toml');
			const contents = '[features]\nremoved_flag = true\n';
			fs.writeFileSync(configPath, contents);
			const document = await vscode.workspace.openTextDocument(configPath);
			try {
				const plan = planFeatureFlagCleanup(configPath, parseFeatureFlagOutput(CLEANUP_CLI_OUTPUT));
				// Windows file comparisons must ignore path case.
				if (process.platform === 'win32') {
					plan.configPath = configPath.toUpperCase();
				}
				await assert.rejects(removeObsoleteFeatureFlags(plan, async () => {
					const edit = new vscode.WorkspaceEdit();
					edit.insert(document.uri, new vscode.Position(0, 0), '# unsaved\n');
					assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
					assert.strictEqual(document.isDirty, true);
					return CLEANUP_CLI_OUTPUT;
				}), /Save changes/);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
			} finally {
				await vscode.window.showTextDocument(document, { preview: true });
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
				assert.strictEqual(document.isDirty, false);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
			}
		});
	});

	test('parses CLI keys, every stage and effective values without a static registry', () => {
		const flags = parseFeatureFlagOutput([
			'new_feature    stable    true',
			'future_feature\texperimental\tfalse',
			'old_feature  deprecated  false',
			'guardianv2.thread_context removed false',
			'developing under development true',
			'next_flag future stage false',
			'',
		].join('\r\n'));
		assert.deepStrictEqual(flags.map(({ key, maturity, enabled }) => ({ key, maturity, enabled })), [
			{ key: 'new_feature', maturity: 'Stable', enabled: true },
			{ key: 'future_feature', maturity: 'Experimental', enabled: false },
			{ key: 'old_feature', maturity: 'Deprecated', enabled: false },
			{ key: 'guardianv2.thread_context', maturity: 'Removed', enabled: false },
			{ key: 'developing', maturity: 'Under development', enabled: true },
			{ key: 'next_flag', maturity: 'Future stage', enabled: false },
		]);
		assert.strictEqual(flags[4].maturityClass, 'under-development');
	});

	test('rejects empty, malformed, partial and duplicate CLI output', () => {
		for (const output of ['', '  \n', 'feature stable yes', 'feature true',
			'good stable true\nbad output', 'same stable true\nsame stable false']) {
			assert.throws(() => parseFeatureFlagOutput(output));
		}
	});

	test('list uses only CLI output and passes the selected base home', async () => {
		const configPath = path.join(os.tmpdir(), 'selected-codex', 'config.toml');
		const flags = await listFeatureFlagRecords(configPath, async (args, home) => {
			assert.deepStrictEqual(args, ['features', 'list']);
			assert.strictEqual(home, path.dirname(configPath));
			return 'cli_only stable false';
		});
		assert.deepStrictEqual(flags.map((flag) => flag.key), ['cli_only']);
		assert.strictEqual(flags[0].enabled, false);
	});

	test('enable and disable go through CLI and return reloaded state', async () => {
		let enabled = false;
		const calls: string[][] = [];
		const configPath = path.join(os.tmpdir(), 'selected-codex', 'config.toml');
		const run = async (args: string[], home: string): Promise<string> => {
			assert.strictEqual(home, path.dirname(configPath));
			calls.push(args);
			if (args[1] !== 'list') {
				enabled = args[1] === 'enable';
				return '';
			}
			return 'cli_only stable ' + enabled;
		};
		assert.strictEqual((await setFeatureFlag(configPath, 'cli_only', true, run))[0].enabled, true);
		assert.strictEqual((await setFeatureFlag(configPath, 'cli_only', false, run))[0].enabled, false);
		assert.deepStrictEqual(calls, [
			['features', 'list'], ['features', 'enable', 'cli_only'], ['features', 'list'],
			['features', 'list'], ['features', 'disable', 'cli_only'], ['features', 'list'],
		]);
	});

	test('rejects unknown and unsafe keys before running an update', async () => {
		const calls: string[][] = [];
		const run = async (args: string[]): Promise<string> => {
			calls.push(args);
			return 'known stable true';
		};
		for (const key of ['unknown', 'known & echo injected', '--help', '']) {
			await assert.rejects(setFeatureFlag('config.toml', key, true, run));
		}
		assert.deepStrictEqual(calls, [['features', 'list']]);
	});

	test('removed features cannot be reintroduced through a toggle', async () => {
		const calls: string[][] = [];
		await assert.rejects(setFeatureFlag('config.toml', 'removed_flag', true, async (args) => {
			calls.push(args);
			return 'removed_flag removed false';
		}), /Removed by CLI/);
		assert.deepStrictEqual(calls, [['features', 'list']]);
	});

	test('surfaces missing CLI, failed commands and reload failures without fallback', async () => {
		for (const message of ['spawn codex ENOENT', 'invalid configuration', 'timeout']) {
			await assert.rejects(listFeatureFlagRecords('config.toml', async () => {
				throw new Error(message);
			}), new RegExp(message));
		}
		for (const failedCall of [1, 2, 3]) {
			let call = 0;
			await assert.rejects(setFeatureFlag('config.toml', 'known', true, async () => {
				call += 1;
				if (call === failedCall) {
					throw new Error('command failed');
				}
				return 'known stable true';
			}), /command failed/);
			assert.strictEqual(call, failedCall);
		}
	});

	test('CLI process uses the chosen base home and cleans its working directory', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-process-'));
		const originalPath = process.env.PATH;
		try {
			const home = path.join(root, 'base home');
			fs.mkdirSync(home);
			const configPath = path.join(home, 'config.toml');
			const commandPath = path.join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex');
			const script = process.platform === 'win32'
				? [
					'@echo off',
					'echo %CD%>"%CODEX_HOME%\\cwd.txt"',
					'if "%2"=="enable" (echo true>"%CODEX_HOME%\\state.txt" & exit /b 0)',
					'if "%2"=="disable" (echo false>"%CODEX_HOME%\\state.txt" & exit /b 0)',
					'set state=false',
					'if exist "%CODEX_HOME%\\state.txt" set /p state=<"%CODEX_HOME%\\state.txt"',
					'echo fixture stable %state%',
				].join('\r\n')
				: [
					'#!/bin/sh',
					'pwd > "$CODEX_HOME/cwd.txt"',
					'case "$2" in',
					'  enable) echo true > "$CODEX_HOME/state.txt"; exit 0 ;;',
					'  disable) echo false > "$CODEX_HOME/state.txt"; exit 0 ;;',
					'esac',
					'state=false',
					'if [ -f "$CODEX_HOME/state.txt" ]; then read state < "$CODEX_HOME/state.txt"; fi',
					'echo "fixture stable $state"',
				].join('\n');
			fs.writeFileSync(commandPath, script, { mode: 0o755 });
			process.env.PATH = root;
			assert.strictEqual((await listFeatureFlagRecords(configPath))[0].enabled, false);
			assert.strictEqual((await setFeatureFlag(configPath, 'fixture', true))[0].enabled, true);
			assert.strictEqual((await setFeatureFlag(configPath, 'fixture', false))[0].enabled, false);
			const commandCwd = fs.readFileSync(path.join(home, 'cwd.txt'), 'utf8').trim();
			assert.notStrictEqual(commandCwd, process.cwd());
			assert.ok(!fs.existsSync(commandCwd));
			// A missing executable must surface a process error, not a fallback registry.
			process.env.PATH = home;
			await assert.rejects(listFeatureFlagRecords(configPath), /Codex CLI feature command failed/);
		} finally {
			if (originalPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = originalPath;
			}
			fs.rmSync(root, { recursive: true, force: true });
		}
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
					'hooks = true',
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
				['[features]', 'hooks = true'].join('\n'),
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
