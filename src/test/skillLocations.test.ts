import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import {
	findSkillLocationForPath,
	getSkillLocations,
} from '../services/skillLocations';

suite('Skill locations', () => {
	test('returns project workspace and user skill locations in priority order', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const homeDir = path.join(tempRoot, 'home');
		const repoRoot = path.join(tempRoot, 'repo');
		const projectRoot = path.join(repoRoot, 'packages', 'feature');
		try {
			fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
			fs.mkdirSync(projectRoot, { recursive: true });
			const locations = getSkillLocations(homeDir, projectRoot);

			assert.deepStrictEqual(
				locations.map((location) => location.kind),
				['project', 'project', 'project', 'project', 'project', 'project', 'workspace', 'user', 'system'],
			);
			assert.strictEqual(
				locations[0].rootPath,
				path.join(projectRoot, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[2].rootPath,
				path.join(repoRoot, 'packages', '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[4].rootPath,
				path.join(repoRoot, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[6].rootPath,
				path.join(homeDir, '.codex', 'skills'),
			);
			assert.strictEqual(
				locations[7].rootPath,
				path.join(homeDir, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[8].rootPath,
				path.join(homeDir, '.codex', 'skills', '.system'),
			);
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('findSkillLocationForPath resolves paths under a skill root', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const homeDir = path.join(tempRoot, 'home');
		const repoRoot = path.join(tempRoot, 'repo');
		const projectRoot = path.join(repoRoot, 'packages', 'feature');
		const skillPath = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
		try {
			fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
			fs.mkdirSync(projectRoot, { recursive: true });
			const locations = getSkillLocations(homeDir, projectRoot);
			const location = findSkillLocationForPath(skillPath, locations);

			assert.strictEqual(location?.kind, 'user');
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('includes legacy project skills without changing the creation destination', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const homeDir = path.join(tempRoot, 'home');
		const projectRoot = path.join(tempRoot, 'repo');
		const legacyRoot = path.join(projectRoot, '.codex', 'skills');

		try {
			fs.mkdirSync(legacyRoot, { recursive: true });

			const locations = getSkillLocations(homeDir, projectRoot);

			assert.strictEqual(locations[1].rootPath, legacyRoot);
			assert.strictEqual(locations[1].createPath, undefined);
			assert.strictEqual(
				locations[0].createPath,
				path.join(projectRoot, '.agents', 'skills'),
			);
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('includes both roots at each ancestor and stops at a Git worktree marker', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const repoRoot = path.join(tempRoot, 'repo');
		const projectRoot = path.join(repoRoot, 'feature');
		try {
			fs.mkdirSync(projectRoot, { recursive: true });
			fs.writeFileSync(path.join(repoRoot, '.git'), 'gitdir: elsewhere');
			const expectedRoots = [
				path.join(projectRoot, '.agents', 'skills'),
				path.join(projectRoot, '.codex', 'skills'),
				path.join(repoRoot, '.agents', 'skills'),
				path.join(repoRoot, '.codex', 'skills'),
			];
			for (const root of [...expectedRoots, path.join(tempRoot, '.agents', 'skills')]) {
				fs.mkdirSync(root, { recursive: true });
			}
			const locations = getSkillLocations(path.join(tempRoot, 'home'), projectRoot)
				.filter((location) => location.kind === 'project');
			assert.deepStrictEqual(locations.map((location) => location.rootPath), expectedRoots);
			for (const location of locations) {
				assert.strictEqual(
					findSkillLocationForPath(path.join(location.rootPath, 'review', 'SKILL.md'), locations),
					location,
				);
			}
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('without a Git marker only searches the selected project directory', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const projectRoot = path.join(tempRoot, 'feature');
		try {
			fs.mkdirSync(projectRoot, { recursive: true });
			const locations = getSkillLocations(path.join(tempRoot, 'home'), projectRoot)
				.filter((location) => location.kind === 'project');
			assert.deepStrictEqual(locations.map((location) => location.rootPath), [
				path.join(projectRoot, '.agents', 'skills'),
				path.join(projectRoot, '.codex', 'skills'),
			]);
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('deduplicates a root shared by project and user scope', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		try {
			const locations = getSkillLocations(tempRoot, tempRoot);
			assert.strictEqual(locations.filter((location) =>
				location.rootPath === path.join(tempRoot, '.agents', 'skills')).length, 1);
			assert.strictEqual(locations.find((location) => location.kind === 'workspace')?.rootPath,
				path.join(tempRoot, '.codex', 'skills'));
			assert.strictEqual(locations.find((location) => location.kind === 'user')?.rootPath,
				path.join(tempRoot, '.agents', 'skills'));
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
