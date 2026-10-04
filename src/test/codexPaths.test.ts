import * as assert from 'assert';
import os from 'os';
import path from 'path';
import { resolveCodexHomeDir, resolveCodexPaths } from '../services/codexPaths';

suite('Codex home resolver', () => {
	let originalCodexHome: string | undefined;

	setup(() => {
		originalCodexHome = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
	});

	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
	});

	for (const value of [undefined, '', ' \t ']) {
		test(`falls back to the user home for ${JSON.stringify(value)}`, () => {
			if (value !== undefined) {
				process.env.CODEX_HOME = value;
			}
			const homeDir = path.join(os.tmpdir(), 'codex-default-home');
			const expectedRoot = path.join(homeDir, '.codex');
			assert.strictEqual(resolveCodexHomeDir(homeDir), expectedRoot);
			assert.deepStrictEqual(resolveCodexPaths(homeDir), {
				codexDir: expectedRoot,
				configPath: path.join(expectedRoot, 'config.toml'),
			});
			assert.strictEqual(resolveCodexHomeDir(), path.join(os.homedir(), '.codex'));
		});
	}

	test('uses CODEX_HOME even when an explicit fallback home is supplied', () => {
		const codexHome = path.join(os.tmpdir(), 'runtime home');
		process.env.CODEX_HOME = codexHome;
		assert.strictEqual(resolveCodexHomeDir('fallback-home'), codexHome);
		assert.deepStrictEqual(resolveCodexPaths('fallback-home'), {
			codexDir: codexHome,
			configPath: path.join(codexHome, 'config.toml'),
		});
	});

	test('preserves non-blank paths and reads the current environment on each call', () => {
		process.env.CODEX_HOME = ' relative home ';
		assert.strictEqual(resolveCodexHomeDir(), ' relative home ');
		process.env.CODEX_HOME = 'another-home';
		assert.strictEqual(resolveCodexHomeDir(), 'another-home');
	});
});
