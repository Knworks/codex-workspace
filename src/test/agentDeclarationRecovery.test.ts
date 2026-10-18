import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'toml';
import { disableAgentByName, enableAgentByName } from '../services/agentManagerService';
import { extractAgentConfigBlock, appendAgentConfigRawBlock } from '../services/agentConfigService';
import { getDisabledAgentBlock, getDisabledAgentsStorePath } from '../services/disabledAgentsStore';

const declaration = '[agents.reviewer]\ndescription = "review"\nconfig_file = "../custom.toml"\n';

function withFiles(run: (config: string, store: string, root: string) => void): void {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recovery-'));
	try {
		const config = path.join(root, 'config.toml');
		fs.writeFileSync(config, declaration);
		run(config, getDisabledAgentsStorePath(root), root);
	} finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function failReplace(target: string, run: () => void): void {
	const original = fs.renameSync;
	fs.renameSync = (source, destination) => {
		if (String(destination) === target) { throw new Error('EACCES injected'); }
		original(source, destination);
	};
	try { assert.throws(run, /EACCES/); } finally { fs.renameSync = original; }
}

suite('Agent declaration recovery', () => {
	for (const contents of [
		`${declaration}[agents.other]\nx = 4\n[agents.reviewer.features]\nshell_tool = false\n[[agents.reviewer.unknown]]\nvalue = [1, 2]\n`,
		'[agents]\nreviewer = { description = "review", config_file = "../custom.toml", unknown = { flag = false } }\nother = { description = "other" }\n',
		'[agents]\nreviewer = { values = [1.0, 2.5], date = 2026-01-02T03:04:05+09:00, text = "a\\nb" }\nother = { values = [1.0, 3.5] }\n',
		'agents = { reviewer = { config_file = "../custom.toml" }, other = { value = 3 } }\nmodel = "keep-root"\n[features]\nx = true\n',
		'[agents.\'review.er\'.features]\ntext = """\n[agents.fake]\n"""\n[agents.other]\nx = 1\n',
	]) {
		test(`round trip preserves all role values: ${contents.split('\n')[0]}`, () => {
			const id = contents.includes("'review.er'") ? 'review.er' : 'reviewer';
			const before = toml.parse(contents);
			const extracted = extractAgentConfigBlock(contents, id);
			assert.strictEqual(extracted.removed, true);
			const after = toml.parse(extracted.contents);
			const expected = toml.parse(contents);
			delete (expected.agents as Record<string, unknown>)[id];
			assert.deepStrictEqual(after, expected);
			assert.deepStrictEqual(toml.parse(appendAgentConfigRawBlock(extracted.contents, extracted.block!)), before);
		});
	}

	test('invalid redeclaration fails before saving config or creating a backup', () => withFiles((config, store, root) => {
		const invalid = '[agents]\nreviewer = { description = "" }\n[agents.reviewer.features]\nflag = false\n';
		fs.writeFileSync(config, invalid);
		assert.throws(() => disableAgentByName(root, config, 'reviewer'), /Cannot redefine/);
		assert.strictEqual(fs.readFileSync(config, 'utf8'), invalid);
		assert.strictEqual(fs.existsSync(store), false);
	}));

	test('quoted prototype-like role keys survive backup and restoration', () => withFiles((config, store, root) => {
		const contents = '[agents."__proto__"]\nconfig_file = "../arbitrary.toml"\n';
		fs.writeFileSync(config, contents);
		disableAgentByName(root, config, '__proto__');
		assert.ok(getDisabledAgentBlock(store, '__proto__')?.includes('../arbitrary.toml'));
		enableAgentByName(root, config, '__proto__');
		assert.deepStrictEqual(toml.parse(fs.readFileSync(config, 'utf8')), toml.parse(contents));
	}));

	test('partial config write preserves both disabled config and backup for retry', () => withFiles((config, store, root) => {
		disableAgentByName(root, config, 'reviewer');
		const backup = fs.readFileSync(store, 'utf8');
		const original = fs.writeFileSync;
		fs.writeFileSync = ((file, data, options) => {
			if (String(file).startsWith(`${config}.`)) {
				original(file, '[agents.', options);
				throw new Error('ENOSPC injected');
			}
			return original(file, data, options);
		}) as typeof fs.writeFileSync;
		try { assert.throws(() => enableAgentByName(root, config, 'reviewer'), /ENOSPC/); }
		finally { fs.writeFileSync = original; }
		assert.strictEqual(fs.readFileSync(config, 'utf8'), '');
		assert.strictEqual(fs.readFileSync(store, 'utf8'), backup);
		enableAgentByName(root, config, 'reviewer');
		assert.deepStrictEqual(toml.parse(fs.readFileSync(config, 'utf8')), toml.parse(declaration));
	}));

	for (const target of ['config', 'store'] as const) {
		test(`disable ${target} failure preserves original and allows retry`, () => withFiles((config, store, root) => {
			failReplace(target === 'config' ? config : store, () => disableAgentByName(root, config, 'reviewer'));
			assert.strictEqual(fs.readFileSync(config, 'utf8'), declaration);
			assert.strictEqual(disableAgentByName(root, config, 'reviewer').changed, true);
			assert.ok(getDisabledAgentBlock(store, 'reviewer')?.includes('../custom.toml'));
			enableAgentByName(root, config, 'reviewer');
			assert.deepStrictEqual(toml.parse(fs.readFileSync(config, 'utf8')), toml.parse(declaration));
			assert.strictEqual(getDisabledAgentBlock(store, 'reviewer'), undefined);
		}));

		test(`enable ${target} failure keeps backup and retry restores arbitrary path`, () => withFiles((config, store, root) => {
			disableAgentByName(root, config, 'reviewer');
			const stashed = fs.readFileSync(store, 'utf8');
			failReplace(target === 'config' ? config : store, () => enableAgentByName(root, config, 'reviewer'));
			assert.strictEqual(fs.readFileSync(store, 'utf8'), stashed);
			if (target === 'config') { assert.strictEqual(fs.readFileSync(config, 'utf8'), ''); }
			enableAgentByName(root, config, 'reviewer');
			assert.deepStrictEqual(toml.parse(fs.readFileSync(config, 'utf8')), toml.parse(declaration));
			assert.strictEqual(getDisabledAgentBlock(store, 'reviewer'), undefined);
			assert.ok(!fs.readdirSync(root).some((file) => file.endsWith('.tmp')));
			assert.ok(!fs.readdirSync(path.dirname(store)).some((file) => file.endsWith('.tmp')));
		}));
	}

	test('partial backup write leaves existing backup and config intact', () => withFiles((config, store, root) => {
		disableAgentByName(root, config, 'reviewer');
		const backup = fs.readFileSync(store, 'utf8');
		fs.writeFileSync(config, declaration);
		const original = fs.writeFileSync;
		fs.writeFileSync = ((file, data, options) => {
			if (String(file).startsWith(`${store}.`)) {
				original(file, '{partial', options);
				throw new Error('ENOSPC injected');
			}
			return original(file, data, options);
		}) as typeof fs.writeFileSync;
		try { assert.throws(() => disableAgentByName(root, config, 'reviewer'), /ENOSPC/); }
		finally { fs.writeFileSync = original; }
		assert.strictEqual(fs.readFileSync(config, 'utf8'), declaration);
		assert.strictEqual(fs.readFileSync(store, 'utf8'), backup);
	}));

	test('missing disable and existing enable explicitly report unchanged', () => withFiles((config, _store, root) => {
		assert.strictEqual(disableAgentByName(root, config, 'missing').changed, false);
		assert.strictEqual(enableAgentByName(root, config, 'reviewer').changed, false);
		assert.strictEqual(fs.readFileSync(config, 'utf8'), declaration);
	}));
});
