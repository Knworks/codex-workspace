import * as assert from 'assert';
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
			['project', 'workspace', 'user'],
		);
		assert.strictEqual(
			locations[0].rootPath,
			path.join(projectRoot, '.codex', 'skills'),
		);
		assert.strictEqual(
			locations[1].rootPath,
			path.join(homeDir, '.codex', 'skills'),
		);
		assert.strictEqual(
			locations[2].rootPath,
			path.join(homeDir, '.agents', 'skills'),
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
});
