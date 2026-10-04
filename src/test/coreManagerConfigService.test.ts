import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	listFeatureFlagRecords,
	listHookDiagnostics,
	setFeatureFlag,
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
	test('catalog matches CLI stages and excludes obsolete keys', () => {
		withTempDir((root) => {
			const flags = listFeatureFlagRecords(path.join(root, 'config.toml'));
			for (const key of ['goals', 'memories', 'remote_plugin', 'multi_agent_v2']) {
				assert.strictEqual(flags.find((flag) => flag.key === key)?.maturity, 'Stable', key);
			}
			for (const key of ['personality', 'tool_search']) {
				assert.strictEqual(flags.find((flag) => flag.key === key)?.maturity, 'Removed', key);
			}
			for (const key of ['codex_hooks', 'builtin_mcp', 'child_agents_md', 'responses_websocket_response_processed']) {
				assert.ok(!flags.some((flag) => flag.key === key), key);
			}
			assert.strictEqual(flags.find((flag) => flag.key === 'network_proxy')?.maturity, 'Experimental');
		});
	});

	test('unsupported feature writes fail without changing existing settings', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const contents = '[features]\npersonality = true # preserve legacy config\nunknown_flag = true\n';
			fs.writeFileSync(configPath, contents);
			for (const key of ['personality', 'tool_search', 'codex_hooks', 'unknown_flag', 'code_mode', 'web_search_cached']) {
				for (const enabled of [true, false]) {
					assert.throws(() => setFeatureFlag(configPath, key, enabled), /Unsupported feature flag/);
					assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
				}
			}
			const missingPath = path.join(root, 'missing.toml');
			assert.throws(() => setFeatureFlag(missingPath, 'personality', true), /Unsupported feature flag/);
			assert.ok(!fs.existsSync(missingPath));
		});
	});

	test('configured values override catalog defaults without removing obsolete settings', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, '[features]\ngoals = false\nmemories = true\npersonality = true\n');
			const flags = listFeatureFlagRecords(configPath);
			assert.strictEqual(flags.find((flag) => flag.key === 'goals')?.enabled, false);
			assert.strictEqual(flags.find((flag) => flag.key === 'memories')?.enabled, true);
			setFeatureFlag(configPath, 'remote_plugin', false);
			assert.ok(fs.readFileSync(configPath, 'utf8').includes('personality = true'));
		});
	});

	test('listFeatureFlagRecords uses defaults when config is missing', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');

			const flags = listFeatureFlagRecords(configPath);

			assert.strictEqual(
				flags.find((flag) => flag.key === 'hooks')?.enabled,
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
			setFeatureFlag(configPath, 'hooks', false);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('[features]'));
			assert.ok(contents.includes('memories = true'));
			assert.ok(contents.includes('hooks = false'));

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

			setFeatureFlag(configPath, 'network_proxy', true);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('memories = true\nnetwork_proxy = true\n\n# ================================'));
			assert.ok(!contents.includes('# ================================\n\nnetwork_proxy = true'));
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
