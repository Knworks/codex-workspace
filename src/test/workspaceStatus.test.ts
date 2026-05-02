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
