import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { getAgentLocations } from '../services/agentLocations';
import { resolveAgentManagerPaths } from '../services/agentManagerService';
import { listHookDiagnostics } from '../services/coreManagerConfigService';
import { createHistoryWebviewPanel } from '../services/historyPanel';
import { resolveCodexHomeDir, resolveSessionsRoot } from '../services/historyService';
import { getOrchestrationDirectory } from '../services/orchestrationService';
import { getPetRootCandidates } from '../services/petService';
import { listPluginRecords } from '../services/pluginService';
import { getSkillLocations } from '../services/skillLocations';
import { getTemplateRootPath } from '../services/templateService';
import { getCoreWorkspaceStatus, getWorkspaceStatus, resolveCodexPaths } from '../services/workspaceStatus';
import { CoreExplorerProvider } from '../views/coreExplorerProvider';
import { FileExplorerProvider } from '../views/fileExplorerProvider';
import { McpExplorerProvider } from '../views/mcpExplorerProvider';

suite('CODEX_HOME integration', () => {
	let originalCodexHome: string | undefined;
	let root: string;
	let codexHome: string;

	setup(() => {
		originalCodexHome = process.env.CODEX_HOME;
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-integration-'));
		codexHome = path.join(root, 'runtime home');
		process.env.CODEX_HOME = codexHome;
		fs.mkdirSync(codexHome, { recursive: true });
		fs.writeFileSync(path.join(codexHome, 'config.toml'), '[mcp_servers.runtime]\ncommand = "node"\n');
	});

	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('Core, Skills, Agents, Templates, Pets and History share the configured root', () => {
		const fallbackHome = path.join(root, 'user-home');
		assert.strictEqual(resolveCodexPaths(fallbackHome).codexDir, codexHome);
		assert.strictEqual(resolveCodexHomeDir(fallbackHome), codexHome);
		assert.strictEqual(resolveSessionsRoot(), path.join(codexHome, 'sessions'));
		assert.strictEqual(getWorkspaceStatus(fallbackHome).isAvailable, true);
		assert.strictEqual(getCoreWorkspaceStatus(fallbackHome).isAvailable, true);
		assert.deepStrictEqual(resolveAgentManagerPaths(), {
			codexDir: codexHome,
			configPath: path.join(codexHome, 'config.toml'),
		});
		const skills = getSkillLocations(fallbackHome, path.join(root, 'project'));
		assert.strictEqual(skills.find((location) => location.kind === 'workspace')?.rootPath, path.join(codexHome, 'skills'));
		assert.strictEqual(skills.find((location) => location.kind === 'system')?.rootPath, path.join(codexHome, 'skills', '.system'));
		assert.strictEqual(skills.find((location) => location.kind === 'user')?.rootPath, path.join(fallbackHome, '.agents', 'skills'));
		const agents = getAgentLocations(fallbackHome, path.join(root, 'project'));
		assert.deepStrictEqual(agents.map((location) => location.rootPath), [
			path.join(root, 'project', '.codex', 'agents'),
			path.join(codexHome, 'agents'),
		]);
		assert.strictEqual(getTemplateRootPath(fallbackHome), path.join(codexHome, 'codex-templates'));
		assert.deepStrictEqual(getPetRootCandidates(fallbackHome), [path.join(codexHome, 'pets'), path.join(codexHome, 'pet')]);
		assert.strictEqual(getOrchestrationDirectory(), path.join(codexHome, '.codex-workspace', 'orchestrations'));
		const hooks = listHookDiagnostics(undefined, fallbackHome, path.join(root, 'project'));
		assert.ok(hooks.sources.some((source) => source.path === path.join(codexHome, 'hooks.json')));
		assert.ok(hooks.sources.some((source) => source.path === path.join(root, 'project', '.codex', 'hooks.json')));
	});

	test('Explorer roots and MCP records use the configured config and folders', async () => {
		const context = { asAbsolutePath: (value: string) => path.join(root, value) } as vscode.ExtensionContext;
		for (const [kind, folder] of [['prompts', 'prompts'], ['templates', 'codex-templates'], ['skills', 'skills']] as const) {
			const provider = new FileExplorerProvider(kind, context);
			assert.strictEqual(provider.getRootPath(), path.join(codexHome, folder));
		}
		const coreItems = await new CoreExplorerProvider(context).getChildren();
		assert.strictEqual(coreItems?.[0].fsPath, path.join(codexHome, 'config.toml'));
		assert.strictEqual(coreItems?.[1].fsPath, path.join(codexHome, 'AGENTS.md'));
		const mcpItems = await new McpExplorerProvider(context).getChildren();
		assert.deepStrictEqual(mcpItems?.map((item) => item.label), ['runtime']);
	});

	test('Plugin discovery and enabled state come from the same Codex home', () => {
		const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'market', 'demo', '1.0.0');
		fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
		fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
		fs.appendFileSync(path.join(codexHome, 'config.toml'), '\n[plugins."demo@market"]\nenabled = false\n');
		const plugins = listPluginRecords({ homeDir: path.join(root, 'user-home') });
		assert.strictEqual(plugins.length, 1);
		assert.strictEqual(plugins[0].installedPath, pluginRoot);
		assert.strictEqual(plugins[0].enabled, false);
	});

	test('Codex Manager permits plugin images under CODEX_HOME', () => {
		const originalCreate = vscode.window.createWebviewPanel;
		let resourceRoots: readonly vscode.Uri[] | undefined;
		(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = (_type, _title, _column, options) => {
			resourceRoots = options?.localResourceRoots;
			return {} as vscode.WebviewPanel;
		};
		try {
			createHistoryWebviewPanel();
			assert.ok(resourceRoots?.some((uri) => uri.fsPath === path.join(codexHome, 'plugins', 'cache')));
		} finally {
			(vscode.window as unknown as { createWebviewPanel: typeof originalCreate }).createWebviewPanel = originalCreate;
		}
	});
});
