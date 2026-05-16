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

	test('does not include mcp server ids ending with .env', () => {
		const input = [
			'[mcp_servers.alpha]',
			'enabled = true',
			'',
			'[mcp_servers.shadcn.env]',
			'enabled = true',
			'',
			'[mcp_servers.beta]',
			'enabled = false',
		].join('\n');
		const servers = parseMcpServers(input);
		assert.strictEqual(servers.length, 2);
		assert.deepStrictEqual(
			servers.map((server) => server.id),
			['alpha', 'beta'],
		);
	});

	test('does not include companion settings blocks in the server list', () => {
		const input = [
			'[mcp_servers.context7]',
			'command = "npx"',
			'',
			'[mcp_servers.context7.env_http_headers]',
			'AUTHORIZATION = "Bearer token"',
			'',
			'[mcp_servers.beta]',
			'enabled = false',
		].join('\n');
		const servers = parseMcpServers(input);
		assert.strictEqual(servers.length, 2);
		assert.deepStrictEqual(
			servers.map((server) => server.id),
			['context7', 'beta'],
		);
	});

	test('parses and toggles quoted mcp server headers', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-'));
		const configPath = path.join(tempDir, 'config.toml');
		try {
			const input = [
				'[mcp_servers."github.enterprise"]',
				'enabled = false',
				'command = "gh"',
			].join('\n');
			fs.writeFileSync(configPath, input, 'utf8');

			const servers = parseMcpServers(input);
			assert.strictEqual(servers.length, 1);
			assert.strictEqual(servers[0].id, 'github.enterprise');
			assert.strictEqual(servers[0].enabled, false);

			const updated = toggleMcpServer(configPath, 'github.enterprise');
			assert.strictEqual(updated, true);
			assert.ok(fs.readFileSync(configPath, 'utf8').includes('enabled = true'));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
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

	test('toggleMcpServer does not write enabled into companion settings blocks', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-'));
		const configPath = path.join(tempDir, 'config.toml');
		try {
			const input = [
				'[mcp_servers.context7]',
				'command = "npx"',
				'',
				'[mcp_servers.context7.env_http_headers]',
				'AUTHORIZATION = "Bearer token"',
			].join('\n');
			fs.writeFileSync(configPath, input, 'utf8');

			const updated = toggleMcpServer(configPath, 'context7');
			assert.strictEqual(updated, true);
			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('[mcp_servers.context7]\nenabled = false\ncommand = "npx"'));
			assert.ok(
				contents.includes(
					'[mcp_servers.context7.env_http_headers]\nAUTHORIZATION = "Bearer token"',
				),
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
