import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'toml';
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

type ParsedMcpConfig = {
	mcp_servers: Record<string, {
		enabled?: boolean;
		tools: Record<string, Record<string, unknown>>;
	}>;
};

suite('MCP manager service', () => {
	test('keeps commented server boundaries when listing, saving and deleting', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const source = [
				'[mcp_servers.first]',
				'command = "first-command"',
				'notes = """',
				'[mcp_servers.fake] # text only',
				'command = "not-a-command"',
				'"""',
				'[mcp_servers.second] # valid header comment',
				'command = "second-command"',
				'enabled = false',
				'[mcp_servers."second.name".env] # companion',
				'TOKEN = "value#tag"',
				'[mcp_servers."second.name"] # quoted key',
				'command = "quoted-command"',
				'[notes]',
				'text = """',
				'[mcp_servers.fake] # text only',
				'command = "not-a-server"',
				'"""',
			].join('\n');
			fs.writeFileSync(configPath, source, 'utf8');
			const before = toml.parse(source) as { mcp_servers: Record<string, unknown>; notes: unknown };
			const models = listMcpFormModels(configPath);
			assert.deepStrictEqual(models.map((model) => [model.id, model.command, model.enabled]), [
				['first', 'first-command', true],
				['second', 'second-command', false],
				['second.name', 'quoted-command', true],
			]);
			assert.strictEqual(saveMcpServer(configPath, models[0], 'first').ok, true);
			const afterSave = toml.parse(fs.readFileSync(configPath, 'utf8')) as typeof before;
			assert.deepStrictEqual(afterSave.mcp_servers.first, before.mcp_servers.first);
			assert.deepStrictEqual(afterSave.mcp_servers.second, before.mcp_servers.second);
			assert.deepStrictEqual(afterSave.mcp_servers['second.name'], before.mcp_servers['second.name']);
			assert.deepStrictEqual(afterSave.notes, before.notes);
			assert.strictEqual(deleteMcpServer(configPath, 'first'), true);
			const afterDelete = toml.parse(fs.readFileSync(configPath, 'utf8')) as typeof before;
			assert.deepStrictEqual(afterDelete.mcp_servers.second, before.mcp_servers.second);
			assert.deepStrictEqual(afterDelete.mcp_servers['second.name'], before.mcp_servers['second.name']);
			assert.deepStrictEqual(afterDelete.notes, before.notes);
		});
	});

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
			assert.deepStrictEqual(models[0].httpHeaders, []);
			assert.deepStrictEqual(models[0].envHttpHeaders, []);
			assert.deepStrictEqual(models[0].tools, []);
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
			assert.ok(contents.includes('[mcp_servers.github.http_headers]'));
			assert.ok(contents.includes("AUTH = 'x'"));
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

	test('listMcpFormModels reads http_headers, env_http_headers and tools companion blocks', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'url = "https://example.test/mcp"',
					'',
					'[mcp_servers.context7.http_headers]',
					"AUTZ = 'Bearer token'",
					'',
					'[mcp_servers.context7.env_http_headers]',
					"X_API_KEY = 'CONTEXT7_API_KEY'",
					'',
					'[mcp_servers.context7.tools.resolve-library-id]',
					'enabled = true',
					'approval_mode = "prompt"',
				].join('\n'),
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.deepStrictEqual(models[0].httpHeaders, [{ key: 'AUTZ', value: 'Bearer token' }]);
			assert.deepStrictEqual(models[0].envHttpHeaders, [
				{ key: 'X_API_KEY', value: 'CONTEXT7_API_KEY' },
			]);
			assert.deepStrictEqual(models[0].tools, [
				{ name: 'resolve-library-id', enabled: true, approvalMode: 'prompt' },
			]);
		});
	});

	test('listMcpFormModels excludes other companion entries from the server list', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env_http_headers]',
					'AUTHORIZATION = "Bearer token"',
				].join('\n'),
				'utf8',
			);

			const models = listMcpFormModels(configPath);

			assert.strictEqual(models.length, 1);
			assert.strictEqual(models[0].id, 'context7');
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

	test('deleteMcpServer removes other companion blocks with the target server', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env_http_headers]',
					'AUTHORIZATION = "Bearer token"',
					'',
					'[mcp_servers.other]',
					'command = "node"',
				].join('\n'),
				'utf8',
			);

			assert.strictEqual(deleteMcpServer(configPath, 'context7'), true);
			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(!contents.includes('[mcp_servers.context7]'));
			assert.ok(!contents.includes('[mcp_servers.context7.env_http_headers]'));
			assert.ok(contents.includes('[mcp_servers.other]'));
		});
	});

	test('validateMcpModel accepts allow-list and deny-list together', () => {
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

		assert.strictEqual(result.ok, true);
		assert.deepStrictEqual(result.errors, []);
	});

	test('read-save-read preserves current tool settings and unknown TOML values', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, [
				'[mcp_servers.example]',
				'command = "example-mcp"',
				'enabled_tools = ["read", "write"]',
				'disabled_tools = ["write"]',
				'[mcp_servers.example.tools.read]',
				'enabled = true',
				'approval_mode = "writes"',
				'output_token_limit = 4_096',
				'future_option = { mode = "custom", count = 2 }',
				'"future-key" = [',
				'  "first", "second",',
				']',
				"future_text = '''",
				'enabled = false',
				"'''",
				'[mcp_servers.example.tools.write]',
				'future_only = true',
			].join('\n'), 'utf8');
			const original = toml.parse(fs.readFileSync(configPath, 'utf8')) as ParsedMcpConfig;
			const model = listMcpFormModels(configPath)[0];
			assert.strictEqual(model.tools?.[0].approvalMode, 'writes');
			assert.strictEqual(model.tools?.[0].outputTokenLimit, 4096);
			assert.strictEqual(saveMcpServer(configPath, model, model.id).ok, true);
			assert.deepStrictEqual(toml.parse(fs.readFileSync(configPath, 'utf8')), original);
			assert.deepStrictEqual(listMcpFormModels(configPath)[0], model);

			model.id = 'renamed';
			model.env = [{ key: 'MODE', value: 'test' }];
			model.tools = [model.tools![1], { name: 'read', enabled: false, approvalMode: 'prompt', outputTokenLimit: 0 }];
			assert.strictEqual(saveMcpServer(configPath, model, 'example').ok, true);
			const edited = (toml.parse(fs.readFileSync(configPath, 'utf8')) as ParsedMcpConfig).mcp_servers.renamed;
			assert.deepStrictEqual({ ...edited.tools.read }, {
				...original.mcp_servers.example.tools.read,
				enabled: false, approval_mode: 'prompt', output_token_limit: 0,
			});
			assert.deepStrictEqual({ ...edited.tools.write }, { future_only: true });

			model.tools = [{ name: 'read' }];
			model.enabled = false;
			assert.strictEqual(saveMcpServer(configPath, model, 'renamed').ok, true);
			const cleared = (toml.parse(fs.readFileSync(configPath, 'utf8')) as ParsedMcpConfig).mcp_servers.renamed;
			assert.strictEqual(cleared.enabled, false);
			assert.strictEqual(cleared.tools.read.output_token_limit, undefined);
			assert.strictEqual(cleared.tools.read.approval_mode, undefined);
			assert.strictEqual(cleared.tools.read.enabled, undefined);
			assert.deepStrictEqual(cleared.tools.read.future_option, original.mcp_servers.example.tools.read.future_option);
			assert.strictEqual(cleared.tools.write, undefined);
			assert.strictEqual(deleteMcpServer(configPath, 'renamed'), true);
			assert.deepStrictEqual(listMcpFormModels(configPath), []);
		});
	});

	test('output limits require a tool name and a non-negative safe integer', () => {
		const model = {
			id: 'example', transport: 'stdio' as const, command: 'example-mcp',
			args: [], url: '', env: [], enabledTools: [], disabledTools: [], enabled: true,
		};
		for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			assert.ok(validateMcpModel({ ...model, tools: [{ name: 'read', outputTokenLimit: limit }] }, []).errors.includes('toolOutputTokenLimitInvalid'));
		}
		assert.ok(validateMcpModel({ ...model, tools: [{ name: '', outputTokenLimit: 0 }] }, []).errors.includes('toolNameRequired'));
		assert.strictEqual(validateMcpModel({ ...model, tools: [{ name: 'read', outputTokenLimit: 0, approvalMode: 'writes' }] }, []).ok, true);
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

	test('saveMcpServer writes http_headers, env_http_headers and tools entries from the form model', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');

			const result = saveMcpServer(configPath, {
				id: 'context7',
				transport: 'http',
				command: '',
				args: [],
				url: 'https://example.test/mcp',
				env: [],
				httpHeaders: [{ key: 'Authorization', value: 'Bearer token' }],
				envHttpHeaders: [{ key: 'X_API_KEY', value: 'CONTEXT7_API_KEY' }],
				tools: [{ name: 'resolve-library-id', enabled: true, approvalMode: 'prompt' }],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			});

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('[mcp_servers.context7.http_headers]'));
			assert.ok(contents.includes("Authorization = 'Bearer token'"));
			assert.ok(contents.includes('[mcp_servers.context7.env_http_headers]'));
			assert.ok(contents.includes("X_API_KEY = 'CONTEXT7_API_KEY'"));
			assert.ok(contents.includes('[mcp_servers.context7.tools.resolve-library-id]'));
			assert.ok(contents.includes('enabled = true'));
			assert.ok(contents.includes('approval_mode = "prompt"'));
		});
	});

	test('saveMcpServer keeps other companion blocks attached on rename', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				[
					'[mcp_servers.context7]',
					'command = "npx"',
					'',
					'[mcp_servers.context7.env_http_headers]',
					'AUTHORIZATION = "Bearer token"',
				].join('\n'),
				'utf8',
			);

			const result = saveMcpServer(
				configPath,
				{
					id: 'context7-renamed',
					transport: 'stdio',
					command: 'npx',
					args: [],
					url: '',
					env: [],
					enabledTools: [],
					disabledTools: [],
					enabled: true,
				},
				'context7',
			);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.strictEqual(result.ok, true);
			assert.ok(contents.includes('[mcp_servers.context7-renamed]'));
			assert.ok(contents.includes('[mcp_servers.context7-renamed.env_http_headers]'));
			assert.ok(contents.includes("AUTHORIZATION = 'Bearer token'"));
			assert.ok(!contents.includes('[mcp_servers.context7.env_http_headers]'));
		});
	});
});
