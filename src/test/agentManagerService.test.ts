import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	disableAgentByName,
	enableAgentByName,
	listAgentManagerRecords,
} from '../services/agentManagerService';
import { AgentLocation } from '../services/agentLocations';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Agent manager service', () => {
	test('listAgentManagerRecords reads config and agent toml details', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(agentsDir, 'reviewer.toml'),
				'model = "gpt-5.4"\nmodel_reasoning_effort = "high"\nsandbox_mode = "workspace-write"\n',
				'utf8',
			);
			const configPath = path.join(codexDir, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[agents.reviewer]\ndescription = "Reviews code"\nconfig_file = "agents/reviewer.toml"\n',
				'utf8',
			);
			const location: AgentLocation = {
				kind: 'workspace',
				label: 'Workspace Agents',
				rootPath: agentsDir,
				priority: 2,
			};

			const records = listAgentManagerRecords(configPath, [location]);

			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].name, 'reviewer');
			assert.strictEqual(records[0].description, 'Reviews code');
			assert.strictEqual(records[0].model, 'gpt-5.4');
			assert.strictEqual(records[0].reasoningEffort, 'high');
			assert.strictEqual(records[0].sandboxMode, 'workspace-write');
			assert.strictEqual(records[0].enabled, true);
		});
	});

	test('disableAgentByName stashes block and removes config entry', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const configPath = path.join(codexDir, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[agents.reviewer]\ndescription = "Reviews code"\nconfig_file = "agents/reviewer.toml"\n',
				'utf8',
			);

			disableAgentByName(codexDir, configPath, 'reviewer');

			assert.ok(!fs.readFileSync(configPath, 'utf8').includes('[agents.reviewer]'));
			assert.ok(
				fs.readFileSync(
					path.join(codexDir, '.codex-workspace', 'agents-disabled.json'),
					'utf8',
				).includes('Reviews code'),
			);
		});
	});

	test('enableAgentByName restores stashed block and overwrites existing entry', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const configPath = path.join(codexDir, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[agents.reviewer]\ndescription = "old"\nconfig_file = "agents/reviewer.toml"\n',
				'utf8',
			);
			disableAgentByName(codexDir, configPath, 'reviewer');
			fs.writeFileSync(
				configPath,
				'[agents.reviewer]\ndescription = "new"\nconfig_file = "agents/reviewer.toml"\n',
				'utf8',
			);

			const result = enableAgentByName(codexDir, configPath, 'reviewer');

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.overwritten, true);
			assert.ok(contents.includes('description = "old"'));
			assert.ok(!contents.includes('description = "new"'));
		});
	});
});
