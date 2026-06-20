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
				['project', 'project', 'project', 'workspace', 'user', 'system'],
			);
			assert.strictEqual(
				locations[0].rootPath,
				path.join(projectRoot, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[1].rootPath,
				path.join(repoRoot, 'packages', '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[2].rootPath,
				path.join(repoRoot, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[3].rootPath,
				path.join(homeDir, '.codex', 'skills'),
			);
			assert.strictEqual(
				locations[4].rootPath,
				path.join(homeDir, '.agents', 'skills'),
			);
			assert.strictEqual(
				locations[5].rootPath,
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

	test('falls back to legacy project skills location when preferred path is absent', () => {
		const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skills-'));
		const homeDir = path.join(tempRoot, 'home');
		const projectRoot = path.join(tempRoot, 'repo');
		const legacyRoot = path.join(projectRoot, '.codex', 'skills');

		try {
			fs.mkdirSync(legacyRoot, { recursive: true });

			const locations = getSkillLocations(homeDir, projectRoot);

			assert.strictEqual(locations[0].rootPath, legacyRoot);
			assert.strictEqual(
				locations[0].createPath,
				path.join(projectRoot, '.agents', 'skills'),
			);
		} finally {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
