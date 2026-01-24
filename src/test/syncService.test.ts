import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	syncCoreFilesBidirectional,
	syncDirectoryBidirectional,
} from '../services/syncService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workspace-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function setMtime(targetPath: string, mtimeMs: number): void {
	const time = new Date(mtimeMs);
	fs.utimesSync(targetPath, time, time);
}

suite('Sync service', () => {
	test('syncDirectoryBidirectional copies newer file to older side', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(targetDir, { recursive: true });

			const codexFile = path.join(codexDir, 'note.md');
			const targetFile = path.join(targetDir, 'note.md');
			fs.writeFileSync(codexFile, 'from-codex', 'utf8');
			fs.writeFileSync(targetFile, 'from-target', 'utf8');

			setMtime(codexFile, 2_000);
			setMtime(targetFile, 1_000);

			syncDirectoryBidirectional('prompts', codexRoot, codexDir, targetDir);

			assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'from-codex');
		});
	});

	test('syncDirectoryBidirectional copies new files to missing side', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'skills');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexDir, { recursive: true });

			const codexFile = path.join(codexDir, 'new.md');
			fs.writeFileSync(codexFile, 'new', 'utf8');

			syncDirectoryBidirectional('skills', codexRoot, codexDir, targetDir);

			assert.strictEqual(
				fs.readFileSync(path.join(targetDir, 'new.md'), 'utf8'),
				'new',
			);
		});
	});

	test('syncDirectoryBidirectional copies target-only files to codex', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'skills');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(targetDir, { recursive: true });

			const targetFile = path.join(targetDir, 'from-target.md');
			fs.writeFileSync(targetFile, 'target', 'utf8');

			syncDirectoryBidirectional('skills', codexRoot, codexDir, targetDir);

			assert.strictEqual(
				fs.readFileSync(path.join(codexDir, 'from-target.md'), 'utf8'),
				'target',
			);
		});
	});

	test('syncDirectoryBidirectional deletes files removed on one side', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'templates');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexDir, { recursive: true });

			const codexFile = path.join(codexDir, 'old.md');
			fs.writeFileSync(codexFile, 'old', 'utf8');

			syncDirectoryBidirectional('templates', codexRoot, codexDir, targetDir);
			assert.ok(fs.existsSync(path.join(targetDir, 'old.md')));
			const statePath = path.join(codexRoot, '.codex-sync', 'state.json');
			assert.ok(fs.existsSync(statePath));
			const initialState = JSON.parse(
				fs.readFileSync(statePath, 'utf8'),
			) as Record<string, Record<string, unknown>>;
			assert.ok(initialState.templates);
			assert.ok(initialState.templates['old.md']);

			fs.rmSync(codexFile);
			syncDirectoryBidirectional('templates', codexRoot, codexDir, targetDir);

			assert.ok(!fs.existsSync(path.join(targetDir, 'old.md')));
			assert.ok(!fs.existsSync(targetDir));
			const finalState = JSON.parse(
				fs.readFileSync(statePath, 'utf8'),
			) as Record<string, Record<string, unknown>>;
			assert.ok(!finalState.templates?.['old.md']);
		});
	});

	test('syncDirectoryBidirectional skips hidden paths', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync');
			const hiddenDir = path.join(codexDir, '.hidden');
			fs.mkdirSync(hiddenDir, { recursive: true });
			fs.writeFileSync(path.join(hiddenDir, 'secret.md'), 'secret', 'utf8');

			syncDirectoryBidirectional('prompts', codexRoot, codexDir, targetDir);

			assert.ok(!fs.existsSync(path.join(targetDir, '.hidden', 'secret.md')));
		});
	});

	test('syncDirectoryBidirectional records skipped files on copy error', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(targetDir, { recursive: true });

			const codexFile = path.join(codexDir, 'blocked.md');
			fs.writeFileSync(codexFile, 'blocked', 'utf8');
			fs.mkdirSync(path.join(targetDir, 'blocked.md'));

			const result = syncDirectoryBidirectional(
				'prompts',
				codexRoot,
				codexDir,
				targetDir,
			);

			assert.strictEqual(result.skipped.length, 1);
		});
	});

	test('syncCoreFilesBidirectional deletes core files removed on one side', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexRoot, { recursive: true });

			const agentsFile = path.join(codexRoot, 'AGENTS.md');
			fs.writeFileSync(agentsFile, 'agents', 'utf8');
			fs.writeFileSync(path.join(codexRoot, 'config.toml'), 'ok = true', 'utf8');

			syncCoreFilesBidirectional(codexRoot, targetDir);
			assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')));

			fs.rmSync(agentsFile);
			syncCoreFilesBidirectional(codexRoot, targetDir);

			assert.ok(!fs.existsSync(path.join(targetDir, 'AGENTS.md')));
		});
	});
});
