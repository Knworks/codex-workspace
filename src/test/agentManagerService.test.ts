import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	disableAgentByName,
	enableAgentByName,
	listAgentManagerRecords,
	parseAgentRoleDeclarations,
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
	test('parses role tables, quoted keys and literals while ignoring scalar settings and strings', () => {
		assert.deepStrictEqual(parseAgentRoleDeclarations([
			'developer_instructions = """', '[agents.fake]', '"""',
			'[agents]', 'max_threads = 3', 'enabled = true',
			"[agents.'code reviewer'] # role", "description = 'Review'", "config_file = 'custom.toml'",
			'[agents.inherited]', 'description = "No file"',
		].join('\n')), [
			{ name: 'code reviewer', description: 'Review', configFile: 'custom.toml' },
			{ name: 'inherited', description: 'No file', configFile: '' },
		]);
	});

	test('discovers Base, Profile and Project declarations with absolute and relative paths', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, 'home');
			const projectDir = path.join(root, 'project', '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(projectDir, { recursive: true });
			const rolePath = path.join(root, 'outside-role.toml');
			const originalRole = "model = 'test-model'\n";
			fs.writeFileSync(rolePath, originalRole);
			const sources = [path.join(codexDir, 'config.toml'), path.join(codexDir, 'dev.config.toml'), path.join(projectDir, 'config.toml')];
			for (const [index, source] of sources.entries()) {
				const file = index === 1 ? rolePath.replace(/\\/g, '/') : path.relative(path.dirname(source), rolePath).replace(/\\/g, '/');
				fs.writeFileSync(source, `[agents.reviewer]\ndescription = "source ${index}"\nconfig_file = "${file}"\n`);
			}
			const locations: AgentLocation[] = [
				{ kind: 'workspace', label: 'Workspace Agents', rootPath: path.join(codexDir, 'agents'), priority: 2 },
				{ kind: 'project', label: 'Project Agents', rootPath: path.join(projectDir, 'agents'), priority: 1 },
			];
			const records = listAgentManagerRecords(sources[0], locations);
			assert.strictEqual(records.length, 3);
			assert.strictEqual(new Set(records.map((record) => record.id)).size, 3);
			for (const record of records) {
				assert.strictEqual(record.name, 'reviewer');
				assert.strictEqual(record.agentPath, rolePath);
				assert.strictEqual(record.enabled, true);
				assert.strictEqual(record.previewContent, '');
			}
			// Same role key in each source must have an independent disabled stash.
			for (const source of sources) { disableAgentByName(codexDir, source, 'reviewer'); }
			const disabled = listAgentManagerRecords(sources[0], locations);
			assert.strictEqual(disabled.length, 3);
			assert.ok(disabled.every((record) => !record.enabled && record.agentPath === rolePath));
			assert.deepStrictEqual(disabled.map((record) => record.id), records.map((record) => record.id));
			for (const [index, source] of sources.entries()) {
				enableAgentByName(codexDir, source, 'reviewer');
				assert.ok(fs.readFileSync(source, 'utf8').includes(`source ${index}`));
			}
			assert.ok(listAgentManagerRecords(sources[0], locations).every((record) => record.enabled));
			assert.strictEqual(fs.readFileSync(rolePath, 'utf8'), originalRole);
		});
	});

	test('shows missing role files and roles without config_file without scanning unregistered files', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.mkdirSync(path.join(root, 'agents'));
			fs.writeFileSync(path.join(root, 'agents', 'unregistered.toml'), 'model = "test"');
			fs.writeFileSync(configPath, '[agents.missing]\nconfig_file = "missing.toml"\n[agents.inherited]\ndescription = "Default settings"\n');
			const records = listAgentManagerRecords(configPath, []);
			assert.deepStrictEqual(records.map((record) => record.name), ['missing', 'inherited']);
			assert.strictEqual(records[0].agentPath, path.join(root, 'missing.toml'));
			assert.strictEqual(records[1].agentPath, configPath);
			assert.ok(records.every((record) => record.model === '継承'));
		});
	});

	test('quoted role keys and header comments survive disable and enable', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, "[agents.'code reviewer'] # role\ndescription = 'Review'\nconfig_file = 'other.toml'\n");
			disableAgentByName(root, configPath, 'code reviewer');
			assert.strictEqual(listAgentManagerRecords(configPath, [])[0].enabled, false);
			enableAgentByName(root, configPath, 'code reviewer');
			assert.strictEqual(listAgentManagerRecords(configPath, [])[0].configFile, 'other.toml');
			assert.strictEqual(listAgentManagerRecords(configPath, [])[0].enabled, true);
		});
	});
	test('listAgentManagerRecords reads config and agent toml details', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(agentsDir, 'reviewer.toml'),
				'model = "gpt-5.4"\nmodel_reasoning_effort = "high"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """# Review\n- Check tests\n"""\n',
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
			assert.strictEqual(records[0].previewContent, '# Review\n- Check tests');
		});
	});

	test('listAgentManagerRecords reads developer_instructions from literal toml strings', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(
				path.join(agentsDir, 'reviewer.toml'),
				"model = 'gpt-5.4'\ndeveloper_instructions = '''| Col |\n| --- |\n| Value |\n'''\n",
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
			assert.strictEqual(records[0].previewContent, '| Col |\n| --- |\n| Value |');
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

	test('listAgentManagerRecords keeps disabled agent description from stash', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			const agentsDir = path.join(codexDir, 'agents');
			fs.mkdirSync(agentsDir, { recursive: true });
			fs.writeFileSync(path.join(agentsDir, 'reviewer.toml'), '', 'utf8');
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

			disableAgentByName(codexDir, configPath, 'reviewer');
			const records = listAgentManagerRecords(configPath, [location]);

			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].enabled, false);
			assert.strictEqual(records[0].description, 'Reviews code');
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
