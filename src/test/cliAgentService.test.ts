import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentLocation, getCliAgentLocations } from '../services/agentLocations';
import { listCliAgentRecords, setCliAgentEnabled } from '../services/cliAgentService';
import { disableAgentByName } from '../services/agentManagerService';

const definition = 'name = "reviewer"\ndescription = "Review code"\ndeveloper_instructions = "Check tests."\n';

function withFixture(run: (root: string, config: string, locations: AgentLocation[]) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-agent-service-'));
	const config = path.join(root, 'home', 'config.toml');
	const projectAgents = path.join(root, 'project', '.codex', 'agents');
	fs.mkdirSync(path.join(root, 'home', 'agents'), { recursive: true });
	fs.mkdirSync(projectAgents, { recursive: true });
	fs.writeFileSync(config, '# Keep config\ncustom_setting = true\n');
	const locations: AgentLocation[] = [
		{ kind: 'workspace', label: 'Home', rootPath: path.join(root, 'home', 'agents'), priority: 2 },
		{ kind: 'project', label: 'Project', rootPath: projectAgents, priority: 1 },
	];
	try { run(root, config, locations); }
	finally { fs.rmSync(root, { recursive: true, force: true }); }
}

suite('CLI Agent service (0.163.0 contract)', () => {
	test('discovers recursive standalone files with body names and independent scope identities', () => {
		withFixture((root, config, locations) => {
			const nested = path.join(root, 'home', 'agents', 'nested');
			fs.mkdirSync(nested);
			fs.writeFileSync(path.join(nested, 'different-filename.toml'), definition);
			fs.writeFileSync(path.join(locations[1].rootPath, 'project.toml'), definition);
			const records = listCliAgentRecords(config, locations);
			assert.strictEqual(records.length, 2);
			assert.strictEqual(new Set(records.map((item) => item.id)).size, 2);
			assert.ok(records.every((item) => item.name === 'reviewer' && item.definitionFormat === 'standalone' && item.enabled));
			assert.ok(records.every((item) => !item.roleKey && item.configPath.endsWith('config.toml')));
			assert.deepStrictEqual(setCliAgentEnabled(config, records[0].id, false, locations).supported, false);
			assert.ok(records.every((item) => fs.existsSync(item.agentPath)));
		});
	});

	test('uses canonical project roots while preserving legacy Explorer locations', () => {
		withFixture((_root, config, locations) => {
			const legacy = { ...locations[1], rootPath: path.join(path.dirname(path.dirname(locations[1].rootPath)), '.agents', 'agents'), createPath: locations[1].rootPath };
			assert.strictEqual(getCliAgentLocations(config, [legacy])[1].rootPath, locations[1].rootPath);
			assert.ok(legacy.rootPath.includes('.agents'));
		});
	});

	test('round trip preserves bytes, config and identity without a declaration or store', () => {
		withFixture((_root, config, locations) => {
			const file = path.join(locations[0].rootPath, 'different.toml');
			const bytes = Buffer.from(`# Preserve comment\r\n${definition.replace(/\n/g, '\r\n')}`);
			fs.writeFileSync(file, bytes);
			const before = fs.readFileSync(config);
			const record = listCliAgentRecords(config, locations)[0];
			assert.deepStrictEqual(setCliAgentEnabled(config, record.id, false, locations), { supported: true, changed: true });
			const disabled = listCliAgentRecords(config, locations)[0];
			assert.strictEqual(disabled.id, record.id);
			assert.strictEqual(disabled.availability, 'disabled');
			assert.strictEqual(disabled.agentPath, `${file}.disabled`);
			assert.deepStrictEqual(fs.readFileSync(disabled.agentPath), bytes);
			assert.deepStrictEqual(setCliAgentEnabled(config, disabled.id, false, locations), { supported: true, changed: false });
			assert.deepStrictEqual(setCliAgentEnabled(config, disabled.id, true, locations), { supported: true, changed: true });
			assert.deepStrictEqual(fs.readFileSync(file), bytes);
			assert.deepStrictEqual(fs.readFileSync(config), before);
			assert.ok(!fs.existsSync(path.join(path.dirname(config), '.codex-workspace')));
		});
	});

	test('missing, blank, mistyped, malformed and unvalidated settings are never available', () => {
		withFixture((_root, config, locations) => {
			const file = path.join(locations[0].rootPath, 'invalid.toml');
			const invalid = [
				...['name', 'description', 'developer_instructions'].flatMap((key) => [
					definition.split('\n').filter((line) => !line.startsWith(`${key} =`)).join('\n'),
					definition.replace(new RegExp(`${key} = "[^"]*"`), `${key} = "  "`),
					definition.replace(new RegExp(`${key} = "[^"]*"`), `${key} = 1`),
				]),
				'[broken', `${definition}enabled = false\n`, `${definition}unknown_future_setting = true\n`,
				`${definition}model = 1\n`, `${definition}sandbox_mode = "bad"\n`,
			];
			for (const contents of invalid) {
				fs.writeFileSync(file, contents);
				const record = listCliAgentRecords(config, locations)[0];
				assert.strictEqual(record.enabled, false);
				assert.ok(record.reason);
				assert.strictEqual(setCliAgentEnabled(config, record.id, true, locations).supported, false);
				assert.strictEqual(fs.readFileSync(file, 'utf8'), contents);
			}
		});
	});

	test('declaration uses body metadata but retains role key; unsafe OFF is rejected', () => {
		withFixture((_root, config, locations) => {
			const file = path.join(locations[0].rootPath, 'different.toml');
			fs.writeFileSync(file, definition);
			fs.appendFileSync(config, '[agents.legacy_key]\ndescription = "Legacy"\nconfig_file = "agents/different.toml"\n');
			const before = fs.readFileSync(config);
			const records = listCliAgentRecords(config, locations);
			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].roleKey, 'legacy_key');
			assert.strictEqual(records[0].name, 'reviewer');
			assert.strictEqual(records[0].description, 'Review code');
			const result = setCliAgentEnabled(config, records[0].id, false, locations);
			assert.ok(!result.supported && result.reason.includes('rediscover'));
			assert.throws(() => disableAgentByName(path.dirname(config), config, 'legacy_key'), /rediscover/);
			assert.deepStrictEqual(fs.readFileSync(config), before);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), definition);
		});
	});

	test('legacy Base and Profile disabled stores round trip with unknown fields intact', () => {
		withFixture((root, config, locations) => {
			const file = path.join(root, 'reference.toml');
			fs.writeFileSync(file, 'developer_instructions = "Legacy instructions"\n');
			const profiles = [config, path.join(path.dirname(config), 'dev.config.toml')];
			for (const source of profiles) {
				fs.writeFileSync(source, `custom_metadata = "Keep"\n[agents.old_role]\ndescription = "Legacy"\nconfig_file = ${JSON.stringify(file.replace(/\\/g, '/'))}\n`);
			}
			for (const source of profiles) {
				const record = listCliAgentRecords(config, locations).find((item) => item.configPath === source)!;
				assert.deepStrictEqual(setCliAgentEnabled(config, record.id, false, locations), { supported: false, reason: 'Another definition exposes the same CLI name; layer precedence is not resolved.' });
			}
			// Existing source-scoped stores remain readable; no automatic migration occurs.
			for (const source of profiles) { disableAgentByName(root, source, 'old_role'); }
			const records = listCliAgentRecords(config, locations);
			assert.strictEqual(records.length, 2);
			assert.ok(records.every((item) => item.availability === 'disabled'));
			assert.ok(fs.existsSync(path.join(path.dirname(config), '.codex-workspace', 'agents-disabled.json')));
			assert.ok(fs.existsSync(path.join(path.dirname(config), '.codex-workspace', 'dev.config.toml.agents-disabled.json')));
			assert.deepStrictEqual(setCliAgentEnabled(config, records[0].id, true, locations), { supported: true, changed: true });
			assert.ok(fs.readFileSync(records[0].configPath, 'utf8').includes('custom_metadata = "Keep"'));
			assert.strictEqual(fs.readFileSync(file, 'utf8'), 'developer_instructions = "Legacy instructions"\n');
		});
	});

	test('destination collisions, unknown CLI versions and stale identities do not mutate files', () => {
		withFixture((_root, config, locations) => {
			const file = path.join(locations[0].rootPath, 'different.toml');
			fs.writeFileSync(file, definition);
			const record = listCliAgentRecords(config, locations)[0];
			fs.writeFileSync(`${file}.disabled`, 'Existing user data');
			assert.strictEqual(setCliAgentEnabled(config, record.id, false, locations).supported, false);
			assert.strictEqual(setCliAgentEnabled(config, record.id, false, locations, '0.164.0').supported, false);
			assert.strictEqual(setCliAgentEnabled(config, 'stale', false, locations).supported, false);
			assert.strictEqual(fs.readFileSync(`${file}.disabled`, 'utf8'), 'Existing user data');
			assert.strictEqual(fs.readFileSync(file, 'utf8'), definition);
		});
	});

	test('malformed referenced files do not prevent other definitions from being listed', () => {
		withFixture((_root, config, locations) => {
			fs.writeFileSync(path.join(locations[0].rootPath, 'broken.toml'), '[invalid');
			fs.writeFileSync(path.join(locations[0].rootPath, 'valid.toml'), definition);
			fs.appendFileSync(config, '[agents.broken]\ndescription = "Broken"\nconfig_file = "agents/broken.toml"\n');
			const records = listCliAgentRecords(config, locations);
			assert.strictEqual(records.length, 2);
			assert.strictEqual(records.find((item) => item.roleKey === 'broken')?.availability, 'invalid');
			assert.strictEqual(records.find((item) => item.name === 'reviewer')?.enabled, true);
		});
	});

	test('a declaration in another scope prevents renaming its referenced standalone file', () => {
		withFixture((_root, config, locations) => {
			const file = path.join(locations[0].rootPath, 'shared.toml');
			fs.writeFileSync(file, definition);
			const profile = path.join(path.dirname(config), 'dev.config.toml');
			fs.writeFileSync(profile, `[agents.other_key]\ndescription = "Profile"\nconfig_file = ${JSON.stringify(file.replace(/\\/g, '/'))}\n`);
			const standalone = listCliAgentRecords(config, locations).find((item) => item.definitionFormat === 'standalone')!;
			assert.strictEqual(setCliAgentEnabled(config, standalone.id, false, locations).supported, false);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), definition);
		});
	});

	test('unvalidated declaration fields are preserved and cannot be reported as a successful toggle', () => {
		withFixture((_root, config, locations) => {
			fs.appendFileSync(config, '[agents.unverified]\ndescription = "Keep"\nfuture_setting = true\n');
			const before = fs.readFileSync(config);
			const record = listCliAgentRecords(config, locations)[0];
			assert.strictEqual(record.availability, 'unverified');
			assert.strictEqual(setCliAgentEnabled(config, record.id, true, locations).supported, false);
			assert.deepStrictEqual(fs.readFileSync(config), before);
		});
	});
});
