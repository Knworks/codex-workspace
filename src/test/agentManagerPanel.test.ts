import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { AgentManagerPanelManager } from '../services/agentManagerPanel';
import { createEmptyWorkflow } from '../services/orchestrationService';
import { getAgentLocations } from '../services/agentLocations';
import { listManagedAgentRecords } from '../services/managedAgentService';

type EnvSnapshot = {
	HOME?: string;
	USERPROFILE?: string;
	HOMEDRIVE?: string;
	HOMEPATH?: string;
};

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	dispatchMessage: (message: unknown) => void;
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
		dispatchMessage: (message: unknown) => {
			receiveMessageListener?.(message);
		},
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
	test('toggle failure and unchanged enable do not announce success and show actual state', async () => {
		await withTempHome(async (homeDir) => {
			const codexDir = path.join(homeDir, '.codex');
			fs.mkdirSync(codexDir);
			const configPath = path.join(codexDir, 'config.toml');
			const declaration = '[agents.reviewer]\ndescription = "keep"\nconfig_file = "reviewer.toml"\n';
			fs.writeFileSync(configPath, declaration);
			fs.writeFileSync(path.join(codexDir, 'reviewer.toml'), '');
			const fake = createFakePanel();
			const originalCreate = vscode.window.createWebviewPanel;
			const originalInfo = vscode.window.showInformationMessage;
			const originalWarning = vscode.window.showWarningMessage;
			const originalError = vscode.window.showErrorMessage;
			const originalRename = fs.renameSync;
			let infos = 0;
			let warnings = 0;
			let errors = 0;
			vscode.window.createWebviewPanel = () => fake.panel;
			vscode.window.showInformationMessage = (async () => { infos += 1; }) as typeof originalInfo;
			vscode.window.showWarningMessage = (async () => { warnings += 1; }) as typeof originalWarning;
			vscode.window.showErrorMessage = (async () => { errors += 1; }) as typeof originalError;
			const manager = new AgentManagerPanelManager(() => undefined);
			try {
				manager.show();
				const id = listManagedAgentRecords(configPath, getAgentLocations(homeDir))[0].id;
				fake.dispatchMessage({ type: 'toggleAgent', id, enabled: true });
				assert.strictEqual(warnings, 1);
				assert.strictEqual(infos, 0);
				fs.renameSync = (source, destination) => {
					if (String(destination) === configPath) { throw new Error('EACCES injected'); }
					originalRename(source, destination);
				};
				fake.dispatchMessage({ type: 'toggleAgent', id, enabled: false });
				assert.strictEqual(errors, 1);
				assert.strictEqual(infos, 0);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), declaration);
				assert.strictEqual(listManagedAgentRecords(configPath, getAgentLocations(homeDir))[0].enabled, true);
			} finally {
				manager.dispose();
				fs.renameSync = originalRename;
				vscode.window.createWebviewPanel = originalCreate;
				vscode.window.showInformationMessage = originalInfo;
				vscode.window.showWarningMessage = originalWarning;
				vscode.window.showErrorMessage = originalError;
			}
		});
	});

	test('renders Profile roles and routes Open and ON/OFF to the selected declaration', async () => {
		await withTempHome(async (homeDir) => {
			const codexDir = path.join(homeDir, '.codex');
			fs.mkdirSync(codexDir);
			const basePath = path.join(codexDir, 'config.toml');
			const profilePath = path.join(codexDir, 'review.config.toml');
			const rolePath = path.join(homeDir, 'custom-role.toml');
			const roleContents = 'model = "test-model"\n';
			fs.writeFileSync(rolePath, roleContents);
			const declaration = '[agents.reviewer]\ndescription = "Reviewer"\nconfig_file = "../custom-role.toml"\n';
			fs.writeFileSync(basePath, declaration.replace('[agents.reviewer]', '[agents.base_reviewer]'));
			fs.writeFileSync(profilePath, declaration);
			const fakePanel = createFakePanel();
			const originalCreate = vscode.window.createWebviewPanel;
			const originalExecute = vscode.commands.executeCommand;
			const opened: vscode.Uri[] = [];
			(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = () => fakePanel.panel;
			(vscode.commands as unknown as { executeCommand: typeof originalExecute }).executeCommand = (async (command: string, uri: vscode.Uri) => {
				if (command === 'vscode.open') { opened.push(uri); }
				return undefined;
			}) as typeof originalExecute;
			let changes = 0;
			const manager = new AgentManagerPanelManager(() => { changes += 1; });
			try {
				manager.show();
				const records = listManagedAgentRecords(basePath, getAgentLocations(homeDir));
				const profile = records.find((record) => record.configPath === profilePath)!;
				assert.ok(profile);
				assert.ok(fakePanel.panel.webview.html.includes('Profile: review'));
				assert.ok(fakePanel.panel.webview.html.includes('test-model'));
				fakePanel.dispatchMessage({ type: 'openAgent', id: profile.id });
				assert.strictEqual(opened[0].fsPath, vscode.Uri.file(rolePath).fsPath);
				fakePanel.dispatchMessage({ type: 'toggleAgent', id: profile.id, enabled: false });
				assert.strictEqual(fs.readFileSync(basePath, 'utf8'), declaration.replace('[agents.reviewer]', '[agents.base_reviewer]'));
				assert.ok(!fs.readFileSync(profilePath, 'utf8').includes('[agents.reviewer]'));
				assert.strictEqual(listManagedAgentRecords(basePath, getAgentLocations(homeDir)).find((record) => record.id === profile.id)?.enabled, false);
				fakePanel.dispatchMessage({ type: 'toggleAgent', id: profile.id, enabled: true });
				assert.ok(fs.readFileSync(profilePath, 'utf8').includes('custom-role.toml'));
				assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), roleContents);
				assert.strictEqual(changes, 2);
				const script = fakePanel.panel.webview.html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/);
				assert.ok(script);
				assert.doesNotThrow(() => new Function(script![1]));
			} finally {
				manager.dispose();
				(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = originalCreate;
				(vscode.commands as unknown as { executeCommand: typeof originalExecute }).executeCommand = originalExecute;
			}
		});
	});
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
		assert.ok(source.includes('right: 40px;'));
		assert.ok(source.includes('padding: 12px 56px 12px 12px;'));
		assert.ok(source.includes('confirmOverlay'));
		assert.ok(source.includes('openConfirmDialog(uiText.confirmDeleteWorkflow'));
		assert.ok(source.includes('previewCollapsed: true'));
		assert.ok(source.includes('uiText.selectWorkflow'));
		assert.ok(source.includes('appState.previewCollapsed = false'));
		assert.ok(source.includes('workflowCardDefaultTitle'));
		assert.ok(source.includes('workflowCardDefaultSummary'));
		assert.ok(source.includes("type: 'persistWorkflowState'"));
		assert.ok(source.includes('const restoredState = vscode.getState ? vscode.getState() : undefined;'));
		assert.ok(source.includes('workflow: restoredState && restoredState.workflow'));
		assert.ok(source.includes('vscode.setState(state);'));
		assert.ok(source.includes('data-workflow-field="constraints"'));
		assert.ok(source.includes('constraintsPlaceholder'));
		assert.ok(source.includes('data-workflow-field="finalOutputFormat"'));
		assert.ok(source.includes('workflowOutputFormatPlaceholder'));
		assert.ok(source.includes('function isMarkdownTable('));
		assert.ok(source.includes('function splitMarkdownBlocks('));
		assert.ok(source.includes('function renderMarkdownSafely('));
		assert.ok(source.includes('function getCanvasExtent()'));
		assert.ok(!source.includes("edgeLayer.setAttribute('width', '1600');"));
		assert.ok(!source.includes("edgeLayer.setAttribute('height', '960');"));
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
		assert.ok(!source.includes('data-add-card="output"'));
		assert.ok(!source.includes('data-add-card="review"'));
		assert.ok(!source.includes('validateWorkflowButton'));
		assert.ok(!source.includes('Agent source'));
		assert.ok(!source.includes('<label class="field-label">Role</label>'));
		assert.ok(!source.includes('<label class="field-label">Summary</label>'));
	});

	test('show restores persisted orchestration draft after refresh', async () => {
		await withTempHome(async (homeDir) => {
			const codexDir = path.join(homeDir, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });

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

				const workflow = createEmptyWorkflow('Draft orchestration');
				workflow.description = 'Keep this draft after reopen.';
				workflow.constraints = 'Do not lose unsaved changes.';

				fakePanel.dispatchMessage({
					type: 'persistWorkflowState',
					state: {
						activeTab: 'orchestration',
						workflow,
						selectedWorkflowId: '',
						selection: { kind: 'workflow' },
						validation: { errors: [], warnings: [] },
						prompt: '',
						statusMessage: 'Draft persisted.',
						inspectorCollapsed: false,
						previewCollapsed: true,
					},
				});

				manager.show();

				const html = fakePanel.panel.webview.html;
				assert.ok(html.includes('Draft orchestration'));
				assert.ok(html.includes('Do not lose unsaved changes.'));
				assert.strictEqual(fakePanel.getRevealCount(), 1);
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

	test('show renders agent manager list-detail webview html', async () => {
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
				assert.ok(html.includes('id="agentDetail"'));
				assert.ok(html.includes('agents-bottom-pane'));
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
