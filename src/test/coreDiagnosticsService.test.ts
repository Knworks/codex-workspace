import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	addTrustedDirectory,
	buildAgentsLoadingChain,
	listTrustedDirectories,
	removeTrustedDirectory,
} from '../services/coreDiagnosticsService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-diag-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Core diagnostics service', () => {
	test('buildAgentsLoadingChain marks higher priority project override active', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const codexDir = path.join(homeDir, '.codex');
			const workspaceRoot = path.join(root, 'workspace');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(workspaceRoot, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'config.toml'), 'project_doc_fallback_filenames = ["GUIDE.md"]', 'utf8');
			fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.override.md'), 'override', 'utf8');
			fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'standard', 'utf8');

			const nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);

			const override = nodes.find((node) => node.fileName === 'AGENTS.override.md' && node.kind === 'Project');
			const standard = nodes.find((node) => node.fileName === 'AGENTS.md' && node.kind === 'Project');
			const fallback = nodes.find((node) => node.fileName === 'GUIDE.md');
			assert.strictEqual(override?.status, 'Active');
			assert.strictEqual(standard?.status, 'Skipped');
			assert.strictEqual(fallback?.status, 'Missing');
		});
	});

	test('trusted directories can be listed added and removed', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const projectPath = path.join(root, 'project');
			fs.mkdirSync(projectPath, { recursive: true });

			addTrustedDirectory(configPath, projectPath);
			let trusted = listTrustedDirectories(configPath);
			assert.strictEqual(trusted.length, 1);
			assert.strictEqual(trusted[0].path, projectPath);
			assert.strictEqual(trusted[0].exists, true);

			assert.strictEqual(removeTrustedDirectory(configPath, projectPath), true);
			trusted = listTrustedDirectories(configPath);
			assert.strictEqual(trusted.length, 0);
		});
	});
});
