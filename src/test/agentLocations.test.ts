import * as assert from 'assert';
import path from 'path';
import {
	findAgentLocationForPath,
	getAgentLocations,
} from '../services/agentLocations';

suite('Agent locations', () => {
	test('returns project and workspace agent locations in priority order', () => {
		const homeDir = path.join('home');
		const projectRoot = path.join('repo');

		const locations = getAgentLocations(homeDir, projectRoot);

		assert.deepStrictEqual(
			locations.map((location) => location.kind),
			['project', 'workspace'],
		);
		assert.strictEqual(
			locations[0].rootPath,
			path.join(projectRoot, '.codex', 'agents'),
		);
		assert.strictEqual(
			locations[1].rootPath,
			path.join(homeDir, '.codex', 'agents'),
		);
	});

	test('findAgentLocationForPath resolves paths under an agent root', () => {
		const homeDir = path.join('home');
		const projectRoot = path.join('repo');
		const locations = getAgentLocations(homeDir, projectRoot);
		const agentPath = path.join(projectRoot, '.codex', 'agents', 'reviewer.toml');

		const location = findAgentLocationForPath(agentPath, locations);

		assert.strictEqual(location?.kind, 'project');
	});
});
