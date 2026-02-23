import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import {
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
} from '../services/disabledAgentsStore';

type EnvSnapshot = {
	HOME?: string;
	USERPROFILE?: string;
	HOMEDRIVE?: string;
	HOMEPATH?: string;
};

async function withTempHome(
	run: (homeDir: string) => Promise<void>,
): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
	const originalEnv: EnvSnapshot = {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
	};
	process.env.HOME = tempDir;
	process.env.USERPROFILE = tempDir;
	process.env.HOMEDRIVE = '';
	process.env.HOMEPATH = tempDir;

	try {
		await run(tempDir);
	} finally {
		process.env.HOME = originalEnv.HOME;
		process.env.USERPROFILE = originalEnv.USERPROFILE;
		process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
		process.env.HOMEPATH = originalEnv.HOMEPATH;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

async function withSyncFolderSetting(
	key: 'promptsFolder' | 'agentFolder',
	value: string,
	run: () => Promise<void>,
): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('codex-workspace');
	const original = configuration.get<string>(key);
	await configuration.update(
		key,
		value,
		vscode.ConfigurationTarget.Global,
	);

	try {
		await run();
	} finally {
		await configuration.update(
			key,
			original,
			vscode.ConfigurationTarget.Global,
		);
	}
}

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.getExtension('Knworks.codex-workspace');
	assert.ok(extension, 'extension not found');
	await extension.activate();
}

suite('Sync commands', () => {
	test('syncPrompts copies files when confirmed', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const promptsDir = path.join(codexDir, 'prompts');
			fs.mkdirSync(promptsDir, { recursive: true });
			fs.writeFileSync(
				path.join(codexDir, 'config.toml'),
				'title = \"ok\"',
				'utf8',
			);
			fs.writeFileSync(path.join(promptsDir, 'note.md'), 'note', 'utf8');

			const targetDir = path.join(homeDir, 'sync-prompts');

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await withSyncFolderSetting('promptsFolder', targetDir, async () => {
					await vscode.commands.executeCommand(
						'codex-workspace.syncPrompts',
					);
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.strictEqual(
				fs.readFileSync(path.join(targetDir, 'note.md'), 'utf8'),
				'note',
			);
		});
	});

	test('syncPrompts does not copy files when cancelled', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const promptsDir = path.join(codexDir, 'prompts');
			fs.mkdirSync(promptsDir, { recursive: true });
			fs.writeFileSync(
				path.join(codexDir, 'config.toml'),
				'title = \"ok\"',
				'utf8',
			);
			fs.writeFileSync(path.join(promptsDir, 'note.md'), 'note', 'utf8');

			const targetDir = path.join(homeDir, 'sync-prompts-cancel');

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => undefined;

			try {
				await withSyncFolderSetting('promptsFolder', targetDir, async () => {
					await vscode.commands.executeCommand(
						'codex-workspace.syncPrompts',
					);
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(!fs.existsSync(path.join(targetDir, 'note.md')));
		});
	});

	test('syncAgents copies files when confirmed', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(codexDir, 'config.toml'),
				'title = \"ok\"',
				'utf8',
			);
			fs.writeFileSync(path.join(agentsDir, 'reviewer.toml'), 'mode = \"review\"', 'utf8');

			const targetDir = path.join(homeDir, 'sync-agents');

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await withSyncFolderSetting('agentFolder', targetDir, async () => {
					await vscode.commands.executeCommand(
						'codex-workspace.syncAgents',
					);
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.strictEqual(
				fs.readFileSync(path.join(targetDir, 'reviewer.toml'), 'utf8'),
				'mode = \"review\"',
			);
		});
	});

	test('syncAgents does not copy files when cancelled', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(codexDir, 'config.toml'),
				'title = \"ok\"',
				'utf8',
			);
			fs.writeFileSync(path.join(agentsDir, 'reviewer.toml'), 'mode = \"review\"', 'utf8');

			const targetDir = path.join(homeDir, 'sync-agents-cancel');

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => undefined;

			try {
				await withSyncFolderSetting('agentFolder', targetDir, async () => {
					await vscode.commands.executeCommand(
						'codex-workspace.syncAgents',
					);
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(!fs.existsSync(path.join(targetDir, 'reviewer.toml')));
		});
	});

	test('syncAgents deletes config and sync metadata when agent file is deleted by sync', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			const configPath = path.join(codexDir, 'config.toml');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				configPath,
				[
					'title = "ok"',
					'',
					'[agents.reviewer]',
					'description = "reviewer"',
					'config_file = "agents/reviewer.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			fs.writeFileSync(path.join(agentsDir, 'reviewer.toml'), 'mode = "review"', 'utf8');

			const targetDir = path.join(homeDir, 'sync-agents-delete');
			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await withSyncFolderSetting('agentFolder', targetDir, async () => {
					await vscode.commands.executeCommand('codex-workspace.syncAgents');
					fs.rmSync(path.join(targetDir, 'reviewer.toml'));
					await vscode.commands.executeCommand('codex-workspace.syncAgents');
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(!fs.existsSync(path.join(agentsDir, 'reviewer.toml')));
			const configContents = fs.readFileSync(configPath, 'utf8');
			assert.ok(!configContents.includes('[agents.reviewer]'));
			const syncStatePath = path.join(codexDir, '.codex-workspace', 'codex-sync.json');
			const syncState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8')) as {
				agents?: Record<string, unknown>;
			};
			assert.strictEqual(syncState.agents?.['reviewer.toml'], undefined);
		});
	});

	test('syncAgents adds config entry when agent file is newly added by sync', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			const configPath = path.join(codexDir, 'config.toml');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(configPath, 'title = "ok"\n', 'utf8');

			const targetDir = path.join(homeDir, 'sync-agents-add');
			fs.mkdirSync(targetDir, { recursive: true });
			fs.writeFileSync(path.join(targetDir, 'new_agent.toml'), 'mode = "new"', 'utf8');

			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await withSyncFolderSetting('agentFolder', targetDir, async () => {
					await vscode.commands.executeCommand('codex-workspace.syncAgents');
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(fs.existsSync(path.join(agentsDir, 'new_agent.toml')));
			const configContents = fs.readFileSync(configPath, 'utf8');
			assert.ok(configContents.includes('[agents.new_agent]'));
			assert.ok(configContents.includes('config_file = "agents/new_agent.toml"'));
		});
	});

	test('syncAgents deletes disabled-store entry when disabled agent file is deleted by sync', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			const configPath = path.join(codexDir, 'config.toml');
			const disabledStorePath = getDisabledAgentsStorePath(codexDir);
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(configPath, 'title = "ok"\n', 'utf8');
			fs.writeFileSync(path.join(agentsDir, 'reviewer.toml'), 'mode = "review"', 'utf8');
			saveDisabledAgentBlock(
				disabledStorePath,
				'reviewer',
				[
					'[agents.reviewer]',
					'description = "reviewer"',
					'config_file = "agents/reviewer.toml"',
					'',
				].join('\n'),
				'2026-02-23T00:00:00.000Z',
			);

			const targetDir = path.join(homeDir, 'sync-agents-disabled-delete');
			const originalWarning = vscode.window.showWarningMessage;
			(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
				.showWarningMessage = async () => 'OK';

			try {
				await withSyncFolderSetting('agentFolder', targetDir, async () => {
					await vscode.commands.executeCommand('codex-workspace.syncAgents');
					fs.rmSync(path.join(targetDir, 'reviewer.toml'));
					await vscode.commands.executeCommand('codex-workspace.syncAgents');
				});
			} finally {
				(vscode.window as unknown as { showWarningMessage: typeof originalWarning })
					.showWarningMessage = originalWarning;
			}

			assert.ok(!fs.existsSync(path.join(agentsDir, 'reviewer.toml')));
			const store = JSON.parse(fs.readFileSync(disabledStorePath, 'utf8')) as {
				disabledAgents?: Record<string, unknown>;
			};
			assert.strictEqual(store.disabledAgents?.reviewer, undefined);
			const syncStatePath = path.join(codexDir, '.codex-workspace', 'codex-sync.json');
			const syncState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8')) as {
				agents?: Record<string, unknown>;
			};
			assert.strictEqual(syncState.agents?.['reviewer.toml'], undefined);
		});
	});
});
