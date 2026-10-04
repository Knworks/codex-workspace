import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getCoreWorkspaceStatus,
	getWorkspaceStatus,
	resolveCodexPaths,
	UNAVAILABLE_REASONS,
} from '../services/workspaceStatus';

function withTempHome(run: (homeDir: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workspace-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Workspace status', () => {
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

	test('uses CODEX_HOME for paths and workspace availability', () => {
		withTempHome((homeDir) => {
			process.env.CODEX_HOME = path.join(homeDir, 'custom-codex');
			fs.mkdirSync(process.env.CODEX_HOME);
			fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), '', 'utf8');
			assert.deepStrictEqual(resolveCodexPaths(homeDir), {
				codexDir: process.env.CODEX_HOME,
				configPath: path.join(process.env.CODEX_HOME, 'config.toml'),
			});
			assert.strictEqual(getWorkspaceStatus(homeDir).isAvailable, true);
			assert.strictEqual(getCoreWorkspaceStatus(homeDir).isAvailable, true);
		});
	});

	test('uses the default codex directory when CODEX_HOME is unset or empty', () => {
		withTempHome((homeDir) => {
			const expected = {
				codexDir: path.join(homeDir, '.codex'),
				configPath: path.join(homeDir, '.codex', 'config.toml'),
			};
			assert.deepStrictEqual(resolveCodexPaths(homeDir), expected);
			process.env.CODEX_HOME = '';
			assert.deepStrictEqual(resolveCodexPaths(homeDir), expected);
		});
	});
	test('reports missing codex directory', () => {
		withTempHome((homeDir) => {
			const status = getWorkspaceStatus(homeDir);
			assert.strictEqual(status.isAvailable, false);
			assert.strictEqual(status.reason, UNAVAILABLE_REASONS.codexMissing);
		});
	});

	test('reports missing config.toml', () => {
		withTempHome((homeDir) => {
			const paths = resolveCodexPaths(homeDir);
			fs.mkdirSync(paths.codexDir, { recursive: true });

			const status = getWorkspaceStatus(homeDir);
			assert.strictEqual(status.isAvailable, false);
			assert.strictEqual(status.reason, UNAVAILABLE_REASONS.configMissing);
		});
	});

	test('reports invalid config.toml', () => {
		withTempHome((homeDir) => {
			const paths = resolveCodexPaths(homeDir);
			fs.mkdirSync(paths.codexDir, { recursive: true });
			fs.writeFileSync(paths.configPath, 'invalid = [', 'utf8');

			const status = getWorkspaceStatus(homeDir);
			assert.strictEqual(status.isAvailable, false);
			assert.strictEqual(status.reason, UNAVAILABLE_REASONS.configInvalid);
		});
	});

	test('core status allows invalid config.toml for repair operations', () => {
		withTempHome((homeDir) => {
			const paths = resolveCodexPaths(homeDir);
			fs.mkdirSync(paths.codexDir, { recursive: true });
			fs.writeFileSync(paths.configPath, 'invalid = [', 'utf8');

			const status = getCoreWorkspaceStatus(homeDir);
			assert.strictEqual(status.isAvailable, true);
			assert.strictEqual(status.reason, UNAVAILABLE_REASONS.configInvalid);
			assert.strictEqual(status.isConfigInvalid, true);
		});
	});

	test('reports available workspace', () => {
		withTempHome((homeDir) => {
			const paths = resolveCodexPaths(homeDir);
			fs.mkdirSync(paths.codexDir, { recursive: true });
			fs.writeFileSync(paths.configPath, 'title = \"ok\"', 'utf8');

			const status = getWorkspaceStatus(homeDir);
			assert.strictEqual(status.isAvailable, true);
			assert.strictEqual(status.reason, undefined);
		});
	});
});
