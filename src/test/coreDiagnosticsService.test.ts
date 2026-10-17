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
	for (const markers of ['["ROOT"]', '["OTHER", "ROOT"]']) {
		test(`custom markers ${markers} replace .git and include nested workspace tiers`, () => {
			withTempDir((root) => {
				const homeDir = path.join(root, 'home');
				const codexDir = path.join(homeDir, '.codex');
				const projectRoot = path.join(root, 'project');
				const nested = path.join(projectRoot, 'packages');
				const workspaceRoot = path.join(nested, 'feature');
				fs.mkdirSync(codexDir, { recursive: true });
				fs.mkdirSync(workspaceRoot, { recursive: true });
				fs.writeFileSync(path.join(projectRoot, 'ROOT'), 'marker');
				fs.mkdirSync(path.join(nested, '.git'));
				fs.writeFileSync(path.join(codexDir, 'config.toml'), `project_root_markers = ${markers}`);
				for (const directory of [root, projectRoot, nested, workspaceRoot]) {
					fs.writeFileSync(path.join(directory, 'AGENTS.md'), directory);
				}
				const activePaths = buildAgentsLoadingChain(workspaceRoot, homeDir)
					.filter((node) => node.kind === 'Project' && node.status === 'Active')
					.map((node) => node.absolutePath);
				assert.deepStrictEqual(activePaths, [projectRoot, nested, workspaceRoot].map((dir) => path.join(dir, 'AGENTS.md')));
			});
		});
	}

	test('multiple markers select the nearest ancestor regardless of configured marker order', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, 'home', '.codex');
			const nested = path.join(root, 'project', 'nested');
			const workspaceRoot = path.join(nested, 'feature');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(workspaceRoot, { recursive: true });
			fs.mkdirSync(path.join(root, 'project', 'OUTER'));
			fs.writeFileSync(path.join(nested, 'INNER'), 'marker');
			fs.writeFileSync(path.join(codexDir, 'config.toml'), 'project_root_markers = ["OUTER", "INNER"]');
			const projectDirs = [...new Set(buildAgentsLoadingChain(workspaceRoot, path.join(root, 'home'))
				.filter((node) => node.kind === 'Project').map((node) => path.dirname(node.absolutePath)))];
			assert.deepStrictEqual(projectDirs, [nested, workspaceRoot]);
		});
	});

	for (const config of ['project_root_markers = []', 'project_root_markers = ["ABSENT"]']) {
		test(`${config} restricts discovery to workspace root`, () => {
			withTempDir((root) => {
				const codexDir = path.join(root, 'home', '.codex');
				const workspaceRoot = path.join(root, 'project', 'nested');
				fs.mkdirSync(codexDir, { recursive: true });
				fs.mkdirSync(workspaceRoot, { recursive: true });
				fs.mkdirSync(path.join(root, 'project', '.git'));
				fs.writeFileSync(path.join(codexDir, 'config.toml'), config);
				const nodes = buildAgentsLoadingChain(workspaceRoot, path.join(root, 'home')).filter((node) => node.kind === 'Project');
				assert.strictEqual(nodes.length, 2);
				assert.ok(nodes.every((node) => path.dirname(node.absolutePath) === workspaceRoot));
			});
		});
	}

	for (const config of [undefined, 'invalid = [', 'project_root_markers = [42]']) {
		test(`missing or invalid config (${config}) retains default .git discovery`, () => {
			withTempDir((root) => {
				const homeDir = path.join(root, 'home');
				const codexDir = path.join(homeDir, '.codex');
				const repoRoot = path.join(root, 'project');
				const workspaceRoot = path.join(repoRoot, 'nested');
				fs.mkdirSync(codexDir, { recursive: true });
				fs.mkdirSync(workspaceRoot, { recursive: true });
				fs.writeFileSync(path.join(repoRoot, '.git'), 'gitdir: elsewhere');
				if (config !== undefined) {
					fs.writeFileSync(path.join(codexDir, 'config.toml'), config);
				}
				const nodes = buildAgentsLoadingChain(workspaceRoot, homeDir).filter((node) => node.kind === 'Project');
				assert.deepStrictEqual([...new Set(nodes.map((node) => path.dirname(node.absolutePath)))], [repoRoot, workspaceRoot]);
			});
		});
	}

	test('fallback filenames are normalized, deduplicated and selected in configuration order', () => {
		withTempDir((root) => {
			const homeDir = path.join(root, 'home');
			const codexDir = path.join(homeDir, '.codex');
			const workspaceRoot = path.join(root, 'project');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(workspaceRoot);
			const names = [' ', ' GUIDE.md ', 'GUIDE.md', 'SECOND.md', 'AGENTS.md', 'AGENTS.override.md', '.', '..', '../outside.md', 'sub/file.md', 'bad\0name'];
			if (process.platform === 'win32') {
				names.push('sub\\file.md', 'C:outside.md', '\\\\server\\share');
			}
			fs.writeFileSync(path.join(codexDir, 'config.toml'), `project_doc_fallback_filenames = ${JSON.stringify(names)}`);
			fs.writeFileSync(path.join(workspaceRoot, 'GUIDE.md'), 'first');
			fs.writeFileSync(path.join(workspaceRoot, 'SECOND.md'), 'second');
			fs.writeFileSync(path.join(codexDir, 'GUIDE.md'), 'global fallback must not be selected');
			const nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);
			const projectNodes = nodes.filter((node) => node.kind === 'Project');
			assert.deepStrictEqual(projectNodes.map((node) => node.fileName), ['AGENTS.override.md', 'AGENTS.md', 'GUIDE.md', 'SECOND.md']);
			assert.strictEqual(projectNodes[2].status, 'Active');
			assert.strictEqual(projectNodes[2].type, 'Fallback');
			assert.strictEqual(projectNodes[3].status, 'Skipped');
			assert.ok(nodes.filter((node) => node.kind === 'Global').every((node) => node.type !== 'Fallback'));
			fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'standard');
			assert.strictEqual(buildAgentsLoadingChain(workspaceRoot, homeDir).find((node) => node.kind === 'Project' && node.fileName === 'GUIDE.md')?.status, 'Skipped');
		});
	});

	test('a directory named AGENTS.md does not prevent a fallback file from being selected', () => {
		withTempDir((root) => {
			const codexDir = path.join(root, 'home', '.codex');
			const workspaceRoot = path.join(root, 'project');
			fs.mkdirSync(codexDir, { recursive: true });
			fs.mkdirSync(path.join(workspaceRoot, 'AGENTS.md'), { recursive: true });
			fs.writeFileSync(path.join(codexDir, 'config.toml'), 'project_doc_fallback_filenames = ["GUIDE.md"]');
			fs.writeFileSync(path.join(workspaceRoot, 'GUIDE.md'), 'fallback');
			const nodes = buildAgentsLoadingChain(workspaceRoot, path.join(root, 'home'));
			assert.strictEqual(nodes.find((node) => node.kind === 'Project' && node.fileName === 'AGENTS.md')?.status, 'Skipped');
			assert.strictEqual(nodes.find((node) => node.kind === 'Project' && node.fileName === 'GUIDE.md')?.status, 'Active');
		});
	});

	test('loading chain reads base settings from the shared CODEX_HOME resolver only', () => {
		withTempDir((root) => {
			const originalCodexHome = process.env.CODEX_HOME;
			try {
				const homeDir = path.join(root, 'home');
				const codexDir = path.join(root, 'custom-home');
				const projectRoot = path.join(root, 'project');
				const workspaceRoot = path.join(projectRoot, 'nested');
				fs.mkdirSync(codexDir);
				fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
				fs.mkdirSync(path.join(workspaceRoot, '.codex'), { recursive: true });
				fs.writeFileSync(path.join(projectRoot, 'ROOT'), 'marker');
				fs.writeFileSync(path.join(codexDir, 'config.toml'), 'project_root_markers = ["ROOT"]\nproject_doc_fallback_filenames = ["GUIDE.md"]');
				fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), 'project_root_markers = []');
				fs.writeFileSync(path.join(workspaceRoot, '.codex', 'config.toml'), 'project_root_markers = []');
				fs.writeFileSync(path.join(codexDir, 'selected.config.toml'), 'project_root_markers = []');
				fs.writeFileSync(path.join(projectRoot, 'GUIDE.md'), 'root fallback');
				process.env.CODEX_HOME = codexDir;
				const nodes = buildAgentsLoadingChain(workspaceRoot, homeDir);
				assert.ok(nodes.filter((node) => node.kind === 'Global').every((node) => path.dirname(node.absolutePath) === codexDir));
				assert.strictEqual(nodes.find((node) => node.absolutePath === path.join(projectRoot, 'GUIDE.md'))?.status, 'Active');
			} finally {
				if (originalCodexHome === undefined) {
					delete process.env.CODEX_HOME;
				} else {
					process.env.CODEX_HOME = originalCodexHome;
				}
			}
		});
	});

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
