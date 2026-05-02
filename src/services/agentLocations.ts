import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { resolveCodexPaths } from './workspaceStatus';

export type AgentLocationKind = 'project' | 'workspace' | 'user';

export type AgentLocation = {
	kind: AgentLocationKind;
	label: string;
	rootPath: string;
	priority: number;
};

function getProjectRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getAgentLocations(
	homeDir: string = os.homedir(),
	projectRoot: string | undefined = getProjectRoot(),
): AgentLocation[] {
	const locations: AgentLocation[] = [];
	if (projectRoot) {
		locations.push({
			kind: 'project',
			label: 'Project Agents',
			rootPath: path.join(projectRoot, '.codex', 'agents'),
			priority: 1,
		});
	}
	const workspaceRoot = path.join(resolveCodexPaths(homeDir).codexDir, 'agents');
	locations.push({
		kind: 'workspace',
		label: 'Workspace Agents',
		rootPath: workspaceRoot,
		priority: 2,
	});
	const userRoot = path.join(homeDir, '.codex', 'agents');
	if (path.resolve(userRoot) !== path.resolve(workspaceRoot)) {
		locations.push({
			kind: 'user',
			label: 'User Agents',
			rootPath: userRoot,
			priority: 3,
		});
	}
	return locations;
}

export function findAgentLocationForPath(
	targetPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): AgentLocation | undefined {
	const resolvedTarget = path.resolve(targetPath);
	return locations.find((location) => {
		const resolvedRoot = path.resolve(location.rootPath);
		return (
			resolvedTarget === resolvedRoot ||
			resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
		);
	});
}
