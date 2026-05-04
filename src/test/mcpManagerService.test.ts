import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	deleteMcpServer,
	listMcpFormModels,
	saveMcpServer,
	validateMcpModel,
} from '../services/mcpManagerService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-manager-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('MCP manager service', () => {
	test('listMcpFormModels reads stdio and http servers', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.github]',
					'command = "gh"',
					'args = ["api", "repos"]',
					'',
					'[mcp_servers.remote]',
					'url = "https://example.test/mcp"',
				].join('\n'),
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.strictEqual(models[0].transport, 'stdio');
			assert.deepStrictEqual(models[0].args, ['api', 'repos']);
			assert.deepStrictEqual(models[0].env, []);
			assert.strictEqual(models[1].transport, 'http');
			assert.strictEqual(models[1].url, 'https://example.test/mcp');
		});
	});

	test('listMcpFormModels reads companion env block entries', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.github]',
					'command = "gh"',
					'',
					'[mcp_servers.github.env]',
					"TOKEN = 'x'",
					"API_KEY = 'y'",
				].join('\n'),
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.deepStrictEqual(models[0].env, [
				{ key: 'TOKEN', value: 'x' },
				{ key: 'API_KEY', value: 'y' },
			]);
		});
	});

	test('saveMcpServer updates block and preserves unsupported keys', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[mcp_servers.github]\ncommand = "old"\nhttp_headers = { AUTH = "x" }\n',
				'utf8',
			);

			const result = saveMcpServer(configPath, {
				id: 'github',
				transport: 'http',
				command: '',
				args: [],
				url: 'https://example.test/mcp',
				env: [],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			}, 'github');

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('url = "https://example.test/mcp"'));
			assert.ok(!contents.includes('command = "old"'));
			assert.ok(contents.includes('http_headers = { AUTH = "x" }'));
		});
	});

	test('listMcpFormModels reads quoted server headers', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[mcp_servers."github.enterprise"]\ncommand = "gh"\n',
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.strictEqual(models.length, 1);
			assert.strictEqual(models[0].id, 'github.enterprise');
		});
	});

	test('listMcpFormModels excludes env suffix entries', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env]',
					"API_KEY = 'x'",
				].join('\n'),
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.strictEqual(models.length, 1);
			assert.strictEqual(models[0].id, 'context7');
			assert.deepStrictEqual(models[0].env, [
				{ key: 'API_KEY', value: 'x' },
			]);
		});
	});

	test('saveMcpServer quotes server headers when needed', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');

			const result = saveMcpServer(configPath, {
				id: 'github.enterprise',
				transport: 'stdio',
				command: 'gh',
				args: [],
				url: '',
				env: [],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			});

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('[mcp_servers."github.enterprise"]'));
		});
	});

	test('deleteMcpServer removes only target block', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				'[mcp_servers.a]\ncommand = "a"\n\n[mcp_servers.b]\ncommand = "b"\n',
				'utf8',
			);

			assert.strictEqual(deleteMcpServer(configPath, 'a'), true);
			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(!contents.includes('[mcp_servers.a]'));
			assert.ok(contents.includes('[mcp_servers.b]'));
		});
	});

	test('deleteMcpServer removes matching env block with the target server', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env]',
					"API_KEY = 'x'",
					'',
					'[mcp_servers.other]',
					'command = "node"',
				].join('\n'),
				'utf8',
			);

			assert.strictEqual(deleteMcpServer(configPath, 'context7'), true);
			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(!contents.includes('[mcp_servers.context7]'));
			assert.ok(!contents.includes('[mcp_servers.context7.env]'));
			assert.ok(contents.includes('[mcp_servers.other]'));
		});
	});

	test('validateMcpModel rejects mutually exclusive tools', () => {
		const result = validateMcpModel({
			id: 'github',
			transport: 'stdio',
			command: 'gh',
			args: [],
			url: '',
			env: [],
			enabledTools: ['a'],
			disabledTools: ['b'],
			enabled: true,
		}, []);

		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes('toolsMutuallyExclusive'));
	});

	test('validateMcpModel rejects env rows without keys', () => {
		const result = validateMcpModel({
			id: 'github',
			transport: 'stdio',
			command: 'gh',
			args: [],
			url: '',
			env: [{ key: '', value: 'secret' }],
			enabledTools: [],
			disabledTools: [],
			enabled: true,
		}, []);

		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes('envKeyRequired'));
	});

	test('validateMcpModel rejects invalid env keys', () => {
		const result = validateMcpModel({
			id: 'github',
			transport: 'stdio',
			command: 'gh',
			args: [],
			url: '',
			env: [{ key: 'INVALID-KEY', value: 'secret' }],
			enabledTools: [],
			disabledTools: [],
			enabled: true,
		}, []);

		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes('envKeyInvalid'));
	});

	test('validateMcpModel rejects duplicate env keys', () => {
		const result = validateMcpModel({
			id: 'github',
			transport: 'stdio',
			command: 'gh',
			args: [],
			url: '',
			env: [
				{ key: 'TOKEN', value: 'a' },
				{ key: 'TOKEN', value: 'b' },
			],
			enabledTools: [],
			disabledTools: [],
			enabled: true,
		}, []);

		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes('envKeyDuplicate'));
	});

	test('saveMcpServer writes env entries from the form model', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');

			const result = saveMcpServer(configPath, {
				id: 'context7',
				transport: 'stdio',
				command: 'npx',
				args: ['-y'],
				url: '',
				env: [
					{ key: 'API_KEY', value: 'secret' },
					{ key: 'MODE', value: 'dev' },
				],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			});

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('[mcp_servers.context7.env]'));
			assert.ok(contents.includes("API_KEY = 'secret'"));
			assert.ok(contents.includes("MODE = 'dev'"));
		});
	});

	test('saveMcpServer updates existing companion env block', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env]',
					"PROGRAMFILES = 'C:\\Program Files'",
					"SystemRoot = 'C:\\Windows'",
				].join('\n'),
				'utf8',
			);

			const result = saveMcpServer(configPath, {
				id: 'context7',
				transport: 'stdio',
				command: 'npx',
				args: [],
				url: '',
				env: [
					{ key: 'PROGRAMFILES', value: 'C:\\Program Files' },
					{ key: 'SystemRoot', value: 'C:\\Windows' },
					{ key: 'NEW_KEY', value: 'value' },
				],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			}, 'context7');

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('[mcp_servers.context7.env]'));
			assert.ok(contents.includes("PROGRAMFILES = 'C:\\Program Files'"));
			assert.ok(contents.includes("SystemRoot = 'C:\\Windows'"));
			assert.ok(contents.includes("NEW_KEY = 'value'"));
		});
	});

	test('saveMcpServer removes legacy inline env when companion env block is written', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'env = { OLD = "legacy" }',
				].join('\n'),
				'utf8',
			);

			const result = saveMcpServer(configPath, {
				id: 'context7',
				transport: 'stdio',
				command: 'npx',
				args: [],
				url: '',
				env: [{ key: 'API_KEY', value: 'secret' }],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			}, 'context7');

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(!contents.includes('env = { OLD = "legacy" }'));
			assert.ok(contents.includes('[mcp_servers.context7.env]'));
			assert.ok(contents.includes("API_KEY = 'secret'"));
		});
	});
});
