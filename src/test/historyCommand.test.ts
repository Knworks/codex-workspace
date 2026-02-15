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

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	getRevealCount: () => number;
};

function createFakePanel(): FakePanelHandle {
	let revealCount = 0;
	let disposeListener: (() => void) | undefined;
	const webview = { html: '' } as vscode.Webview;

	const panel = {
		webview,
		reveal: () => {
			revealCount += 1;
		},
		onDidDispose: (listener: () => void) => {
			disposeListener = listener;
			return { dispose: () => undefined };
		},
		dispose: () => {
			disposeListener?.();
		},
	} as unknown as vscode.WebviewPanel;

	return {
		panel,
		getRevealCount: () => revealCount,
	};
}

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

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.getExtension('Knworks.codex-workspace');
	assert.ok(extension, 'extension not found');
	await extension.activate();
}

suite('History command', () => {
	test('openHistoryView command opens and reuses a single history panel', async () => {
		await withTempHome(async (homeDir) => {
			await activateExtension();

			const codexDir = path.join(homeDir, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'config.toml'), 'title = "ok"', 'utf8');

			const commands = await vscode.commands.getCommands(true);
			assert.ok(commands.includes('codex-workspace.openHistoryView'));

			const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
			let createCount = 0;
			const createdPanels: FakePanelHandle[] = [];

			(
				vscode.window as unknown as {
					createWebviewPanel: typeof originalCreateWebviewPanel;
				}
			).createWebviewPanel = (() => {
				createCount += 1;
				const panel = createFakePanel();
				createdPanels.push(panel);
				return panel.panel;
			}) as typeof originalCreateWebviewPanel;

			try {
				await vscode.commands.executeCommand(
					'codex-workspace.openHistoryView',
				);
				await vscode.commands.executeCommand(
					'codex-workspace.openHistoryView',
				);
			} finally {
				(
					vscode.window as unknown as {
						createWebviewPanel: typeof originalCreateWebviewPanel;
					}
				).createWebviewPanel = originalCreateWebviewPanel;
				createdPanels[0]?.panel.dispose();
			}

			assert.strictEqual(createCount, 1);
			assert.strictEqual(createdPanels[0]?.getRevealCount(), 1);
		});
	});
});
