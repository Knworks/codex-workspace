import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	addTrustedDirectory,
	buildAgentsLoadingChain,
	listTrustedDirectories,
	removeTrustedDirectory,
} from '../services/coreDiagnosticsService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-diag-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

suite('Core diagnostics service', () => {
	test('buildAgentsLoadingChain marks higher priority project override active', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const codexDir = path.join(homeDir, '.codex');
			const repoRoot = path.join(root, 'workspace');
			const workspaceRoot = path.join(repoRoot, 'packages', 'feature');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(workspaceRoot, { recursive: true });
			fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'config.toml'), 'project_doc_fallback_filenames = ["GUIDE.md"]', 'utf8');
			fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'root standard', 'utf8');
			fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.override.md'), 'override', 'utf8');
			fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'standard', 'utf8');

			const nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);

			const rootStandard = nodes.find((node) => node.absolutePath === path.join(repoRoot, 'AGENTS.md'));
			const override = nodes.find((node) => node.absolutePath === path.join(workspaceRoot, 'AGENTS.override.md'));
			const standard = nodes.find((node) => node.absolutePath === path.join(workspaceRoot, 'AGENTS.md'));
			const fallback = nodes.find((node) => node.fileName === 'GUIDE.md');
			assert.strictEqual(rootStandard?.status, 'Active');
			assert.strictEqual(override?.status, 'Active');
			assert.strictEqual(standard?.status, 'Skipped');
			assert.strictEqual(fallback?.status, 'Missing');
		});
	});

	test('buildAgentsLoadingChain marks deleted standard project file as missing', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const codexDir = path.join(homeDir, '.codex');
			const repoRoot = path.join(root, 'workspace');
			const workspaceRoot = path.join(repoRoot, 'packages', 'feature');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(workspaceRoot, { recursive: true });
			fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'config.toml'), '', 'utf8');
			const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
			fs.writeFileSync(agentsPath, 'standard', 'utf8');

			let nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);
			let standard = nodes.find((node) => node.absolutePath === agentsPath);
			assert.strictEqual(standard?.status, 'Active');
			assert.strictEqual(standard?.contentPreview, 'standard');

			fs.rmSync(agentsPath);
			nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);
			standard = nodes.find((node) => node.absolutePath === agentsPath);
			assert.strictEqual(standard?.status, 'Missing');
			assert.strictEqual(standard?.contentPreview, undefined);
		});
	});

	test('trusted directories can be listed added and removed', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const projectPath = path.join(root, 'project');
			fs.mkdirSync(projectPath, { recursive: true });

			addTrustedDirectory(configPath, projectPath);
			let trusted = listTrustedDirectories(configPath);
			assert.strictEqual(trusted.length, 1);
			assert.strictEqual(trusted[0].path, projectPath);
			assert.strictEqual(trusted[0].exists, true);

			assert.strictEqual(removeTrustedDirectory(configPath, projectPath), true);
			trusted = listTrustedDirectories(configPath);
			assert.strictEqual(trusted.length, 0);
		});
	});

	test('addTrustedDirectory keeps project blocks grouped before later skills blocks', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const existingProject = path.join(root, 'project-a');
			const nextProject = path.join(root, 'project-b');
			fs.writeFileSync(
				configPath,
				[
					`[projects."${existingProject.replace(/\\/g, '\\\\')}"]`,
					'trust_level = "trusted"',
					'',
					'[[skills.config]]',
					`path = '${path.join(root, 'skills', 'alpha', 'SKILL.md')}'`,
					'enabled = true',
					'',
				].join('\n'),
				'utf8',
			);

			addTrustedDirectory(configPath, nextProject);

			const contents = fs.readFileSync(configPath, 'utf8');
			const firstProjectIndex = contents.indexOf(existingProject.replace(/\\/g, '\\\\'));
			const secondProjectIndex = contents.indexOf(nextProject.replace(/\\/g, '\\\\'));
			const skillsIndex = contents.indexOf('[[skills.config]]');
			assert.ok(firstProjectIndex >= 0);
			assert.ok(secondProjectIndex > firstProjectIndex);
			assert.ok(skillsIndex > secondProjectIndex);
		});
	});

	test('trusted directories support single-quoted project headers', () => {
		withTempDir((root) => {
			const configPath = path.join(root, 'config.toml');
			const projectPath = '\\\\?\\Z:\\codex-workspace-test\\missing-project';
			fs.writeFileSync(
				configPath,
				[
					`[projects.'${projectPath}']`,
					'trust_level = "trusted"',
				].join('\n'),
				'utf8',
			);

			const trusted = listTrustedDirectories(configPath);
			assert.strictEqual(trusted.length, 1);
			assert.strictEqual(trusted[0].path, projectPath);
			assert.strictEqual(trusted[0].exists, false);
		});
	});
});
