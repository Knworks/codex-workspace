import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as toml from 'toml';
import {
	listSkillRecords,
	readSkillEnabledByPath,
	readSkillMetadata,
	setSkillEnabled,
} from '../services/skillConfigService';
import { SkillLocation } from '../services/skillLocations';

type SkillConfigFixture = {
	skills: { config: Array<{ path: string; enabled?: boolean }> };
	model?: string;
};

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-config-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Skill config service', () => {
	const pathFixtures = [
		{ name: 'apostrophes', value: "C:\\Users\\O'Brien\\skills\\SKILL.md" },
		{ name: 'backslashes', value: 'C:\\Users\\new\\test\\SKILL.md' },
		{ name: 'Japanese and spaces', value: 'C:\\作業 フォルダ\\スキル\\SKILL.md' },
		{ name: 'double quotes', value: '/skills/"reviewer"/SKILL.md' },
		{ name: 'mixed quotes and comment markers', value: "C:\\O'Brien\\\"reviewer\" #1\\SKILL.md" },
		{ name: 'control characters', value: '/skills/line\n\r\t\b\f\u0001\u007f/SKILL.md' },
	];

	// These are serialization fixtures; some characters cannot be used in Windows filenames.
	for (const fixture of pathFixtures) {
		test(`setSkillEnabled round-trips ${fixture.name} without duplicate blocks`, () => {
			withTempDir((root) => {
				const configPath = path.join(root, 'config.toml');
				const skillPath = fixture.value;
				fs.writeFileSync(configPath, 'model = "gpt"\n', 'utf8');

				for (let cycle = 0; cycle < 2; cycle += 1) {
					setSkillEnabled(configPath, skillPath, false);
					setSkillEnabled(configPath, skillPath, false);
					const disabled = toml.parse(fs.readFileSync(configPath, 'utf8')) as SkillConfigFixture;
					assert.deepStrictEqual(disabled.skills.config.map((entry) => entry.path), [skillPath]);
					assert.strictEqual(disabled.skills.config[0].enabled, false);
					assert.strictEqual(disabled.model, 'gpt');
					assert.strictEqual(readSkillEnabledByPath(configPath).get(path.resolve(skillPath)), false);

					setSkillEnabled(configPath, skillPath, true);
					const enabled = toml.parse(fs.readFileSync(configPath, 'utf8'));
					assert.deepStrictEqual({ ...enabled }, { model: 'gpt' });
					assert.strictEqual(readSkillEnabledByPath(configPath).has(path.resolve(skillPath)), false);
				}
			});
		});
	}

	test('listSkillRecords toggles an actual skill in an apostrophe directory', () => {
		withTempDir((root) => {
			const skillDir = path.join(root, "O'Brien 日本語", 'skills', 'reviewer');
			fs.mkdirSync(skillDir, { recursive: true });
			const skillPath = path.join(skillDir, 'SKILL.md');
			fs.writeFileSync(skillPath, '---\nname: reviewer\ndescription: Reviews code\n---\n', 'utf8');
			const configPath = path.join(root, 'config.toml');
			const location: SkillLocation = {
				kind: 'workspace', label: 'Workspace Skills', rootPath: skillDir, priority: 2,
			};

			setSkillEnabled(configPath, skillPath, false);
			const disabled = toml.parse(fs.readFileSync(configPath, 'utf8')) as SkillConfigFixture;
			assert.strictEqual(disabled.skills.config[0].path, skillPath);
			assert.strictEqual(listSkillRecords(configPath, [location])[0].enabled, false);
			setSkillEnabled(configPath, skillPath, true);
			assert.doesNotThrow(() => toml.parse(fs.readFileSync(configPath, 'utf8')));
			assert.strictEqual(listSkillRecords(configPath, [location])[0].enabled, true);
		});
	});

	for (const encodedPath of [
		String.raw`'C:\skills\日本語 # "reviewer"\SKILL.md'`,
		String.raw`"C:\\skills\\O'Brien # \"reviewer\"\\SKILL.md"`,
		String.raw`"C:\\skills\\\u65e5\u672c\u8a9e\\SKILL.md"`,
	]) {
		for (const enabledLine of ['enabled = true # keep', '# enabled is omitted']) {
			test(`setSkillEnabled matches an existing TOML path ${encodedPath} with ${enabledLine}`, () => {
				withTempDir((root) => {
					const configPath = path.join(root, 'config.toml');
					const original = [
						'model = "gpt"',
						'[[skills.config]]',
						`path = ${encodedPath} # comment with "quotes" and 'apostrophes'`,
						enabledLine,
						'[[skills.config]]',
						"path = 'C:\\skills\\other\\SKILL.md'",
						'enabled = false',
						'[projects."/workspace"]',
						'trust_level = "trusted"',
						'',
					].join('\n');
					fs.writeFileSync(configPath, original, 'utf8');
					const before = toml.parse(original) as SkillConfigFixture;
					const skillPath = before.skills.config[0].path;
					assert.strictEqual(readSkillEnabledByPath(configPath).get(path.resolve(skillPath)), true);

					setSkillEnabled(configPath, skillPath, false);
					const disabled = toml.parse(fs.readFileSync(configPath, 'utf8'));
					before.skills.config[0].enabled = false;
					assert.deepStrictEqual(disabled, before);
					assert.strictEqual(readSkillEnabledByPath(configPath).get(path.resolve(skillPath)), false);

					setSkillEnabled(configPath, skillPath, true);
					before.skills.config.shift();
					assert.deepStrictEqual(toml.parse(fs.readFileSync(configPath, 'utf8')), before);
				});
			});
		}
	}

	for (const action of ['append', 'remove', 'update', 'insert enabled'] as const) {
		test(`setSkillEnabled refuses invalid TOML before writing during ${action}`, () => {
			withTempDir((root) => {
				const configPath = path.join(root, 'config.toml');
				const skillPath = path.join(root, 'skills', 'reviewer', 'SKILL.md');
				const original = [
					'model = "unterminated',
					...(action === 'append' ? [] : [
						'[[skills.config]]', `path = '${skillPath}'`,
						...(action === 'insert enabled' ? [] : ['enabled = true']),
					]),
					'',
				].join('\n');
				fs.writeFileSync(configPath, original, 'utf8');

				assert.throws(() => setSkillEnabled(configPath, skillPath, action === 'remove'));
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
			});
		});
	}

	test('setSkillEnabled rejects a generated table conflict without changing a valid source', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const original = 'model = "gpt"\n[skills]\nconfig = "reserved"\n';
			fs.writeFileSync(configPath, original, 'utf8');
			assert.doesNotThrow(() => toml.parse(original));

			assert.throws(() => setSkillEnabled(configPath, path.join(root, 'SKILL.md'), false));
			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
		});
	});

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

	test('setSkillEnabled does not append config block when enabling a missing skill entry', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const skillPath = path.join(root, 'skills', 'reviewer', 'SKILL.md');
			const original = 'model = "gpt"\n';
			fs.writeFileSync(configPath, original, 'utf8');

			setSkillEnabled(configPath, skillPath, true);

			assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
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

	test('setSkillEnabled removes existing skill config block when enabling', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const skillPath = path.join(root, 'skills', 'reviewer', 'SKILL.md');
			fs.writeFileSync(
				configPath,
				[
					`[[skills.config]]`,
					`path = '${skillPath}'`,
					'enabled = false # keep',
					'',
					'[projects."/tmp/workspace"]',
					'trust_level = "trusted"',
					'',
				].join('\n'),
				'utf8',
			);

			setSkillEnabled(configPath, skillPath, true);

			const contents = fs.readFileSync(configPath, 'utf8');
			assert.ok(!contents.includes(`path = '${skillPath}'`));
			assert.ok(!contents.includes('enabled = false # keep'));
			assert.ok(contents.includes('[projects."/tmp/workspace"]'));
		});
	});
});
