import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	deleteAgentFile, disableAgentByName, editAgentFile, enableAgentByName, getAgentManagerStorePath,
	listAgentManagerRecords, pruneMissingAgentBackups, refreshAgentManagerRecords,
} from '../services/agentManagerService';
import { getDisabledAgentBlock, saveDisabledAgentBlock } from '../services/disabledAgentsStore';
import { AgentLocation } from '../services/agentLocations';

function withInventory(run: (fixture: { root: string; sources: string[]; locations: AgentLocation[]; target: string }) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-inventory-'));
	try {
		const baseDir = path.join(root, 'home');
		const projectDir = path.join(root, 'project', '.codex');
		const locations: AgentLocation[] = [
			{ kind: 'project', label: 'Project Agents', rootPath: path.join(projectDir, 'agents'), priority: 1 },
			{ kind: 'workspace', label: 'Workspace Agents', rootPath: path.join(baseDir, 'agents'), priority: 2 },
		];
		for (const location of locations) { fs.mkdirSync(location.rootPath, { recursive: true }); }
		const sources = [path.join(baseDir, 'config.toml'), path.join(baseDir, 'review.config.toml'), path.join(projectDir, 'config.toml')];
		for (const source of sources) { fs.writeFileSync(source, ''); }
		const target = path.join(baseDir, 'agents', 'actual.toml');
		fs.writeFileSync(target, 'model = "test"\n');
		run({ root, sources, locations, target });
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function declaration(source: string, file: string, role = 'alias'): string {
	return `[agents.${role}]\nconfig_file = ${JSON.stringify(path.relative(path.dirname(source), file).replace(/\\/g, '/'))}\n`;
}

suite('Agent inventory consistency', () => {
	test('refresh removes missing-file backups from Base/Profile/Project but preserves valid disabled declarations', () => {
		withInventory(({ sources, locations, target }) => {
			for (const source of sources) {
				const store = getAgentManagerStorePath(source);
				saveDisabledAgentBlock(store, 'valid', declaration(source, target, 'valid'));
				saveDisabledAgentBlock(store, 'gone', declaration(source, target + '.gone', 'gone'));
				saveDisabledAgentBlock(store, 'synced', declaration(source, target + '.gone', 'synced'), undefined, 'sync-reconcile');
			}
			const records = refreshAgentManagerRecords(sources[0], locations);
			assert.strictEqual(records.length, 3);
			assert.ok(records.every((record) => record.name === 'valid' && !record.enabled));
			for (const source of sources) {
				const store = getAgentManagerStorePath(source);
				assert.strictEqual(getDisabledAgentBlock(store, 'valid'), declaration(source, target, 'valid'));
				assert.strictEqual(getDisabledAgentBlock(store, 'gone'), undefined);
				assert.strictEqual(getDisabledAgentBlock(store, 'synced'), undefined);
			}
			fs.rmSync(target);
			assert.deepStrictEqual(refreshAgentManagerRecords(sources[0], locations), []);
			for (const source of sources) { assert.strictEqual(fs.existsSync(getAgentManagerStorePath(source)), false); }
		});
	});

	test('removes empty and orphaned Profile backup files without deleting active config entries', () => {
		withInventory(({ sources, locations, target }) => {
			const store = getAgentManagerStorePath(sources[1]);
			saveDisabledAgentBlock(store, 'alias', declaration(sources[1], target));
			fs.rmSync(sources[1]);
			const active = declaration(sources[0], target + '.missing');
			fs.writeFileSync(sources[0], active);
			pruneMissingAgentBackups(sources[0], locations);
			assert.strictEqual(fs.existsSync(store), false);
			assert.strictEqual(fs.readFileSync(sources[0], 'utf8'), active);
			const emptyStore = getAgentManagerStorePath(sources[0]);
			fs.writeFileSync(emptyStore, '{"version":1,"disabledAgents":{}}');
			pruneMissingAgentBackups(sources[0], locations);
			assert.strictEqual(fs.existsSync(emptyStore), false);
		});
	});

	test('deletion removes aliases, child tables and disabled references by path while keeping a same-name role for another file', () => {
		withInventory(({ sources, locations, target }) => {
			const other = path.join(locations[0].rootPath, 'actual.toml');
			fs.writeFileSync(other, '');
			fs.writeFileSync(sources[0], declaration(sources[0], target) + '[agents.alias.options]\nkeep = true\n' + declaration(sources[0], target, 'second'));
			fs.writeFileSync(sources[2], declaration(sources[2], other));
			const unrelated = fs.readFileSync(sources[2], 'utf8');
			for (const source of sources) { saveDisabledAgentBlock(getAgentManagerStorePath(source), 'stash', declaration(source, target, 'stash')); }
			deleteAgentFile(target, sources[0], locations);
			assert.strictEqual(fs.existsSync(target), false);
			assert.strictEqual(fs.existsSync(other), true);
			assert.ok(!fs.readFileSync(sources[0], 'utf8').includes('agents.alias'));
			assert.ok(!fs.readFileSync(sources[0], 'utf8').includes('agents.second'));
			assert.strictEqual(fs.readFileSync(sources[2], 'utf8'), unrelated);
			for (const source of sources) { assert.strictEqual(fs.existsSync(getAgentManagerStorePath(source)), false); }
			assert.deepStrictEqual(listAgentManagerRecords(sources[0], locations).map((record) => record.agentPath), [other]);
		});
	});

	test('failed configuration save leaves the actual file and restores earlier config/backup writes', () => {
		withInventory(({ sources, locations, target }) => {
			for (const source of sources) { fs.writeFileSync(source, declaration(source, target)); }
			const store = getAgentManagerStorePath(sources[0]);
			saveDisabledAgentBlock(store, 'stash', declaration(sources[0], target, 'stash'));
			const before = sources.map((source) => fs.readFileSync(source, 'utf8'));
			const backup = fs.readFileSync(store, 'utf8');
			const originalWrite = fs.writeFileSync;
			let failed = false;
			fs.writeFileSync = ((file, ...args) => {
				if (String(file) === sources[1] && !failed) { failed = true; throw new Error('test save failure'); }
				return originalWrite(file, ...args);
			}) as typeof originalWrite;
			try { assert.throws(() => deleteAgentFile(target, sources[0], locations), /test save failure/); }
			finally { fs.writeFileSync = originalWrite; }
			assert.strictEqual(fs.existsSync(target), true);
			assert.deepStrictEqual(sources.map((source) => fs.readFileSync(source, 'utf8')), before);
			assert.strictEqual(fs.readFileSync(store, 'utf8'), backup);
		});
	});

	test('an unregistered file can be enabled, disabled and restored with its actual path', () => {
		withInventory(({ sources, locations, target }) => {
			const fileContents = "model = 'test'\ndescription = 'Review implementation'\n";
			fs.writeFileSync(target, fileContents);
			const record = listAgentManagerRecords(sources[0], locations)[0];
			assert.strictEqual(record.agentPath, target);
			assert.strictEqual(record.enabled, false);
			assert.strictEqual(record.description, 'Review implementation');
			enableAgentByName('', record.configPath, record.name, record.configFile);
			assert.strictEqual(listAgentManagerRecords(sources[0], locations)[0].enabled, true);
			assert.strictEqual(listAgentManagerRecords(sources[0], locations)[0].description, 'Review implementation');
			disableAgentByName('', record.configPath, record.name);
			assert.strictEqual(refreshAgentManagerRecords(sources[0], locations)[0].enabled, false);
			enableAgentByName('', record.configPath, record.name, record.configFile);
			assert.strictEqual(fs.existsSync(getAgentManagerStorePath(record.configPath)), false);
			assert.strictEqual(fs.readFileSync(target, 'utf8'), fileContents);
		});
	});

	test('fills a blank restored description from the file while preserving nonempty declaration descriptions', () => {
		withInventory(({ sources, locations, target }) => {
			fs.writeFileSync(target, 'description = "File description"\n');
			for (const description of ['', 'Declaration override']) {
				fs.writeFileSync(sources[0], declaration(sources[0], target) + `description = ${JSON.stringify(description)}\n`);
				disableAgentByName('', sources[0], 'alias');
				enableAgentByName('', sources[0], 'alias', 'agents/actual.toml');
				assert.strictEqual(listAgentManagerRecords(sources[0], locations)[0].description, description || 'File description');
			}
		});
	});

	test('does not overwrite a same-name declaration for a different file', () => {
		withInventory(({ sources, locations, target }) => {
			const other = path.join(path.dirname(target), '..', 'external.toml');
			fs.writeFileSync(other, '');
			const config = declaration(sources[0], other, 'actual');
			fs.writeFileSync(sources[0], config);
			const records = listAgentManagerRecords(sources[0], locations);
			assert.strictEqual(new Set(records.map((record) => record.id)).size, records.length);
			const local = records.find((record) => record.agentPath === target)!;
			assert.throws(() => enableAgentByName('', local.configPath, local.name, local.configFile), /another file/);
			assert.strictEqual(fs.readFileSync(sources[0], 'utf8'), config);
		});
	});

	test('editing a shared file updates active and disabled paths without enabling the disabled role', () => {
		withInventory(({ sources, locations, target }) => {
			fs.writeFileSync(sources[0], declaration(sources[0], target, 'actual') + '[agents.actual.options] # keep [comment]\nvalue = 3\n');
			fs.writeFileSync(sources[2], declaration(sources[2], target, 'custom_alias'));
			const storePath = getAgentManagerStorePath(sources[1]);
			saveDisabledAgentBlock(storePath, 'review', declaration(sources[1], target, 'review'));
			const next = path.join(path.dirname(target), 'renamed.toml');
			editAgentFile(target, next, { configPath: sources[0], name: 'actual' }, 'Updated', sources[0], locations);
			assert.strictEqual(fs.existsSync(target), false);
			assert.strictEqual(fs.readFileSync(next, 'utf8'), 'model = "test"\n');
			const records = listAgentManagerRecords(sources[0], locations);
			assert.deepStrictEqual(records.map((record) => [record.name, record.enabled]), [['renamed', true], ['review', false], ['custom_alias', true]]);
			assert.ok(records.every((record) => record.agentPath === next));
			assert.ok(fs.readFileSync(sources[0], 'utf8').includes('# keep [comment]'));
			assert.strictEqual(records[0].description, 'Updated');
			assert.ok(getDisabledAgentBlock(storePath, 'review')?.includes('renamed.toml'));
		});
	});
});
