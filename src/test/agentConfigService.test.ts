import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	appendAgentConfigRawBlock,
	appendAgentConfigBlock,
	buildAgentConfigBlock,
	ensureAgentTomlRequiredFields,
	extractAgentConfigBlock,
	getAgentDescription,
	getAgentConfigFile,
	hasAgentConfigBlock,
	readAgentTomlDescription,
	syncAgentTomlMetadata,
	toAgentConfigFilePath,
	upsertAgentTomlMetadata,
	upsertAgentConfigBlock,
	upsertAgentConfigMetadata,
	validateAgentTomlContents,
} from '../services/agentConfigService';

suite('Agent config service', () => {
	test('appendAgentConfigBlock appends minimal block', () => {
		const original = '[mcp_servers.sample]\nenabled = true\n';
		const result = appendAgentConfigBlock(original, 'reviewer', 'Security reviewer');
		assert.strictEqual(result.appended, true);
		assert.ok(result.contents.includes('[agents.reviewer]'));
		assert.ok(result.contents.includes('description = "Security reviewer"'));
		assert.ok(result.contents.includes('config_file = "agents/reviewer.toml"'));
	});

	test('appendAgentConfigBlock does not overwrite existing block', () => {
		const original = [
			'[agents.reviewer]',
			'description = "existing"',
			'config_file = "agents/reviewer.toml"',
			'',
		].join('\n');
		const result = appendAgentConfigBlock(original, 'reviewer', 'next');
		assert.strictEqual(result.appended, false);
		assert.strictEqual(result.contents, original);
	});

	test('upsertAgentConfigBlock replaces current block with renamed id', () => {
		const original = [
			'[agents.old_agent]',
			'description = "old"',
			'config_file = "agents/old_agent.toml"',
			'',
			'[mcp_servers.a]',
			'enabled = true',
			'',
		].join('\n');
		const updated = upsertAgentConfigBlock(
			original,
			'old_agent',
			'new-agent',
			'new description',
		);
		assert.ok(!updated.includes('[agents.old_agent]'));
		assert.ok(updated.includes('[agents.new-agent]'));
		assert.ok(updated.includes('description = "new description"'));
		assert.ok(updated.includes('config_file = "agents/new-agent.toml"'));
	});

	test('helpers detect and read description', () => {
		const contents = [
			'[agents.alpha]',
			'description = "Alpha reviewer"',
			'config_file = "agents/alpha.toml"',
			'',
		].join('\n');
		assert.strictEqual(hasAgentConfigBlock(contents, 'alpha'), true);
		assert.strictEqual(getAgentDescription(contents, 'alpha'), 'Alpha reviewer');
		assert.strictEqual(getAgentConfigFile(contents, 'alpha'), 'agents/alpha.toml');
	});

	test('upsertAgentConfigMetadata corrects description and config_file while preserving block comments', () => {
		const original = [
			'[agents.alpha]',
			'description = "Old" # keep',
			'# keep this comment',
			'config_file = "agents/old.toml" # keep',
			'',
		].join('\n');
		const updated = upsertAgentConfigMetadata(
			original,
			'alpha',
			'New',
			'../project/.codex/agents/alpha.toml',
		);
		assert.ok(updated.includes('description = "New" # keep'));
		assert.ok(updated.includes('# keep this comment'));
		assert.ok(updated.includes('config_file = "../project/.codex/agents/alpha.toml" # keep'));
	});

	test('upsertAgentTomlMetadata corrects name and description while preserving comments', () => {
		const original = [
			'# comment',
			'name = "old_name" # keep',
			'description = "Old" # keep',
			'model = "gpt-5.4"',
			'',
		].join('\n');
		const updated = upsertAgentTomlMetadata(original, 'new_name', 'New');
		assert.ok(updated.includes('name = "new_name" # keep'));
		assert.ok(updated.includes('description = "New" # keep'));
		assert.ok(updated.includes('# comment'));
		assert.ok(updated.includes('model = "gpt-5.4"'));
	});

	test('reads description from agent toml and derives relative config path', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-service-'));
		try {
			const configPath = path.join(tempDir, '.codex', 'config.toml');
			const agentPath = path.join(tempDir, 'project', '.codex', 'agents', 'planner.toml');
			fs.mkdirSync(path.dirname(agentPath), { recursive: true });
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(
				agentPath,
				'description = "Planner"\nmodel = "gpt-5.4"\n',
				'utf8',
			);
			assert.strictEqual(readAgentTomlDescription(agentPath), 'Planner');
			assert.strictEqual(
				toAgentConfigFilePath(configPath, agentPath),
				path.relative(path.dirname(configPath), agentPath),
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('syncAgentTomlMetadata writes missing name and description to file', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-service-'));
		try {
			const agentPath = path.join(tempDir, 'agent.toml');
			fs.writeFileSync(agentPath, 'model = "gpt-5.4"\n', 'utf8');
			const changed = syncAgentTomlMetadata(agentPath, 'planner', 'Planner');
			assert.strictEqual(changed, true);
			const next = fs.readFileSync(agentPath, 'utf8');
			assert.ok(next.includes('name = "planner"'));
			assert.ok(next.includes('description = "Planner"'));
			assert.ok(next.includes('model = "gpt-5.4"'));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('validateAgentTomlContents reports missing developer_instructions', () => {
		const contents = [
			'name = "planner"',
			'description = "Planner"',
			'model = "gpt-5.4"',
			'',
		].join('\n');
		assert.deepStrictEqual(validateAgentTomlContents(contents), [
			'developer_instructions',
		]);
	});

	test('validateAgentTomlContents accepts required custom agent fields', () => {
		const contents = [
			'name = "planner"',
			'description = "Planner"',
			'developer_instructions = """',
			'Plan the work.',
			'"""',
			'',
		].join('\n');
		assert.deepStrictEqual(validateAgentTomlContents(contents), []);
	});

	test('ensureAgentTomlRequiredFields adds fallback developer_instructions', () => {
		const contents = [
			'name = "planner"',
			'description = "Planner"',
			'',
		].join('\n');
		const next = ensureAgentTomlRequiredFields(contents, 'planner', 'Planner');
		assert.ok(next.includes('developer_instructions = """'));
		assert.deepStrictEqual(validateAgentTomlContents(next), []);
	});

	test('buildAgentConfigBlock quotes special agent names', () => {
		const block = buildAgentConfigBlock('beta prod', 'desc');
		assert.ok(block.startsWith('[agents."beta prod"]'));
	});

	test('extractAgentConfigBlock removes target block and keeps comments in block text', () => {
		const contents = [
			'[agents.alpha]',
			'description = "Alpha"',
			'# keep this comment',
			'config_file = "agents/alpha.toml"',
			'',
			'[mcp_servers.a]',
			'enabled = true',
			'',
		].join('\n');
		const extracted = extractAgentConfigBlock(contents, 'alpha');
		assert.strictEqual(extracted.removed, true);
		assert.ok(extracted.block?.includes('# keep this comment'));
		assert.ok(!extracted.contents.includes('[agents.alpha]'));
		assert.ok(extracted.contents.includes('[mcp_servers.a]'));
	});

	test('appendAgentConfigRawBlock appends stashed block as-is', () => {
		const contents = 'title = "ok"\n';
		const block = '[agents.alpha]\ndescription = "Alpha"\nconfig_file = "agents/alpha.toml"\n';
		const appended = appendAgentConfigRawBlock(contents, block);
		assert.ok(appended.includes('[agents.alpha]'));
		assert.ok(appended.includes('description = "Alpha"'));
	});
});
