import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseMcpServers, toggleMcpServer } from '../services/mcpService';

suite('MCP service', () => {
	test('parses mcp servers in order', () => {
		const input = [
			'[mcp_servers.alpha]',
			'command = \"a\"',
			'',
			'[mcp_servers.beta]',
			'enabled = false',
		].join('\n');
		const servers = parseMcpServers(input);
		assert.strictEqual(servers.length, 2);
		assert.strictEqual(servers[0].id, 'alpha');
		assert.strictEqual(servers[0].enabled, true);
		assert.strictEqual(servers[1].id, 'beta');
		assert.strictEqual(servers[1].enabled, false);
	});

	test('toggles enabled and preserves comments', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-'));
		const configPath = path.join(tempDir, 'config.toml');
		try {
			const input = [
				'[mcp_servers.alpha]',
				'enabled = true # comment',
				'',
				'[mcp_servers.beta]',
				'command = \"b\"',
			].join('\n');
			fs.writeFileSync(configPath, input, 'utf8');

			const updated = toggleMcpServer(configPath, 'alpha');
			assert.strictEqual(updated, true);
			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('enabled = false # comment'));

			const updatedBeta = toggleMcpServer(configPath, 'beta');
			assert.strictEqual(updatedBeta, true);
			const contentsBeta = fs.readFileSync(configPath, 'utf8');
			assert.ok(
				contentsBeta.includes('[mcp_servers.beta]\nenabled = false\ncommand = \"b\"'),
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
