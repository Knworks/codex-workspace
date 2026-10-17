import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { resolveCodexHomeDir } from './codexPaths';

export type SkillLocationKind = 'project' | 'workspace' | 'user' | 'system' | 'plugin';

export type SkillLocation = {
	kind: SkillLocationKind;
	label: string;
	rootPath: string;
	createPath?: string;
	priority: number;
};

function getProjectRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Resolves additive Skill roots while preserving the Workspace display order.
 */
export function getSkillLocations(
	homeDir: string = os.homedir(),
	projectRoot: string | undefined = getProjectRoot(),
): SkillLocation[] {
	const codexHome = resolveCodexHomeDir(homeDir);
	const locations: SkillLocation[] = [];
	if (projectRoot) {
		locations.push(...getProjectSkillLocations(projectRoot));
	}
	locations.push(
		{
			kind: 'workspace',
			label: 'Workspace Skills',
			rootPath: path.join(codexHome, 'skills'),
			createPath: path.join(codexHome, 'skills'),
			priority: 2,
		},
		{
			kind: 'user',
			label: 'User Skills',
			rootPath: path.join(homeDir, '.agents', 'skills'),
			createPath: path.join(homeDir, '.agents', 'skills'),
			priority: 3,
		},
		{
			kind: 'system',
			label: 'System Skills',
			rootPath: path.join(codexHome, 'skills', '.system'),
			priority: 4,
		},
	);
	const seenRoots = new Set<string>();
	// Keep the host scope when a project root is also a user storage root.
	return locations.reverse().filter((location) => {
		const rootPath = path.resolve(location.rootPath);
		if (seenRoots.has(rootPath)) {
			return false;
		}
		seenRoots.add(rootPath);
		return true;
	}).reverse();
}

function getProjectSkillLocations(projectRoot: string): SkillLocation[] {
	const directories = getDirectoryChainToRepoRoot(projectRoot);
	return directories.flatMap((directory, index): SkillLocation[] => {
		const label = index === 0
			? 'Project Skills'
			: `Project Skills (${path.basename(directory)})`;
		const agentsRoot = path.join(directory, '.agents', 'skills');
		return [
			{
				kind: 'project',
				label,
				rootPath: agentsRoot,
				createPath: agentsRoot,
				priority: index + 1,
			},
			{
				kind: 'project',
				label: `${label} (.codex)`,
				rootPath: path.join(directory, '.codex', 'skills'),
				priority: index + 1,
			},
		];
	});
}

function getDirectoryChainToRepoRoot(startPath: string): string[] {
	const resolvedStartPath = path.resolve(startPath);
	const repoRoot = findRepoRoot(resolvedStartPath);
	const directories: string[] = [];
	let current = resolvedStartPath;

	while (true) {
		directories.push(current);
		if (current === repoRoot) {
			break;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return directories;
}

function findRepoRoot(startPath: string): string {
	let current = path.resolve(startPath);
	while (true) {
		const gitPath = path.join(current, '.git');
		if (fs.existsSync(gitPath)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return path.resolve(startPath);
		}
		current = parent;
	}
}

export function findSkillLocationForPath(
	targetPath: string,
	locations: SkillLocation[] = getSkillLocations(),
): SkillLocation | undefined {
	const resolvedTarget = path.resolve(targetPath);
	return locations.find((location) => {
		const resolvedRoot = path.resolve(location.rootPath);
		return (
			resolvedTarget === resolvedRoot ||
			resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
		);
	});
}
