import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	listSkillRecords,
	readSkillEnabledByPath,
	readSkillMetadata,
	setSkillEnabled,
} from '../services/skillConfigService';
import { SkillLocation } from '../services/skillLocations';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-config-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Skill config service', () => {
	test('readSkillMetadata extracts name and description from frontmatter', () => {
		withTempDir((root) => {
			const skillPath = path.join(root, 'SKILL.md');
			fs.writeFileSync(
				skillPath,
				'---\nname: reviewer\ndescription: "Reviews code"\n---\n',
				'utf8',
			);

			const metadata = readSkillMetadata(skillPath);

			assert.strictEqual(metadata.name, 'reviewer');
			assert.strictEqual(metadata.description, 'Reviews code');
		});
	});

	test('listSkillRecords reads skills and disabled state from config', () => {
		withTempDir((root) => {
			const skillDir = path.join(root, 'skills', 'reviewer');
			fs.mkdirSync(skillDir, { recursive: true });
			const skillPath = path.join(skillDir, 'SKILL.md');
			fs.writeFileSync(
				skillPath,
				'---\nname: reviewer\ndescription: Reviews code\n---\n',
				'utf8',
			);
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(
				configPath,
				`[[skills.config]]\npath = '${skillPath}'\nenabled = false\n`,
				'utf8',
			);
			const location: SkillLocation = {
				kind: 'workspace',
				label: 'Workspace Skills',
				rootPath: path.join(root, 'skills'),
				priority: 2,
			};

			const records = listSkillRecords(configPath, [location]);

			assert.strictEqual(records.length, 1);
			assert.strictEqual(records[0].name, 'reviewer');
			assert.strictEqual(records[0].enabled, false);
		});
	});

	test('setSkillEnabled appends config block when missing', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const skillPath = path.join(root, 'skills', 'reviewer', 'SKILL.md');
			fs.writeFileSync(configPath, 'model = "gpt"\n', 'utf8');

			setSkillEnabled(configPath, skillPath, false);

			const enabledByPath = readSkillEnabledByPath(configPath);
			assert.strictEqual(enabledByPath.get(path.resolve(skillPath)), false);
		});
	});

	test('setSkillEnabled keeps skills blocks grouped before later project blocks', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const existingSkillPath = path.join(root, 'skills', 'alpha', 'SKILL.md');
			const nextSkillPath = path.join(root, 'skills', 'beta', 'SKILL.md');
			fs.writeFileSync(
				configPath,
				[
					'[[skills.config]]',
					`path = '${existingSkillPath}'`,
					'enabled = true',
					'',
					'[projects."C:\\\\workspace"]',
					'trust_level = "trusted"',
					'',
				].join('\n'),
				'utf8',
			);

			setSkillEnabled(configPath, nextSkillPath, false);

			const contents = fs.readFileSync(configPath, 'utf8');
			const existingIndex = contents.indexOf(existingSkillPath);
			const nextIndex = contents.indexOf(nextSkillPath);
			const projectIndex = contents.indexOf('[projects."C:\\\\workspace"]');
			assert.ok(existingIndex >= 0);
			assert.ok(nextIndex > existingIndex);
			assert.ok(projectIndex > nextIndex);
		});
	});

	test('setSkillEnabled updates existing enabled value and preserves comments', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const skillPath = path.join(root, 'skills', 'reviewer', 'SKILL.md');
			fs.writeFileSync(
				configPath,
				`[[skills.config]]\npath = '${skillPath}'\nenabled = false # keep\n`,
				'utf8',
			);

			setSkillEnabled(configPath, skillPath, true);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(contents.includes('enabled = true # keep'));
		});
	});
});
