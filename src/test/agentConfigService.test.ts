import * as assert from 'assert';
import {
	appendAgentConfigBlock,
	buildAgentConfigBlock,
	getAgentDescription,
	hasAgentConfigBlock,
	upsertAgentConfigBlock,
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
	});

	test('buildAgentConfigBlock quotes special agent names', () => {
		const block = buildAgentConfigBlock('beta prod', 'desc');
		assert.ok(block.startsWith('[agents."beta prod"]'));
	});
});
