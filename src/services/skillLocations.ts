import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { resolveCodexPaths } from './workspaceStatus';

export type SkillLocationKind = 'project' | 'workspace' | 'user';

export type SkillLocation = {
	kind: SkillLocationKind;
	label: string;
	rootPath: string;
	priority: number;
};

function getProjectRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Resolves Skill storage locations in Codex CLI precedence order.
 */
export function getSkillLocations(
	homeDir: string = os.homedir(),
	projectRoot: string | undefined = getProjectRoot(),
): SkillLocation[] {
	const locations: SkillLocation[] = [];
	if (projectRoot) {
		locations.push({
			kind: 'project',
			label: 'Project Skills',
			rootPath: path.join(projectRoot, '.codex', 'skills'),
			priority: 1,
		});
	}
	locations.push(
		{
			kind: 'workspace',
			label: 'Workspace Skills',
			rootPath: path.join(resolveCodexPaths(homeDir).codexDir, 'skills'),
			priority: 2,
		},
		{
			kind: 'user',
			label: 'User Skills',
			rootPath: path.join(homeDir, '.agents', 'skills'),
			priority: 3,
		},
	);
	return locations;
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
