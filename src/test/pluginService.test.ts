import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	canWritePluginConfig,
	listPluginRecords,
	setPluginEnabled,
} from '../services/pluginService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-service-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function writeJson(targetPath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), 'utf8');
}

suite('Plugin service', () => {
	test('lists plugin manifest metadata and contained features', () => {
		withTempDir((root) => {
			const pluginRoot = path.join(root, '.codex', 'plugins', 'cache', 'openai-curated', 'demo', '1.0.0');
			const configPath = path.join(root, '.codex', 'config.toml');
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, 'model = "gpt"\n', 'utf8');
			writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
				name: 'demo',
				version: '1.0.0',
				description: 'Demo plugin',
				author: { name: 'OpenAI' },
				keywords: ['demo'],
				skills: ['./skills/reviewer/SKILL.md'],
				mcpServers: ['./mcp.json'],
				apps: ['./app.json'],
				interface: {
					displayName: 'Demo Plugin',
					shortDescription: 'Short demo',
					developerName: 'Plugin Team',
					capabilities: ['skills', 'mcp'],
					brandColor: '#336699',
				},
			});
			fs.mkdirSync(path.join(pluginRoot, 'skills', 'reviewer'), { recursive: true });
			fs.writeFileSync(
				path.join(pluginRoot, 'skills', 'reviewer', 'SKILL.md'),
				'---\nname: reviewer\ndescription: Reviews code\n---\n',
				'utf8',
			);
			writeJson(path.join(pluginRoot, 'mcp.json'), {
				mcp_servers: {
					demo: {
						type: 'stdio',
						command: 'node',
						env: {
							API_TOKEN: 'secret-value',
						},
						enabled_tools: ['search'],
					},
				},
			});
			writeJson(path.join(pluginRoot, 'app.json'), {
				name: 'demo-app',
				description: 'Demo app',
			});
			fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
			fs.writeFileSync(
				path.join(pluginRoot, 'agents', 'reviewer.toml'),
				[
					'name = "plugin-reviewer"',
					'description = "Plugin reviewer"',
					'model = "gpt-5.4"',
					'model_reasoning_effort = "high"',
					'sandbox_mode = "read-only"',
					'',
					'[mcp_servers.demo]',
				].join('\n'),
				'utf8',
			);

			const plugins = listPluginRecords({ homeDir: root, configPath });

			assert.strictEqual(plugins.length, 1);
			assert.strictEqual(plugins[0].id, 'demo@openai-curated');
			assert.strictEqual(plugins[0].displayName, 'Demo Plugin');
			assert.strictEqual(plugins[0].status, 'enabled');
			assert.strictEqual(plugins[0].skills[0].name, 'reviewer');
			assert.strictEqual(plugins[0].mcpServers[0].name, 'demo');
			assert.deepStrictEqual(plugins[0].mcpServers[0].envKeys, ['API_TOKEN']);
			assert.ok(!JSON.stringify(plugins[0]).includes('secret-value'));
			assert.strictEqual(plugins[0].apps[0].name, 'demo-app');
			assert.strictEqual(plugins[0].agents[0].name, 'plugin-reviewer');
		});
	});

	test('keeps malformed manifests as needs-review without stopping other plugins', () => {
		withTempDir((root) => {
			const goodRoot = path.join(root, '.codex', 'plugins', 'cache', 'market', 'good', '1.0.0');
			const badRoot = path.join(root, '.codex', 'plugins', 'cache', 'market', 'bad', '1.0.0');
			const configPath = path.join(root, '.codex', 'config.toml');
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, 'model = "gpt"\n', 'utf8');
			writeJson(path.join(goodRoot, '.codex-plugin', 'plugin.json'), {
				name: 'good',
				version: '1.0.0',
				description: 'Good plugin',
			});
			fs.mkdirSync(path.join(badRoot, '.codex-plugin'), { recursive: true });
			fs.writeFileSync(path.join(badRoot, '.codex-plugin', 'plugin.json'), '{', 'utf8');

			const plugins = listPluginRecords({ homeDir: root, configPath });

			assert.strictEqual(plugins.length, 2);
			assert.strictEqual(plugins.find((plugin) => plugin.name === 'bad')?.status, 'needs-review');
			assert.strictEqual(plugins.find((plugin) => plugin.name === 'good')?.status, 'enabled');
		});
	});

	test('updates plugin enabled state in config.toml', () => {
		withTempDir((root) => {
			const configPath = path.join(root, '.codex', 'config.toml');
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, 'model = "gpt"\n', 'utf8');

			setPluginEnabled(configPath, 'demo@market', false);
			assert.ok(fs.readFileSync(configPath, 'utf8').includes('[plugins."demo@market"]'));
			assert.ok(fs.readFileSync(configPath, 'utf8').includes('enabled = false'));

			setPluginEnabled(configPath, 'demo@market', true);
			assert.ok(fs.readFileSync(configPath, 'utf8').includes('enabled = true'));
		});
	});

	test('disables writes when config.toml is invalid', () => {
		withTempDir((root) => {
			const configPath = path.join(root, '.codex', 'config.toml');
			fs.mkdirSync(path.dirname(configPath), { recursive: true });
			fs.writeFileSync(configPath, '[broken\n', 'utf8');

			assert.strictEqual(canWritePluginConfig(configPath), false);
			assert.throws(() => setPluginEnabled(configPath, 'demo@market', false));
		});
	});
});
