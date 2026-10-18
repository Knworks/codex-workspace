/// <reference lib="dom" />
import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, type Browser, type Frame } from 'playwright-core';
import * as vscode from 'vscode';
import { AgentManagerPanelManager } from '../services/agentManagerPanel';
import { getAgentLocations } from '../services/agentLocations';
import { deleteAgentFile, getAgentManagerStorePath } from '../services/agentManagerService';
import { listManagedAgentRecords } from '../services/managedAgentService';
import { saveDisabledAgentBlock } from '../services/disabledAgentsStore';
import { AgentExplorerProvider } from '../views/agentExplorerProvider';
import { CodexTreeItem } from '../models/treeItems';

async function waitFor<T>(read: () => Promise<T | undefined>, description: string): Promise<T> {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		const result = await read();
		if (result !== undefined) { return result; }
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function findAgentsFrame(browser: Browser): Promise<Frame> {
	return waitFor(async () => {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (!frame.url().includes('webview')) { continue; }
					if (await frame.locator('#agentsList .agent-row').count() > 0) { return frame; }
				}
			}
		}
		return undefined;
	}, 'the Agents Webview');
}

suite('Agent manager Webview interaction', () => {
	test('switch clicks and Space save only the selected declaration and preserve list actions', async function () {
		this.timeout(120000);
		const debugPort = process.env.AGENT_WEBVIEW_DEBUG_PORT;
		assert.ok(debugPort, 'Run through vscode-test with .vscode-test.mjs');
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-webview-'));
		const envKeys = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'CODEX_HOME'] as const;
		const previousEnv = envKeys.map((key) => process.env[key]);
		const workspaceDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
		const originalCreate = vscode.window.createWebviewPanel;
		const originalExecute = vscode.commands.executeCommand;
		const originalPick = vscode.window.showQuickPick;
		let browser: Browser | undefined;
		let panel: vscode.WebviewPanel | undefined;
		let manager: AgentManagerPanelManager | undefined;
		const messages: Array<{ type: string; id?: string; enabled?: boolean }> = [];
		const opened: string[] = [];
		try {
			process.env.HOME = root;
			process.env.USERPROFILE = root;
			process.env.HOMEDRIVE = '';
			process.env.HOMEPATH = root;
			process.env.CODEX_HOME = '';
			const projectRoot = vscode.Uri.file(path.join(root, 'project')).fsPath;
			Object.defineProperty(vscode.workspace, 'workspaceFolders', {
				configurable: true,
				value: [{ uri: vscode.Uri.file(projectRoot), name: 'fixture', index: 0 }],
			});
			const codexDir = path.join(root, '.codex');
			const projectCodexDir = path.join(projectRoot, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(projectCodexDir, { recursive: true });
			const sources = [path.join(codexDir, 'config.toml'), path.join(codexDir, 'review.config.toml'), path.join(projectCodexDir, 'config.toml')];
			const declarations = sources.map((_, index) => `[agents.reviewer${index}]\ndescription = "Source ${index}"\nconfig_file = "role.toml"\n`);
			for (const [index, source] of sources.entries()) { fs.writeFileSync(source, declarations[index]); }
			for (const dir of [codexDir, projectCodexDir]) { fs.writeFileSync(path.join(dir, 'role.toml'), 'model = "test-model"\n'); }
			const staleStore = getAgentManagerStorePath(sources[0]);
			saveDisabledAgentBlock(staleStore, 'deleted', '[agents.deleted]\nconfig_file = "agents/deleted.toml"\n');
			const records = () => listManagedAgentRecords(sources[0], getAgentLocations(root, projectRoot));
			const staleBytes = fs.readFileSync(staleStore);
			assert.strictEqual(records().length, 4);
			vscode.window.showQuickPick = (async (items: Array<{ configPath?: string }>) => items.find((item) => item.configPath === sources[1])) as unknown as typeof originalPick;

			(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = (...args) => {
				panel = originalCreate(...args);
				panel.webview.onDidReceiveMessage((message) => messages.push(message));
				return panel;
			};
			(vscode.commands as unknown as { executeCommand: typeof originalExecute }).executeCommand = (async (command: string, ...args: unknown[]) => {
				if (command === 'vscode.open') {
					opened.push((args[0] as vscode.Uri).fsPath);
					return undefined;
				}
				return originalExecute(command, ...args);
			}) as typeof originalExecute;
			manager = new AgentManagerPanelManager(() => undefined);
			manager.show();
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
			const connectedBrowser = browser;
			let frame = await findAgentsFrame(browser);
			assert.strictEqual(await frame.locator('.agent-row').count(), 4);
			assert.deepStrictEqual(fs.readFileSync(staleStore), staleBytes);
			const explorer = new AgentExplorerProvider({} as vscode.ExtensionContext);
			assert.deepStrictEqual((explorer.getChildren() as CodexTreeItem[]).map((item) => item.id), records().map((record) => record.id));
			const row = (index: number) => frame.locator('article.agent-row').filter({ hasText: `Source ${index}` });

			// Each action starts in the DOM and crosses the real Webview message boundary.
			for (const action of ['span', 'label', 'input', 'Space'] as const) {
				for (const sourceIndex of [0, 1, 2]) {
					for (const enabled of [false, true]) {
						frame = await findAgentsFrame(connectedBrowser);
						await frame.locator('#searchInput').fill('');
						// Cover a selected and an unselected row, including an active search.
						await row(sourceIndex === 0 ? 1 : 0).locator('.agent-title').click();
						if (enabled) { await row(sourceIndex).locator('.agent-title').click(); }
						if (action === 'span') { await frame.locator('#searchInput').fill('reviewer'); }
						const selectedId = await frame.locator('.agent-row.active').getAttribute('data-agent-id');
						const record = records().find((item) => item.configPath === sources[sourceIndex] && item.roleKey === `reviewer${sourceIndex}`)!;
						const before = sources.map((source) => fs.readFileSync(source, 'utf8'));
						const start = messages.filter((message) => message.type === 'toggleAgent').length;
						const checkbox = row(sourceIndex).locator('input');
						assert.strictEqual(await checkbox.isChecked(), !enabled);
						if (action === 'Space') {
							// Tab must reach the native input; a script-only key event would not test this.
							await row(sourceIndex).locator('[data-open-path]').focus();
							await row(sourceIndex).locator('[data-open-path]').press('Shift+Tab');
							assert.strictEqual(await checkbox.evaluate((input) => input === input.ownerDocument.activeElement), true);
							assert.strictEqual(await row(sourceIndex).locator('.switch span').evaluate((span) => getComputedStyle(span).outlineStyle), 'solid');
							await checkbox.press('Space');
						} else if (action === 'input') {
							await checkbox.evaluate((input) => (input as HTMLInputElement).click());
						} else {
							await row(sourceIndex).locator(action === 'span' ? '.switch span' : '.switch').click();
						}
						await waitFor(async () => records().find((item) => item.id === record.id)?.enabled === enabled ? true : undefined,
							`${action}: source ${sourceIndex} enabled=${enabled}`);
						// Saving refreshes the entire Webview, so observe the new document.
						const previousFrame = frame;
						await waitFor(async () => previousFrame.isDetached() ? true : undefined, 'the saved Webview to reload');
						frame = await findAgentsFrame(connectedBrowser);
						await row(sourceIndex).locator('input').waitFor({ state: 'attached' });
						assert.strictEqual(await row(sourceIndex).locator('input').isChecked(), enabled);
						assert.strictEqual(await frame.locator('.agent-row.active').getAttribute('data-agent-id'), selectedId);
						assert.deepStrictEqual(messages.filter((message) => message.type === 'toggleAgent').slice(start), [
							{ type: 'toggleAgent', id: record.id, enabled },
						]);
						for (const [index, source] of sources.entries()) {
							if (index !== sourceIndex) { assert.strictEqual(fs.readFileSync(source, 'utf8'), before[index]); }
						}
						assert.strictEqual(fs.readFileSync(sources[sourceIndex], 'utf8').includes(`[agents.reviewer${sourceIndex}]`), enabled);
					}
				}
			}

			await frame.locator('#searchInput').fill('Source 2');
			assert.strictEqual(await frame.locator('article.agent-row').count(), 1);
			await frame.locator('#clearSearch').click();
			assert.strictEqual(await frame.locator('article.agent-row').count(), 4);
			await row(1).locator('.agent-title').click();
			assert.ok((await row(1).getAttribute('class'))?.includes('active'));
			assert.ok((await frame.locator('#agentDetail').textContent())?.includes('Profile: review'));
			await row(2).locator('[data-open-path] span').click();
			await waitFor(async () => opened.length === 1 ? true : undefined, 'Open');
			assert.strictEqual(opened[0], path.join(projectCodexDir, 'role.toml'));
			assert.ok((await row(1).getAttribute('class'))?.includes('active'));

			// Removing a shared physical file removes both Base and Profile references.
			deleteAgentFile(path.join(codexDir, 'role.toml'), sources[0]);
			const previousFrame = frame;
			manager.refresh();
			await waitFor(async () => previousFrame.isDetached() ? true : undefined, 'deleted-file refresh');
			frame = await findAgentsFrame(connectedBrowser);
			assert.strictEqual(await frame.locator('.agent-row').count(), 2);
			assert.strictEqual(await row(2).count(), 1);
			assert.strictEqual((explorer.getChildren() as CodexTreeItem[]).length, 2);
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir);
			const availableContents = 'model = "available"\ndescription = "Available agent description"\n';
			fs.writeFileSync(path.join(agentsDir, 'available.toml'), availableContents);
			const beforeAddition = frame;
			manager.refresh();
			await waitFor(async () => beforeAddition.isDetached() ? true : undefined, 'new-file refresh');
			frame = await findAgentsFrame(connectedBrowser);
			const available = () => frame.locator('.agent-row').filter({ hasText: 'available.toml' });
			assert.strictEqual(await available().locator('input').isChecked(), false);
			assert.strictEqual(await available().locator('input').isDisabled(), true);
			assert.strictEqual(await available().locator('.agent-description').textContent(), 'Available agent description');
			const beforeEnable = frame;
			await available().locator('[data-register-agent]').click();
			await waitFor(async () => beforeEnable.isDetached() ? true : undefined, 'unregistered-file enable');
			frame = await findAgentsFrame(connectedBrowser);
			assert.strictEqual(await available().locator('input').isChecked(), true);
			assert.ok(!fs.readFileSync(sources[0], 'utf8').includes('agents/available.toml'));
			assert.ok(fs.readFileSync(sources[1], 'utf8').includes('agents/available.toml'));
			assert.ok(fs.readFileSync(sources[1], 'utf8').includes('description = "Available agent description"'));
			assert.strictEqual(await available().locator('.agent-description').textContent(), 'Available agent description');
			assert.strictEqual(fs.readFileSync(path.join(agentsDir, 'available.toml'), 'utf8'), availableContents);
			assert.deepStrictEqual((explorer.getChildren() as CodexTreeItem[]).map((item) => item.id), records().map((record) => record.id));

			// A standalone file is immediately available and toggles by renaming, without registration.
			const standalonePath = path.join(agentsDir, 'external.toml');
			const standaloneBytes = 'name = "body-name"\ndescription = "External standalone"\ndeveloper_instructions = "Review changes."\n';
			fs.writeFileSync(standalonePath, standaloneBytes);
			const beforeStandalone = sources.map((source) => fs.readFileSync(source));
			const priorFrame = frame;
			manager.refresh();
			await waitFor(async () => priorFrame.isDetached() ? true : undefined, 'external standalone refresh');
			frame = await findAgentsFrame(connectedBrowser);
			const standaloneRow = () => frame.locator('.agent-row').filter({ hasText: 'External standalone' });
			assert.strictEqual(await standaloneRow().locator('input').isChecked(), true);
			assert.strictEqual(await standaloneRow().locator('[data-register-agent]').count(), 0);
			await standaloneRow().locator('[data-open-path]').click();
			await waitFor(async () => opened.length === 2 ? true : undefined, 'standalone Open');
			assert.strictEqual(opened[1], vscode.Uri.file(standalonePath).fsPath);
			for (const enabled of [false, true]) {
				const previous = frame;
				await standaloneRow().locator('.switch span').click();
				await waitFor(async () => previous.isDetached() ? true : undefined, 'standalone toggle');
				frame = await findAgentsFrame(connectedBrowser);
				assert.strictEqual(await standaloneRow().locator('input').isChecked(), enabled);
				assert.strictEqual(fs.existsSync(standalonePath), enabled);
			}
			assert.deepStrictEqual(sources.map((source) => fs.readFileSync(source)), beforeStandalone);
			assert.strictEqual(fs.readFileSync(standalonePath, 'utf8'), standaloneBytes);
			const malformedPath = path.join(agentsDir, 'malformed.toml');
			fs.writeFileSync(malformedPath, 'name = [');
			const beforeDiagnostics = frame;
			manager.refresh();
			await waitFor(async () => beforeDiagnostics.isDetached() ? true : undefined, 'diagnostic refresh');
			frame = await findAgentsFrame(connectedBrowser);
			const malformedRow = frame.locator('.agent-row').filter({ hasText: 'malformed.toml' });
			assert.strictEqual(await malformedRow.locator('input').isDisabled(), true);
			assert.ok((await malformedRow.locator('.agent-diagnostic').textContent())?.includes('Cannot read Agent TOML'));
			assert.strictEqual(await standaloneRow().locator('input').isChecked(), true);
			const missingRow = frame.locator('.agent-row').filter({ hasText: 'deleted.toml' });
			assert.strictEqual(await missingRow.locator('input').isDisabled(), true);
			await missingRow.locator('[data-open-id]').click();
			await waitFor(async () => opened.length === 3 ? true : undefined, 'missing reference Open');
			assert.strictEqual(opened[2], vscode.Uri.file(sources[0]).fsPath);
			assert.deepStrictEqual(fs.readFileSync(staleStore), staleBytes);
		} finally {
			manager?.dispose();
			await browser?.close();
			(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = originalCreate;
			(vscode.commands as unknown as { executeCommand: typeof originalExecute }).executeCommand = originalExecute;
			vscode.window.showQuickPick = originalPick;
			if (workspaceDescriptor) { Object.defineProperty(vscode.workspace, 'workspaceFolders', workspaceDescriptor); }
			for (const [index, key] of envKeys.entries()) {
				if (previousEnv[index] === undefined) { delete process.env[key]; }
				else { process.env[key] = previousEnv[index]; }
			}
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
