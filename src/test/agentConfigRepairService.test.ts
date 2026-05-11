import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { repairAgentConfigContents } from '../services/agentConfigRepairService';
import { AgentLocation } from '../services/agentLocations';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-repair-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Agent config repair service', () => {
	test('repairs agent description and config_file from the actual agent file', () => {
		withTempDir((root) => {
			const configPath = path.join(root, '.codex', 'config.toml');
			const projectAgentsRoot = path.join(root, 'project', '.codex', 'agents');
			const workspaceAgentsRoot = path.join(root, '.codex', 'agents');
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.mkdirSync(projectAgentsRoot, { recursive: true });
			fs.mkdirSync(workspaceAgentsRoot, { recursive: true });
			fs.writeFileSync(
				path.join(projectAgentsRoot, 'architect.toml'),
				'description = "Architecture specialist"\nmodel = "gpt-5.4"\n',
				'utf8',
			);
			const original = [
				'[agents.architect]',
				'description = ""',
				'config_file = "agents/architect.toml"',
				'',
			].join('\n');
			const locations: AgentLocation[] = [
				{
					kind: 'project',
					label: 'Project Agents',
					rootPath: projectAgentsRoot,
					priority: 1,
				},
				{
					kind: 'workspace',
					label: 'Workspace Agents',
					rootPath: workspaceAgentsRoot,
					priority: 2,
				},
			];

			const repaired = repairAgentConfigContents(original, configPath, locations);

			assert.strictEqual(repaired.changed, true);
			assert.ok(repaired.contents.includes('description = "Architecture specialist"'));
			assert.ok(
				repaired.contents.includes(
					`config_file = "${path.relative(path.dirname(configPath), path.join(projectAgentsRoot, 'architect.toml'))}"`,
				),
			);
		});
	});
});
