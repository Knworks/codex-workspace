import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';

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

async function withPromptsFolderSetting(
	value: string,
	run: () => Promise<void>,
): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('codex-workspace');
	const original = configuration.get<string>('promptsFolder');
	await configuration.update(
		'promptsFolder',
		value,
		vscode.ConfigurationTarget.Global,
	);

	try {
		await run();
	} finally {
		await configuration.update(
			'promptsFolder',
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
				await withPromptsFolderSetting(targetDir, async () => {
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
				await withPromptsFolderSetting(targetDir, async () => {
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
});
