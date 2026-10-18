import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { resolveCodexPaths } from './workspaceStatus';

export type AgentLocationKind = 'project' | 'workspace' | 'user' | 'plugin';

export type AgentLocation = {
	kind: AgentLocationKind;
	label: string;
	rootPath: string;
	createPath?: string;
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
		const preferredProjectRoot = path.join(projectRoot, '.codex', 'agents');
		const legacyProjectRoot = path.join(projectRoot, '.agents', 'agents');
		locations.push({
			kind: 'project',
			label: 'Project Agents',
			rootPath: fs.existsSync(preferredProjectRoot)
				? preferredProjectRoot
				: fs.existsSync(legacyProjectRoot)
					? legacyProjectRoot
					: preferredProjectRoot,
			createPath: preferredProjectRoot,
			priority: 1,
		});
	}
	const workspaceRoot = path.join(resolveCodexPaths(homeDir).codexDir, 'agents');
	locations.push({
		kind: 'workspace',
		label: 'Workspace Agents',
		rootPath: workspaceRoot,
		createPath: workspaceRoot,
		priority: 2,
	});
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

/** CLI 0.163.0 scans agents beside each loaded config layer, never the legacy .agents root. */
export function getCliAgentLocations(
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): AgentLocation[] {
	const roots = new Map<string, AgentLocation>();
	const workspace = locations.find((location) => location.kind === 'workspace');
	const rootPath = path.resolve(path.dirname(configPath), 'agents');
	roots.set(rootPath, { kind: 'workspace', label: workspace?.label ?? 'Workspace Agents', rootPath, priority: 2 });
	for (const location of locations.filter((item) => item.kind === 'project')) {
		const projectPath = path.resolve(location.createPath ?? location.rootPath);
		// Legacy fallback remains available to Explorer, but is not a CLI discovery root.
		if (path.basename(path.dirname(projectPath)) !== '.codex') { continue; }
		roots.set(projectPath, { ...location, rootPath: projectPath });
	}
	return [...roots.values()];
}
