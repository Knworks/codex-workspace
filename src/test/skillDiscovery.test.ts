import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { listSkillRecords, readSkillEnabledByPath, setSkillEnabled } from '../services/skillConfigService';
import { getSkillLocations, SkillLocation } from '../services/skillLocations';
import { FileExplorerProvider } from '../views/fileExplorerProvider';

suite('Skill discovery integration', () => {
	let tempRoot: string;
	let originalCodexHome: string | undefined;

	setup(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-discovery-'));
		originalCodexHome = process.env.CODEX_HOME;
		delete process.env.CODEX_HOME;
	});

	teardown(() => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	function writeSkill(root: string): string {
		const skillPath = path.join(root, 'reviewer', 'SKILL.md');
		fs.mkdirSync(path.dirname(skillPath), { recursive: true });
		fs.writeFileSync(skillPath, '---\nname: reviewer\ndescription: Reviews code\n---\n');
		return skillPath;
	}

	for (const rootNames of [['.agents'], ['.codex'], ['.agents', '.codex']]) {
		test(`lists project skills when ${rootNames.join(' and ')} exists`, () => {
			const projectRoot = path.join(tempRoot, 'repo');
			const expectedPaths = rootNames.map((name) => writeSkill(path.join(projectRoot, name, 'skills')));
			const records = listSkillRecords(
				path.join(tempRoot, 'config.toml'),
				getSkillLocations(path.join(tempRoot, 'home'), projectRoot),
			);
			assert.deepStrictEqual(records.map((record) => record.skillPath), expectedPaths);
			assert.strictEqual(new Set(records.map((record) => record.id)).size, expectedPaths.length);
		});
	}

	test('Manager and Explorer preserve same-name skills across project ancestors and user roots', () => {
		const homeDir = path.join(tempRoot, 'home');
		const codexHome = path.join(tempRoot, 'custom-codex');
		const repoRoot = path.join(tempRoot, 'repo');
		const projectRoot = path.join(repoRoot, 'feature');
		process.env.CODEX_HOME = codexHome;
		fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
		const expectedPaths = [
			path.join(projectRoot, '.agents', 'skills'),
			path.join(projectRoot, '.codex', 'skills'),
			path.join(repoRoot, '.agents', 'skills'),
			path.join(repoRoot, '.codex', 'skills'),
			path.join(codexHome, 'skills'),
			path.join(homeDir, '.agents', 'skills'),
			path.join(codexHome, 'skills', '.system'),
		].map(writeSkill);
		// The old default home must not be added when CODEX_HOME is overridden.
		writeSkill(path.join(homeDir, '.codex', 'skills'));
		const configPath = path.join(codexHome, 'config.toml');
		fs.writeFileSync(configPath, 'model = "gpt"\n');
		const locations = getSkillLocations(homeDir, projectRoot);
		const disabledPath = expectedPaths[1];
		setSkillEnabled(configPath, disabledPath, false);
		const records = listSkillRecords(configPath, locations);
		assert.deepStrictEqual(records.map((record) => record.skillPath), expectedPaths);
		assert.ok(records.every((record) => record.name === 'reviewer'));
		assert.strictEqual(new Set(records.map((record) => record.id)).size, expectedPaths.length);
		assert.deepStrictEqual(records.filter((record) => !record.enabled).map((record) => record.skillPath), [disabledPath]);

		class TestSkillsProvider extends FileExplorerProvider {
			override getRootOptions(): SkillLocation[] {
				return locations;
			}
		}
		const context = { asAbsolutePath: (target: string) => path.join(tempRoot, target) } as vscode.ExtensionContext;
		const provider = new TestSkillsProvider(
			'skills', context, () => ({ isAvailable: true }), undefined, undefined,
			() => readSkillEnabledByPath(configPath),
		);
		const roots = provider.getChildren() as CodexTreeItem[];
		assert.deepStrictEqual(roots.map((item) => item.fsPath), expectedPaths.map((skillPath) => path.dirname(skillPath)));
		assert.strictEqual(new Set(roots.map((item) => item.id)).size, expectedPaths.length);
		for (const [index, root] of roots.entries()) {
			assert.strictEqual(provider.getParent(root), undefined);
			const children = provider.getChildren(root) as CodexTreeItem[];
			assert.strictEqual(children.length, 1);
			const file = children[0];
			assert.strictEqual(file.fsPath, expectedPaths[index]);
			assert.strictEqual(file.command?.command, 'codex-workspace.openFile');
			assert.deepStrictEqual(file.command?.arguments, [file]);
			assert.ok(String(file.tooltip).includes(expectedPaths[index]));
			assert.strictEqual((file.iconPath as vscode.ThemeIcon).id, index === 1 ? 'circle-slash' : 'agent');
			assert.strictEqual((root.iconPath as vscode.ThemeIcon).id, index === 1 ? 'circle-slash' : 'folder-library');
		}

		setSkillEnabled(configPath, disabledPath, true);
		assert.ok(listSkillRecords(configPath, locations).every((record) => record.enabled));
		assert.ok(!fs.readFileSync(configPath, 'utf8').includes('[[skills.config]]'));
		const enabledFile = (provider.getChildren(roots[1]) as CodexTreeItem[])[0];
		assert.strictEqual((enabledFile.iconPath as vscode.ThemeIcon).id, 'agent');
	});
});
