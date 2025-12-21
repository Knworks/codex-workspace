import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
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
