import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { AgentManagerPanelManager } from '../services/agentManagerPanel';

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
	let receiveMessageListener: ((message: unknown) => void) | undefined;
	const webview = {
		html: '',
		cspSource: 'vscode-webview://test',
		postMessage: async () => true,
		onDidReceiveMessage: (listener: (message: unknown) => void) => {
			receiveMessageListener = listener;
			return { dispose: () => undefined };
		},
	} as unknown as vscode.Webview;

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

async function withTempHome(run: (homeDir: string) => Promise<void>): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-home-'));
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

suite('Agent manager panel', () => {
	test('ready message does not trigger a full refresh loop', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'agentManagerPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes("if (message.type === 'ready') {"));
		assert.ok(source.includes('\t\t\treturn;'));
		assert.ok(source.includes("if (message.type === 'refresh') {"));
		assert.ok(!source.includes("if (message.type === 'refresh' || message.type === 'ready') {"));
	});

	test('orchestration UI stays in the MVP shape', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'agentManagerPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes('deleteWorkflowButton'));
		assert.ok(source.includes('openWorkflowFolderButton'));
		assert.ok(source.includes('toggleInspectorButton'));
		assert.ok(source.includes('preview-header'));
		assert.ok(source.includes('preview-card'));
		assert.ok(source.includes('confirmOverlay'));
		assert.ok(source.includes('openConfirmDialog(uiText.confirmDeleteWorkflow'));
		assert.ok(source.includes('previewCollapsed: true'));
		assert.ok(source.includes('uiText.selectWorkflow'));
		assert.ok(source.includes('appState.previewCollapsed = false'));
		assert.ok(source.includes('function isMarkdownTable('));
		assert.ok(source.includes("return '<table><thead>'"));
		assert.ok(!source.includes("return 'x' + String(node.maxAttempts || 1);"));
		assert.ok(source.includes("savedWorkflowSelect.addEventListener('change'"));
		assert.ok(source.includes('data-delete-workflow'));
		assert.ok(source.includes('class="markdown-content preview-content"'));
		assert.ok(source.includes('retainContextWhenHidden: false'));
		assert.ok(source.includes('captureInspectorFocusState'));
		assert.ok(source.includes('restoreInspectorFocusState'));
		assert.ok(source.includes('inspectorScrollTop'));
		assert.ok(source.includes('requestAnimationFrame(() => {'));
		assert.ok(source.includes('overflow-wrap: anywhere;'));
		assert.ok(source.includes('min-width: 0;'));
		assert.ok(!source.includes('applyTemplateButton'));
		assert.ok(!source.includes('data-add-card="review"'));
		assert.ok(!source.includes('validateWorkflowButton'));
		assert.ok(!source.includes('Agent source'));
		assert.ok(!source.includes('<label class="field-label">Role</label>'));
		assert.ok(!source.includes('<label class="field-label">Summary</label>'));
	});

	test('show renders agent manager webview html', async () => {
		await withTempHome(async (homeDir) => {
			const codexDir = path.join(homeDir, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(codexDir, 'config.toml'),
				[
					'[agents.tester]',
					'description = "Test agent"',
					'config_file = "agents/tester.toml"',
					'',
				].join('\n'),
				'utf8',
			);
			fs.writeFileSync(
				path.join(agentsDir, 'tester.toml'),
				[
					'name = "tester"',
					'description = "Test agent"',
					'model = "gpt-5"',
					'',
				].join('\n'),
				'utf8',
			);

			const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
			const fakePanel = createFakePanel();
			(
				vscode.window as unknown as {
					createWebviewPanel: typeof originalCreateWebviewPanel;
				}
			).createWebviewPanel = () => fakePanel.panel;

			try {
				const manager = new AgentManagerPanelManager(() => undefined);
				manager.show();
				const html = fakePanel.panel.webview.html;
				assert.ok(html.includes('AGENTS Manager Tabs'));
				assert.ok(html.includes('id="agentsList"'));
				assert.ok(html.includes('id="orchestrationPanel"'));
				assert.ok(html.includes('deleteWorkflowButton'));
				const scriptMatch = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/);
				assert.ok(scriptMatch, 'webview script should be present');
				assert.doesNotThrow(() => new Function(scriptMatch?.[1] ?? ''));
				manager.dispose();
			} finally {
				(
					vscode.window as unknown as {
						createWebviewPanel: typeof originalCreateWebviewPanel;
					}
				).createWebviewPanel = originalCreateWebviewPanel;
			}
		});
	});
});
