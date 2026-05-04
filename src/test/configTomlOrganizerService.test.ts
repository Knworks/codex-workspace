import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	getConfigTomlBackupPath,
	organizeConfigToml,
	organizeConfigTomlContents,
} from '../services/configTomlOrganizerService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-organize-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Config TOML organizer service', () => {
	test('organizeConfigTomlContents groups projects and skills at their first occurrence', () => {
		const contents = [
			'# header',
			'[projects."C:\\\\alpha"]',
			'trust_level = "trusted"',
			'',
			'[[skills.config]]',
			'path = \'C:\\\\skills\\\\a\\\\SKILL.md\'',
			'enabled = true',
			'',
			'[projects."C:\\\\beta"]',
			'trust_level = "trusted"',
			'',
			'[[skills.config]]',
			'path = \'C:\\\\skills\\\\b\\\\SKILL.md\'',
			'enabled = false',
			'',
		].join('\n');

		const organized = organizeConfigTomlContents(contents);
		const projectAlphaIndex = organized.indexOf('[projects."C:\\\\alpha"]');
		const projectBetaIndex = organized.indexOf('[projects."C:\\\\beta"]');
		const skillAIndex = organized.indexOf("[[skills.config]]\npath = 'C:\\\\skills\\\\a\\\\SKILL.md'");
		const skillBIndex = organized.indexOf("[[skills.config]]\npath = 'C:\\\\skills\\\\b\\\\SKILL.md'");

		assert.ok(projectAlphaIndex >= 0);
		assert.ok(projectBetaIndex > projectAlphaIndex);
		assert.ok(skillAIndex > projectBetaIndex);
		assert.ok(skillBIndex > skillAIndex);
		const betweenProjectsAndSkills = organized.slice(projectBetaIndex, skillAIndex);
		assert.ok(!betweenProjectsAndSkills.includes('[[skills.config]]\npath = \'C:\\\\skills\\\\a\\\\SKILL.md\''));
	});

	test('organizeConfigTomlContents keeps a single blank line between skills blocks', () => {
		const contents = [
			'[[skills.config]]',
			'path = \'C:\\\\skills\\\\a\\\\SKILL.md\'',
			'enabled = true',
			'',
			'[projects."C:\\\\beta"]',
			'trust_level = "trusted"',
			'',
			'[[skills.config]]',
			'path = \'C:\\\\skills\\\\b\\\\SKILL.md\'',
			'enabled = false',
			'',
		].join('\n');

		const organized = organizeConfigTomlContents(contents);
		assert.ok(
			organized.includes(
				"enabled = true\n\n[[skills.config]]\npath = 'C:\\\\skills\\\\b\\\\SKILL.md'",
			),
		);
		assert.ok(
			!organized.includes(
				"enabled = true\n\n\n[[skills.config]]\npath = 'C:\\\\skills\\\\b\\\\SKILL.md'",
			),
		);
	});

	test('organizeConfigTomlContents keeps mcp env blocks directly after their parent', () => {
		const contents = [
			'[mcp_servers.alpha]',
			'command = "a"',
			'',
			'[mcp_servers.beta]',
			'command = "b"',
			'',
			'[mcp_servers.alpha.env]',
			'FOO = "x"',
			'',
			'[mcp_servers.beta.env]',
			'BAR = "y"',
			'',
		].join('\n');

		const organized = organizeConfigTomlContents(contents);
		const alphaParent = organized.indexOf('[mcp_servers.alpha]');
		const alphaEnv = organized.indexOf('[mcp_servers.alpha.env]');
		const betaParent = organized.indexOf('[mcp_servers.beta]');
		const betaEnv = organized.indexOf('[mcp_servers.beta.env]');

		assert.ok(alphaEnv > alphaParent);
		assert.ok(betaParent > alphaEnv);
		assert.ok(betaEnv > betaParent);
	});

	test('organizeConfigToml creates a single backup file and rewrites the config', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, '.codex');
			fs.mkdirSync(codexDir, { recursive: true });
			const configPath = path.join(codexDir, 'config.toml');
			const initialContents = [
				'[projects."C:\\\\alpha"]',
				'trust_level = "trusted"',
				'',
				'[[skills.config]]',
				'path = \'C:\\\\skills\\\\a\\\\SKILL.md\'',
				'enabled = true',
				'',
				'[projects."C:\\\\beta"]',
				'trust_level = "trusted"',
				'',
			].join('\n');
			fs.writeFileSync(configPath, initialContents, 'utf8');

			const result = organizeConfigToml(configPath);
			const backupPath = getConfigTomlBackupPath(configPath);

			assert.strictEqual(result.backupPath, backupPath);
			assert.strictEqual(fs.readFileSync(backupPath, 'utf8'), initialContents);
			assert.strictEqual(result.changed, true);

			const secondContents = fs.readFileSync(configPath, 'utf8');
			fs.writeFileSync(configPath, `${secondContents}\n# second run\n`, 'utf8');
			organizeConfigToml(configPath);
			assert.strictEqual(
				fs.readFileSync(backupPath, 'utf8'),
				`${secondContents}\n# second run\n`,
			);
		});
	});
});
