import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { getUnavailableLabel } from '../services/workspaceStatus';
import { AgentExplorerProvider } from '../views/agentExplorerProvider';
import { AgentLocation } from '../services/agentLocations';
import { disableAgentByName, listAgentManagerRecords, refreshAgentManagerRecords } from '../services/agentManagerService';
import { CodexTreeItem } from '../models/treeItems';

suite('Agent explorer provider', () => {
	test('uses the same actual files, declaration identities and state as the Agents tab', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-inventory-'));
		try {
			const agentsDir = path.join(root, 'agents');
			fs.mkdirSync(agentsDir);
			fs.writeFileSync(path.join(agentsDir, 'alpha.toml'), '');
			fs.writeFileSync(path.join(agentsDir, 'beta.toml'), '');
			fs.writeFileSync(path.join(agentsDir, 'ignored.toml.bak'), '');
			fs.writeFileSync(path.join(agentsDir, 'README.md'), '');
			fs.mkdirSync(path.join(agentsDir, 'directory.toml'));
			const configPath = path.join(root, 'config.toml');
			const profilePath = path.join(root, 'review.config.toml');
			const block = `[agents.'review role'] # alias\nconfig_file = 'agents/alpha.toml'\n`;
			fs.writeFileSync(configPath, block + '[agents.ghost]\nconfig_file = "missing.toml"\n[agents.inline]\ndescription = "No file"\n');
			fs.writeFileSync(profilePath, block);
			const locations: AgentLocation[] = [{ kind: 'workspace', label: 'Workspace Agents', rootPath: agentsDir, priority: 2 }];
			disableAgentByName(root, profilePath, 'review role');
			const provider = new AgentExplorerProvider({} as vscode.ExtensionContext, () => ({ isAvailable: true }),
				() => refreshAgentManagerRecords(configPath, locations), () => locations);
			const items = provider.getChildren() as CodexTreeItem[];
			const records = listAgentManagerRecords(configPath, locations);
			assert.strictEqual(items.length, 3);
			assert.deepStrictEqual(items.map((item) => item.id), records.map((record) => record.id));
			assert.deepStrictEqual(items.map((item) => item.agentRecord?.enabled), [true, false, false]);
			assert.deepStrictEqual(items.map((item) => item.label), ['review role (alpha.toml)', 'review role (alpha.toml)', 'beta.toml']);
			assert.deepStrictEqual(items.map((item) => (item.iconPath as vscode.ThemeIcon).id), ['hubot', 'circle-slash', 'circle-slash']);
			assert.strictEqual(items[1].description, 'Profile: review');
			assert.strictEqual(items[0].command?.command, 'codex-workspace.openFile');
			assert.strictEqual(items[0].contextValue, 'codex-agent-file');
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	test('returns unavailable item when not available', () => {
		const provider = new AgentExplorerProvider({} as vscode.ExtensionContext,
			() => ({ isAvailable: false, reason: 'missing' }), () => []);
		const items = provider.getChildren() as vscode.TreeItem[];
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].label, getUnavailableLabel('missing'));
	});
});
