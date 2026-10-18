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

function readSyncState(codexRoot: string): Record<string, Record<string, true>> {
	const statePath = path.join(codexRoot, '.codex-workspace', 'codex-sync.json');
	return JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, Record<string, true>>;
}

function pairState(
	state: Record<string, Record<string, true>>,
	scope: string,
	source: string,
	target: string,
): Record<string, true> | undefined {
	return state[`pair:${JSON.stringify([scope, path.resolve(source), path.resolve(target)])}`];
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
			const initialState = readSyncState(codexRoot);
			assert.strictEqual(pairState(initialState, 'templates', codexDir, targetDir)?.['old.md'], true);

			fs.rmSync(codexFile);
			syncDirectoryBidirectional('templates', codexRoot, codexDir, targetDir);

			assert.ok(!fs.existsSync(path.join(targetDir, 'old.md')));
			assert.ok(!fs.existsSync(targetDir));
			const finalState = readSyncState(codexRoot);
			assert.strictEqual(pairState(finalState, 'templates', codexDir, targetDir)?.['old.md'], undefined);
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

	test('syncCoreFilesBidirectional includes AGENTS.override.md', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const targetDir = path.join(root, 'sync');
			fs.mkdirSync(codexRoot, { recursive: true });
			fs.writeFileSync(path.join(codexRoot, 'AGENTS.override.md'), 'override', 'utf8');

			syncCoreFilesBidirectional(codexRoot, targetDir);

			assert.strictEqual(
				fs.readFileSync(path.join(targetDir, 'AGENTS.override.md'), 'utf8'),
				'override',
			);
		});
	});

	test('core sync keeps files when switching A to B to A', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const targetA = path.join(root, 'A');
			const targetB = path.join(root, 'B');
			fs.mkdirSync(codexRoot);
			for (const name of ['config.toml', 'AGENTS.md', 'AGENTS.override.md']) {
				fs.writeFileSync(path.join(codexRoot, name), name);
			}

			syncCoreFilesBidirectional(codexRoot, targetA);
			syncCoreFilesBidirectional(codexRoot, targetB);
			syncCoreFilesBidirectional(codexRoot, path.join(root, 'B', '..', 'A'));
			for (const name of ['config.toml', 'AGENTS.md', 'AGENTS.override.md']) {
				assert.strictEqual(fs.readFileSync(path.join(codexRoot, name), 'utf8'), name);
				assert.strictEqual(fs.readFileSync(path.join(targetA, name), 'utf8'), name);
				assert.strictEqual(fs.readFileSync(path.join(targetB, name), 'utf8'), name);
			}
			const state = readSyncState(codexRoot);
			assert.strictEqual(pairState(state, 'core', codexRoot, targetA)?.['config.toml'], true);
			assert.strictEqual(pairState(state, 'core', codexRoot, targetB)?.['config.toml'], true);
			assert.strictEqual(Object.keys(state).length, 2);
		});
	});

	test('directory sync isolates destination and source changes within a scope', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const sourceA = path.join(codexRoot, 'prompts');
			const sourceB = path.join(codexRoot, 'other-prompts');
			const targetA = path.join(root, 'A');
			const targetB = path.join(root, 'B');
			fs.mkdirSync(sourceA, { recursive: true });
			fs.mkdirSync(sourceB);
			fs.writeFileSync(path.join(sourceA, 'a.md'), 'from A');
			fs.writeFileSync(path.join(sourceB, 'a.md'), 'from B');

			syncDirectoryBidirectional('prompts', codexRoot, sourceA, targetA);
			syncDirectoryBidirectional('prompts', codexRoot, sourceA, targetB);
			fs.rmSync(path.join(targetB, 'a.md'));
			syncDirectoryBidirectional('prompts', codexRoot, sourceB, targetB);
			syncDirectoryBidirectional('prompts', codexRoot, sourceA, targetA);
			assert.strictEqual(fs.readFileSync(path.join(sourceA, 'a.md'), 'utf8'), 'from A');
			assert.strictEqual(fs.readFileSync(path.join(targetA, 'a.md'), 'utf8'), 'from A');
			assert.strictEqual(fs.readFileSync(path.join(sourceB, 'a.md'), 'utf8'), 'from B');
			assert.strictEqual(fs.readFileSync(path.join(targetB, 'a.md'), 'utf8'), 'from B');
			const state = readSyncState(codexRoot);
			assert.strictEqual(pairState(state, 'prompts', sourceA, targetA)?.['a.md'], true);
			assert.strictEqual(pairState(state, 'prompts', sourceA, targetB)?.['a.md'], true);
			assert.strictEqual(pairState(state, 'prompts', sourceB, targetB)?.['a.md'], true);
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
			const initialState = readSyncState(codexRoot);
			assert.strictEqual(pairState(initialState, 'agents', codexDir, targetDir)?.['reviewer.toml'], true);

			removeSyncStateEntry(codexRoot, 'agents', 'reviewer.toml');
			const nextState = readSyncState(codexRoot);
			assert.strictEqual(pairState(nextState, 'agents', codexDir, targetDir)?.['reviewer.toml'], undefined);
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

	test('legacy scope-only history does not delete core or directory files', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const promptsDir = path.join(codexRoot, 'prompts');
			const coreTarget = path.join(root, 'core-target');
			const promptsTarget = path.join(root, 'prompts-target');
			fs.mkdirSync(promptsDir, { recursive: true });
			fs.writeFileSync(path.join(codexRoot, 'config.toml'), 'safe = true');
			fs.writeFileSync(path.join(promptsDir, 'keep.md'), 'keep');
			fs.writeFileSync(path.join(promptsDir, '.hidden.md'), 'hidden');
			fs.mkdirSync(path.join(promptsDir, '.codex-workspace'));
			fs.writeFileSync(path.join(promptsDir, '.codex-workspace', 'meta.json'), 'meta');
			const legacyPath = path.join(codexRoot, '.codex-sync', 'state.json');
			fs.mkdirSync(path.dirname(legacyPath));
			fs.writeFileSync(legacyPath, JSON.stringify({ core: { 'config.toml': true }, prompts: { 'keep.md': true } }));

			syncCoreFilesBidirectional(codexRoot, coreTarget);
			syncDirectoryBidirectional('prompts', codexRoot, promptsDir, promptsTarget);
			assert.strictEqual(fs.readFileSync(path.join(codexRoot, 'config.toml'), 'utf8'), 'safe = true');
			assert.strictEqual(fs.readFileSync(path.join(coreTarget, 'config.toml'), 'utf8'), 'safe = true');
			assert.strictEqual(fs.readFileSync(path.join(promptsDir, 'keep.md'), 'utf8'), 'keep');
			assert.strictEqual(fs.readFileSync(path.join(promptsTarget, 'keep.md'), 'utf8'), 'keep');
			assert.ok(!fs.existsSync(path.join(promptsTarget, '.hidden.md')));
			assert.ok(!fs.existsSync(path.join(promptsTarget, '.codex-workspace')));
			assert.ok(!fs.existsSync(legacyPath));
			const state = readSyncState(codexRoot);
			assert.strictEqual(pairState(state, 'core', codexRoot, coreTarget)?.['config.toml'], true);
			assert.strictEqual(pairState(state, 'prompts', promptsDir, promptsTarget)?.['keep.md'], true);
		});
	});

	test('scope-only history at the current state path cannot delete a core file', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const targetDir = path.join(root, 'new-target');
			fs.mkdirSync(path.join(codexRoot, '.codex-workspace'), { recursive: true });
			fs.writeFileSync(path.join(codexRoot, 'config.toml'), 'preserved');
			fs.writeFileSync(
				path.join(codexRoot, '.codex-workspace', 'codex-sync.json'),
				JSON.stringify({ core: { 'config.toml': true } }),
			);
			syncCoreFilesBidirectional(codexRoot, targetDir);
			assert.strictEqual(fs.readFileSync(path.join(codexRoot, 'config.toml'), 'utf8'), 'preserved');
			assert.strictEqual(fs.readFileSync(path.join(targetDir, 'config.toml'), 'utf8'), 'preserved');
		});
	});

	test('removing a tracked entry clears every destination in the scope', () => {
		withTempDir((root) => {
			const codexRoot = path.join(root, '.codex');
			const codexDir = path.join(codexRoot, 'agents');
			const targetA = path.join(root, 'A');
			const targetB = path.join(root, 'B');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'reviewer.toml'), 'agent');
			syncDirectoryBidirectional('agents', codexRoot, codexDir, targetA);
			syncDirectoryBidirectional('agents', codexRoot, codexDir, targetB);
			removeSyncStateEntry(codexRoot, 'agents', 'reviewer.toml');
			const state = readSyncState(codexRoot);
			assert.strictEqual(pairState(state, 'agents', codexDir, targetA)?.['reviewer.toml'], undefined);
			assert.strictEqual(pairState(state, 'agents', codexDir, targetB)?.['reviewer.toml'], undefined);
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
