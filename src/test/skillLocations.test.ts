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
		const homeDir = path.join('home');
		const projectRoot = path.join('repo');

		const locations = getSkillLocations(homeDir, projectRoot);

		assert.deepStrictEqual(
			locations.map((location) => location.kind),
			['project', 'workspace', 'user', 'system'],
		);
		assert.strictEqual(
			locations[0].rootPath,
			path.join(projectRoot, '.agents', 'skills'),
		);
		assert.strictEqual(
			locations[0].createPath,
			path.join(projectRoot, '.agents', 'skills'),
		);
		assert.strictEqual(
			locations[1].rootPath,
			path.join(homeDir, '.codex', 'skills'),
		);
		assert.strictEqual(
			locations[2].rootPath,
			path.join(homeDir, '.agents', 'skills'),
		);
		assert.strictEqual(
			locations[3].rootPath,
			path.join(homeDir, '.codex', 'skills', '.system'),
		);
	});

	test('findSkillLocationForPath resolves paths under a skill root', () => {
		const homeDir = path.join('home');
		const projectRoot = path.join('repo');
		const locations = getSkillLocations(homeDir, projectRoot);
		const skillPath = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');

		const location = findSkillLocationForPath(skillPath, locations);

		assert.strictEqual(location?.kind, 'user');
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
