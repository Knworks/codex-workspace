import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { getAgentLocations } from '../services/agentLocations';
import { getConfigTomlBackupPath, organizeConfigToml } from '../services/configTomlOrganizerService';
import { resolveCodexHomeDir, resolveSessionsRoot } from '../services/historyService';
import { createHistoryWebviewPanel } from '../services/historyPanel';
import { getPetRootCandidates } from '../services/petService';
import { listPluginRecords } from '../services/pluginService';
import { getSkillLocations } from '../services/skillLocations';
import { syncCoreFilesBidirectional } from '../services/syncService';
import { getTemplateRootPath } from '../services/templateService';
import { getWorkspaceStatus, resolveCodexPaths } from '../services/workspaceStatus';

suite('Codex home across services', () => {
	let originalCodexHome: string | undefined;
	let tempRoot: string;

	setup(() => {
		originalCodexHome = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-paths-'));
	});

	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	for (const value of [undefined, '', '   ']) {
		test(`falls back to the user home for CODEX_HOME=${JSON.stringify(value)}`, () => {
			if (value !== undefined) {
				process.env.CODEX_HOME = value;
			}
			const expected = path.join(tempRoot, '.codex');
			assert.strictEqual(resolveCodexHomeDir(tempRoot), expected);
			assert.deepStrictEqual(resolveCodexPaths(tempRoot), {
				codexDir: expected,
				configPath: path.join(expected, 'config.toml'),
			});
		});
	}

	for (const overridden of [false, true]) {
		test(`services use the ${overridden ? 'configured' : 'default'} Codex home`, () => {
			const userHome = path.join(tempRoot, 'user');
			const codexHome = overridden
				? path.join(tempRoot, 'custom home 日本語')
				: path.join(userHome, '.codex');
			if (overridden) {
				process.env.CODEX_HOME = codexHome;
			}
			const configPath = path.join(codexHome, 'config.toml');
			fs.mkdirSync(codexHome, { recursive: true });
			const contents = 'model = "test"\n';
			fs.writeFileSync(configPath, contents, 'utf8');
			assert.deepStrictEqual(resolveCodexPaths(userHome), { codexDir: codexHome, configPath });
			assert.strictEqual(getWorkspaceStatus(userHome).isAvailable, true);
			assert.strictEqual(resolveCodexHomeDir(userHome), codexHome);
			assert.strictEqual(resolveSessionsRoot(resolveCodexHomeDir(userHome)), path.join(codexHome, 'sessions'));
			if (overridden) {
				assert.strictEqual(resolveSessionsRoot(), path.join(codexHome, 'sessions'));
			}
			const projectRoot = path.join(tempRoot, 'project');
			const agents = getAgentLocations(userHome, projectRoot);
			assert.deepStrictEqual(agents.map((location) => location.rootPath), [
				path.join(projectRoot, '.codex', 'agents'),
				path.join(codexHome, 'agents'),
			]);
			const skills = getSkillLocations(userHome, projectRoot);
			assert.strictEqual(skills.find((location) => location.kind === 'workspace')?.rootPath, path.join(codexHome, 'skills'));
			assert.strictEqual(skills.find((location) => location.kind === 'system')?.rootPath, path.join(codexHome, 'skills', '.system'));
			assert.strictEqual(skills.find((location) => location.kind === 'user')?.rootPath, path.join(userHome, '.agents', 'skills'));
			assert.strictEqual(getTemplateRootPath(userHome), path.join(codexHome, 'codex-templates'));
			assert.ok(getPetRootCandidates(userHome).every((root) => root.startsWith(`${codexHome}${path.sep}`)));

			const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'test-market', 'demo', '1.0.0');
			fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
			fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
			assert.deepStrictEqual(listPluginRecords({ homeDir: userHome }).map((plugin) => plugin.installedPath), [pluginRoot]);
			if (overridden) {
				const panel = createHistoryWebviewPanel();
				try {
					const expectedRoot = vscode.Uri.file(path.join(codexHome, 'plugins', 'cache')).toString();
					assert.ok(panel.webview.options.localResourceRoots?.some((root) => root.toString() === expectedRoot));
				} finally {
					panel.dispose();
				}
			}

			const syncRoot = path.join(tempRoot, 'sync');
			syncCoreFilesBidirectional(resolveCodexPaths(userHome).codexDir, syncRoot);
			assert.strictEqual(fs.readFileSync(path.join(syncRoot, 'config.toml'), 'utf8'), contents);
			organizeConfigToml(resolveCodexPaths(userHome).configPath);
			assert.strictEqual(fs.readFileSync(getConfigTomlBackupPath(configPath), 'utf8'), contents);
			assert.strictEqual(getConfigTomlBackupPath(configPath), path.join(codexHome, '.codex-workspace', 'config.toml.bk'));
		});
	}
});
