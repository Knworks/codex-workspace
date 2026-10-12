import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listProfileConfigFiles } from '../services/profileConfigService';

suite('Profile V2 configuration files', () => {
	let tempRoot: string;
	let originalCodexHome: string | undefined;
	setup(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-profiles-'));
		originalCodexHome = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
	});
	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});
	test('returns no profiles for a missing or empty default home', () => {
		assert.deepStrictEqual(listProfileConfigFiles(tempRoot), []);
		fs.mkdirSync(path.join(tempRoot, '.codex'));
		assert.deepStrictEqual(listProfileConfigFiles(tempRoot), []);
	});
	test('lists one profile separately from the base and unrelated files', () => {
		const codexDir = path.join(tempRoot, '.codex');
		fs.mkdirSync(codexDir);
		for (const name of ['config.toml', 'dev.config.toml', '.config.toml', 'dev.config.toml.bak', 'AGENTS.md']) {
			fs.writeFileSync(path.join(codexDir, name), 'invalid TOML is still openable');
		}
		fs.mkdirSync(path.join(codexDir, 'folder.config.toml'));
		assert.deepStrictEqual(listProfileConfigFiles(tempRoot), [{
			name: 'dev', fileName: 'dev.config.toml', configPath: path.join(codexDir, 'dev.config.toml'),
		}]);
	});
	test('uses CODEX_HOME and sorts multiple profiles without scanning nested directories', () => {
		const codexDir = path.join(tempRoot, 'custom home 日本語');
		process.env.CODEX_HOME = codexDir;
		fs.mkdirSync(path.join(codexDir, 'nested'), { recursive: true });
		for (const name of ['z.config.toml', 'a.config.toml', 'config.toml']) {
			fs.writeFileSync(path.join(codexDir, name), '');
		}
		fs.writeFileSync(path.join(codexDir, 'nested', 'hidden.config.toml'), '');
		assert.deepStrictEqual(listProfileConfigFiles(tempRoot).map((profile) => profile.fileName), [
			'a.config.toml', 'z.config.toml',
		]);
		assert.ok(listProfileConfigFiles().every((profile) => path.dirname(profile.configPath) === codexDir));
	});
});
