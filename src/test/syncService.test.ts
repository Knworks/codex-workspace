import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	removeSyncStateEntry,
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
			const statePath = path.join(codexRoot, '.codex-workspace', 'codex-sync.json');
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

	test('syncDirectoryBidirectional excludes .codex-workspace paths', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync');
			const metaDir = path.join(codexDir, '.codex-workspace');
			fs.mkdirSync(metaDir, { recursive: true });
			fs.writeFileSync(path.join(metaDir, 'meta.json'), 'meta', 'utf8');

			syncDirectoryBidirectional('prompts', codexRoot, codexDir, targetDir);
			assert.ok(
				!fs.existsSync(path.join(targetDir, '.codex-workspace', 'meta.json')),
			);
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

	test('removeSyncStateEntry removes tracked path from scope', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'agents');
			const targetDir = path.join(root, 'sync-agents');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'reviewer.toml'), 'x', 'utf8');

			syncDirectoryBidirectional('agents', codexRoot, codexDir, targetDir);
			const statePath = path.join(codexRoot, '.codex-workspace', 'codex-sync.json');
			const initialState = JSON.parse(
				fs.readFileSync(statePath, 'utf8'),
			) as Record<string, Record<string, unknown>>;
			assert.ok(initialState.agents?.['reviewer.toml']);

			removeSyncStateEntry(codexRoot, 'agents', 'reviewer.toml');
			const nextState = JSON.parse(
				fs.readFileSync(statePath, 'utf8'),
			) as Record<string, Record<string, unknown>>;
			assert.ok(!nextState.agents?.['reviewer.toml']);
		});
	});

	test('read prefers new sync state path over legacy path', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'new.md'), 'new', 'utf8');

			const newStatePath = path.join(codexRoot, '.codex-workspace', 'codex-sync.json');
			const legacyStatePath = path.join(codexRoot, '.codex-sync', 'state.json');
			fs.mkdirSync(path.dirname(newStatePath), { recursive: true });
			fs.mkdirSync(path.dirname(legacyStatePath), { recursive: true });
			fs.writeFileSync(
				newStatePath,
				JSON.stringify({ prompts: { 'new.md': true } }, null, 2),
				'utf8',
			);
			fs.writeFileSync(
				legacyStatePath,
				JSON.stringify({ prompts: { 'legacy.md': true } }, null, 2),
				'utf8',
			);

			removeSyncStateEntry(codexRoot, 'prompts', 'new.md');
			const nextState = JSON.parse(fs.readFileSync(newStatePath, 'utf8')) as {
				prompts?: Record<string, unknown>;
			};
			assert.ok(!nextState.prompts?.['new.md']);
			const legacyState = JSON.parse(fs.readFileSync(legacyStatePath, 'utf8')) as {
				prompts?: Record<string, unknown>;
			};
			assert.strictEqual(legacyState.prompts?.['legacy.md'], true);

			syncDirectoryBidirectional('prompts', codexRoot, codexDir, targetDir);
			assert.ok(fs.existsSync(path.join(targetDir, 'new.md')));
		});
	});

	test('migrates legacy state to new path atomically and removes legacy state', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'skills');
			const targetDir = path.join(root, 'sync-skills');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'skill.md'), 'skill', 'utf8');

			const legacyStatePath = path.join(codexRoot, '.codex-sync', 'state.json');
			fs.mkdirSync(path.dirname(legacyStatePath), { recursive: true });
			fs.writeFileSync(
				legacyStatePath,
				JSON.stringify({ skills: { 'skill.md': true } }, null, 2),
				'utf8',
			);

			syncDirectoryBidirectional('skills', codexRoot, codexDir, targetDir);
			const newStatePath = path.join(codexRoot, '.codex-workspace', 'codex-sync.json');
			assert.ok(fs.existsSync(newStatePath));
			assert.ok(!fs.existsSync(legacyStatePath));
		});
	});

	test('keeps legacy state and aborts when migration fails', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'templates');
			const targetDir = path.join(root, 'sync-templates');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'template.md'), 'template', 'utf8');

			const legacyStatePath = path.join(codexRoot, '.codex-sync', 'state.json');
			fs.mkdirSync(path.dirname(legacyStatePath), { recursive: true });
			fs.writeFileSync(
				legacyStatePath,
				JSON.stringify({ templates: { 'template.md': true } }, null, 2),
				'utf8',
			);

			const metaDirPath = path.join(codexRoot, '.codex-workspace');
			fs.mkdirSync(codexRoot, { recursive: true });
			fs.writeFileSync(metaDirPath, 'blocked', 'utf8');

			assert.throws(() =>
				syncDirectoryBidirectional('templates', codexRoot, codexDir, targetDir),
			);
			assert.ok(fs.existsSync(legacyStatePath));
			assert.ok(!fs.existsSync(path.join(metaDirPath, 'codex-sync.json')));
		});
	});

	test('migration does not move or delete codex-templates', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const promptsDir = path.join(codexRoot, 'prompts');
			const targetDir = path.join(root, 'sync-prompts');
			fs.mkdirSync(promptsDir, { recursive: true });
			fs.writeFileSync(path.join(promptsDir, 'prompt.md'), 'prompt', 'utf8');

			const templateDir = path.join(codexRoot, 'codex-templates');
			const templateFile = path.join(templateDir, 'keep.md');
			fs.mkdirSync(templateDir, { recursive: true });
			fs.writeFileSync(templateFile, 'keep', 'utf8');

			const legacyStatePath = path.join(codexRoot, '.codex-sync', 'state.json');
			fs.mkdirSync(path.dirname(legacyStatePath), { recursive: true });
			fs.writeFileSync(legacyStatePath, JSON.stringify({ prompts: {} }, null, 2), 'utf8');

			syncDirectoryBidirectional('prompts', codexRoot, promptsDir, targetDir);

			assert.ok(fs.existsSync(templateFile));
			assert.ok(
				!fs.existsSync(
					path.join(codexRoot, '.codex-workspace', 'codex-templates', 'keep.md'),
				),
			);
		});
	});
});
