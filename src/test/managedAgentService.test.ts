import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import * as toml from 'toml';
import { AgentLocation } from '../services/agentLocations';
import { getAgentManagerStorePath } from '../services/agentManagerService';
import { saveDisabledAgentBlock } from '../services/disabledAgentsStore';
import { deleteManagedAgent, editManagedAgent, getManagedAgentOpenPath, listManagedAgentRecords, registerManagedAgent, resolveManagedAgent, setManagedAgentEnabled } from '../services/managedAgentService';
import { AgentExplorerProvider } from '../views/agentExplorerProvider';
import { CodexTreeItem } from '../models/treeItems';

const standalone = "# Keep bytes\r\nname = 'body-name'\r\ndescription = 'Review code' # Keep comment\r\ndeveloper_instructions = 'Check changes.'\r\n";

function withFixture(run: (config: string, profile: string, locations: AgentLocation[]) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-agents-'));
	const home = path.join(root, 'home');
	const project = path.join(root, 'project', '.codex', 'agents');
	fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
	fs.mkdirSync(project, { recursive: true });
	const config = path.join(home, 'config.toml');
	const profile = path.join(home, 'review.config.toml');
	fs.writeFileSync(config, '# Base\nmodel = "keep"\n');
	fs.writeFileSync(profile, '# Profile\n');
	const locations: AgentLocation[] = [
		{ kind: 'workspace', label: 'Home', rootPath: path.join(home, 'agents'), priority: 2 },
		{ kind: 'project', label: 'Project', rootPath: project, priority: 1 },
	];
	try { run(config, profile, locations); }
	finally { fs.rmSync(root, { recursive: true, force: true }); }
}

suite('Managed Agent inventory and operations', () => {
	test('external standalone refresh, Open, OFF and ON agree with Explorer without registering or changing bytes', () => {
		withFixture((config, profile, locations) => {
			const read = () => listManagedAgentRecords(config, locations);
			const provider = new AgentExplorerProvider({} as vscode.ExtensionContext, () => ({ isAvailable: true }), read, () => locations);
			assert.strictEqual(read().length, 0);
			const nested = path.join(locations[0].rootPath, 'nested');
			fs.mkdirSync(nested);
			const file = path.join(nested, 'filename.toml');
			const before = [config, profile].map((source) => fs.readFileSync(source));
			fs.writeFileSync(file, standalone);
			const first = read()[0];
			assert.strictEqual(first.name, 'body-name');
			assert.strictEqual(first.availability, 'available');
			assert.strictEqual(first.definitionFormat, 'standalone');
			assert.strictEqual(getManagedAgentOpenPath(first), file);
			const items = provider.getChildren() as CodexTreeItem[];
			assert.strictEqual(items[0].id, first.id);
			assert.strictEqual(items[0].agentRecord?.enabled, true);
			assert.strictEqual(setManagedAgentEnabled(config, first.id, false, locations), true);
			assert.strictEqual(read()[0].availability, 'disabled');
			assert.strictEqual(resolveManagedAgent(config, { id: first.id }, locations).agentPath, file + '.disabled');
			assert.strictEqual(setManagedAgentEnabled(config, first.id, true, locations), true);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), standalone);
			assert.deepStrictEqual([config, profile].map((source) => fs.readFileSync(source)), before);
			assert.strictEqual(fs.existsSync(getAgentManagerStorePath(config)), false);
			fs.writeFileSync(file, standalone.replace('body-name', 'externally-edited'));
			assert.strictEqual(read()[0].name, 'externally-edited');
			fs.rmSync(file);
			assert.strictEqual(read().length, 0);
		});
	});

	test('legacy candidate registration uses the chosen Profile and keeps nonempty metadata and actual path', () => {
		withFixture((config, profile, locations) => {
			const file = path.join(locations[1].rootPath, 'legacy.toml');
			const contents = 'model = "legacy"\ndescription = "External description"\n';
			fs.writeFileSync(file, contents);
			const candidate = listManagedAgentRecords(config, locations)[0];
			assert.strictEqual(candidate.availability, 'candidate');
			assert.throws(() => setManagedAgentEnabled(config, candidate.id, true, locations), /register/);
			const before = fs.readFileSync(config, 'utf8');
			registerManagedAgent(config, candidate.id, profile, candidate.description, locations);
			const registered = listManagedAgentRecords(config, locations).find((record) => record.configPath === profile)!;
			assert.strictEqual(registered.definitionFormat, 'declaration');
			assert.strictEqual(registered.enabled, true);
			assert.strictEqual(registered.description, 'External description');
			assert.strictEqual(getManagedAgentOpenPath(registered), file);
			assert.strictEqual(setManagedAgentEnabled(config, registered.id, false, locations), true);
			assert.strictEqual(listManagedAgentRecords(config, locations).filter((record) => record.agentPath === file).length, 1);
			assert.strictEqual(setManagedAgentEnabled(config, registered.id, true, locations), true);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), contents);
			assert.strictEqual(fs.readFileSync(config, 'utf8'), before);
		});
	});

	test('registration cannot overwrite an active or disabled same-name role, and standalone needs no registration', () => {
		withFixture((config, profile, locations) => {
			const file = path.join(locations[0].rootPath, 'candidate.toml');
			fs.writeFileSync(file, 'model = "candidate"\n');
			const candidate = listManagedAgentRecords(config, locations)[0];
			fs.writeFileSync(profile, '[agents.candidate]\ndescription = "keep"\n');
			const before = fs.readFileSync(profile, 'utf8');
			assert.throws(() => registerManagedAgent(config, candidate.id, profile, 'Candidate', locations), /already exists/);
			assert.strictEqual(fs.readFileSync(profile, 'utf8'), before);
			fs.writeFileSync(profile, '');
			saveDisabledAgentBlock(getAgentManagerStorePath(profile), 'candidate', '[agents.candidate]\ndescription = "Backup"\n');
			assert.throws(() => registerManagedAgent(config, candidate.id, profile, 'Candidate', locations), /already exists/);
			fs.writeFileSync(file, standalone);
			assert.throws(() => registerManagedAgent(config, listManagedAgentRecords(config, locations).find((record) => record.agentPath === file)!.id, profile, 'X', locations), /Only declaration candidates/);
		});
	});

	test('malformed files, missing references and broken config sources do not hide normal rows or mutate stores on refresh', () => {
		withFixture((config, profile, locations) => {
			fs.writeFileSync(path.join(locations[0].rootPath, 'valid.toml'), standalone);
			fs.writeFileSync(path.join(locations[0].rootPath, 'bad.toml'), 'name = [');
			fs.writeFileSync(profile, '[agents.');
			fs.appendFileSync(config, '[agents.missing]\ndescription = "Missing"\nconfig_file = "gone.toml"\n');
			const store = getAgentManagerStorePath(config);
			saveDisabledAgentBlock(store, 'stale', '[agents.stale]\ndescription = "Stale"\nconfig_file = "gone-too.toml"\n');
			const paths = [config, profile, store];
			const before = paths.map((file) => fs.readFileSync(file));
			for (let index = 0; index < 2; index++) {
				const records = listManagedAgentRecords(config, locations);
				assert.strictEqual(records.find((record) => record.name === 'body-name')?.availability, 'available');
				assert.strictEqual(records.find((record) => record.roleKey === 'missing')?.availability, 'missing');
				assert.strictEqual(records.find((record) => record.name === 'bad')?.availability, 'invalid');
				assert.strictEqual(records.find((record) => record.agentPath === profile)?.availability, 'invalid');
				assert.ok(records.filter((record) => !record.enabled).every((record) => record.reason));
				assert.strictEqual(getManagedAgentOpenPath(records.find((record) => record.roleKey === 'missing')!), config);
				assert.deepStrictEqual(paths.map((file) => fs.readFileSync(file)), before);
			}
		});
	});

	test('same-name definitions in different scopes preserve all sources when CLI cannot guarantee a toggle', () => {
		withFixture((config, _profile, locations) => {
			for (const location of locations) { fs.writeFileSync(path.join(location.rootPath, 'same.toml'), standalone); }
			const records = listManagedAgentRecords(config, locations);
			assert.notStrictEqual(records[0].id, records[1].id);
			const before = records.map((record) => fs.readFileSync(record.agentPath));
			assert.throws(() => setManagedAgentEnabled(config, records[1].id, false, locations), /same CLI name/);
			assert.deepStrictEqual(records.map((record) => fs.readFileSync(record.agentPath)), before);
			deleteManagedAgent(config, records[1].id, locations);
			assert.strictEqual(fs.existsSync(records[0].agentPath), true);
			assert.strictEqual(fs.existsSync(records[1].agentPath), false);
		});
	});

	test('referenced body names and descriptions remain distinct from role keys and filenames during edits', () => {
		withFixture((config, profile, locations) => {
			const file = path.join(path.dirname(config), 'physical.toml');
			fs.writeFileSync(file, standalone);
			fs.writeFileSync(profile, '[agents.role_alias]\ndescription = "Declaration"\nconfig_file = "physical.toml"\n');
			const before = fs.readFileSync(config);
			const record = listManagedAgentRecords(config, locations)[0];
			assert.strictEqual(record.roleKey, 'role_alias');
			assert.strictEqual(record.name, 'body-name');
			const next = path.join(path.dirname(file), 'renamed.toml');
			editManagedAgent(config, record.id, next, 'Updated body', locations);
			const edited = listManagedAgentRecords(config, locations)[0];
			assert.strictEqual(edited.name, 'body-name');
			assert.strictEqual(edited.roleKey, 'role_alias');
			assert.strictEqual(edited.description, 'Updated body');
			assert.ok(fs.readFileSync(next, 'utf8').includes("developer_instructions = 'Check changes.'\r\n"));
			assert.deepStrictEqual(fs.readFileSync(config), before);
		});
	});

	test('unsupported settings remain visible and refuse toggles without changing bytes', () => {
		withFixture((config, _profile, locations) => {
			const file = path.join(locations[0].rootPath, 'unknown.toml');
			const contents = standalone + '[shell_tool]\nenabled = true\n';
			fs.writeFileSync(file, contents);
			const record = listManagedAgentRecords(config, locations)[0];
			assert.strictEqual(record.availability, 'unverified');
			assert.throws(() => setManagedAgentEnabled(config, record.id, true, locations), /validation is not implemented/);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), contents);
		});
	});

	test('alias edits and deletes protect same-name Base roles and unrelated files', () => {
		withFixture((config, profile, locations) => {
			const file = path.join(locations[1].rootPath, 'physical.toml');
			fs.writeFileSync(file, 'model = "project"\n');
			fs.writeFileSync(config, '[agents.alias]\ndescription = "Base"\nconfig_file = "base.toml"\n');
			fs.writeFileSync(path.join(path.dirname(config), 'base.toml'), 'model = "base"\n');
			const projectConfig = path.join(path.dirname(locations[1].rootPath), 'config.toml');
			fs.writeFileSync(projectConfig, '[agents.alias]\ndescription = "Project"\nconfig_file = "agents/physical.toml"\n');
			const before = [config, profile].map((source) => fs.readFileSync(source));
			const target = listManagedAgentRecords(config, locations).find((record) => record.configPath === projectConfig)!;
			const next = path.join(locations[1].rootPath, 'renamed.toml');
			editManagedAgent(config, target.id, next, 'Changed', locations);
			const edited = listManagedAgentRecords(config, locations).find((record) => record.configPath === projectConfig)!;
			assert.strictEqual(edited.roleKey, 'alias');
			assert.strictEqual(edited.description, 'Changed');
			assert.throws(() => resolveManagedAgent(config, { id: target.id }, locations), /changed/);
			deleteManagedAgent(config, edited.id, locations);
			assert.strictEqual(fs.existsSync(next), false);
			assert.deepStrictEqual([config, profile].map((source) => fs.readFileSync(source)), before);
		});
	});

	test('shared references refuse file edits and deletion instead of changing another source', () => {
		withFixture((config, profile, locations) => {
			const file = path.join(path.dirname(config), 'shared.toml');
			fs.writeFileSync(file, 'model = "keep"\n');
			const block = '[agents.alias]\ndescription = "Shared"\nconfig_file = "shared.toml"\n';
			fs.writeFileSync(config, block);
			fs.writeFileSync(profile, block);
			const record = listManagedAgentRecords(config, locations)[1];
			assert.throws(() => resolveManagedAgent(config, { agentPath: file }, locations), /ambiguous/);
			assert.throws(() => editManagedAgent(config, record.id, file, 'changed', locations), /Another definition/);
			assert.throws(() => deleteManagedAgent(config, record.id, locations), /Another definition/);
			assert.strictEqual(fs.readFileSync(config, 'utf8'), block);
			assert.strictEqual(fs.readFileSync(profile, 'utf8'), block);
		});
	});

	test('standalone filename edit preserves its body name, comments and instructions with literal metadata', () => {
		withFixture((config, _profile, locations) => {
			const file = path.join(locations[0].rootPath, 'filename.toml');
			fs.writeFileSync(file, standalone);
			const record = listManagedAgentRecords(config, locations)[0];
			const next = path.join(locations[0].rootPath, 'new-file.toml');
			editManagedAgent(config, record.id, next, 'Changed "description"', locations);
			const contents = fs.readFileSync(next, 'utf8');
			const parsed = toml.parse(contents);
			assert.strictEqual(parsed.name, 'body-name');
			assert.strictEqual(parsed.description, 'Changed "description"');
			assert.strictEqual(parsed.developer_instructions, 'Check changes.');
			assert.ok(contents.includes('# Keep comment\r\n'));
			assert.ok(contents.includes("name = 'body-name'\r\n"));
		});
	});
});
