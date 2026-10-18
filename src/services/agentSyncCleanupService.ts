import * as fs from 'fs';
import * as path from 'path';
import {
	appendAgentConfigBlock,
	appendAgentConfigRawBlock,
	extractAgentConfigBlock,
	listConfiguredAgentIds,
} from './agentConfigService';
import { repairAgentConfigContents } from './agentConfigRepairService';
import {
	getDisabledAgentEntry,
	getDisabledAgentsStorePath,
	listDisabledAgentIds,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from './disabledAgentsStore';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';
import { removeSyncStateEntry } from './syncService';
import { parseAgentRoleDeclarations, pruneMissingAgentBackups, sameAgentPath } from './agentManagerService';

export type AgentSyncReconcileResult = {
	addedAgentIds: string[];
	removedAgentIds: string[];
};

/**
 * Reconciles config/sync metadata after Agent sync.
 * - Removes config+metadata for deleted agent files.
 * - Adds minimal config block for newly added agent files.
 */
export function reconcileAgentConfigAfterSync(
	codexDir: string,
	configPath: string,
	existingAgentIdsBeforeSync: Set<string>,
): AgentSyncReconcileResult {
	const agentsDir = path.join(codexDir, 'agents');
	const storePath = getDisabledAgentsStorePath(codexDir);
	const existingAgentIds = listExistingAgentIds(agentsDir);
	let configContents = fs.readFileSync(configPath, 'utf8');
	let configuredAgentIds = new Set(listConfiguredAgentIds(configContents));
	const removedAgentIds: string[] = [];
	const removedFileNames = new Map<string, string>();
	const addedAgentIds: string[] = [];
	const restoredAgentIds: string[] = [];

	const declaredRoles = parseAgentRoleDeclarations(configContents);
	const referencedFiles = new Set(declaredRoles.filter((role) => role.configFile).map((role) => path.resolve(path.dirname(configPath), role.configFile)));
	for (const role of declaredRoles) {
		if (!role.configFile) { continue; }
		const referencedPath = path.resolve(path.dirname(configPath), role.configFile);
		// Sync owns this directory, not inline roles or files registered elsewhere.
		if (!sameAgentPath(path.dirname(referencedPath), agentsDir) || fs.existsSync(referencedPath)) {
			continue;
		}
		const agentId = role.name;
		const extracted = extractAgentConfigBlock(configContents, agentId);
		if (!extracted.removed) {
			continue;
		}
		configContents = extracted.contents;
		removedAgentIds.push(agentId);
		removedFileNames.set(agentId, path.basename(referencedPath));
		if (extracted.block) {
			saveDisabledAgentBlock(
				storePath,
				agentId,
				extracted.block,
				undefined,
				'sync-reconcile',
			);
		}
	}

	configuredAgentIds = new Set(listConfiguredAgentIds(configContents));
	for (const agentId of existingAgentIds) {
		if (existingAgentIdsBeforeSync.has(agentId) || configuredAgentIds.has(agentId)
			|| [...referencedFiles].some((file) => sameAgentPath(file, path.join(agentsDir, `${agentId}.toml`)))) {
			continue;
		}
		const stashedBlock = getDisabledAgentEntry(storePath, agentId);
		if (stashedBlock) {
			configContents = appendAgentConfigRawBlock(configContents, stashedBlock.block);
			configuredAgentIds.add(agentId);
			addedAgentIds.push(agentId);
			restoredAgentIds.push(agentId);
			continue;
		}
		const appended = appendAgentConfigBlock(configContents, agentId, '');
		if (!appended.appended) {
			continue;
		}
		configContents = appended.contents;
		configuredAgentIds.add(agentId);
		addedAgentIds.push(agentId);
	}

	if (removedAgentIds.length > 0 || addedAgentIds.length > 0) {
		configContents = stabilizeManagedConfigToml(configContents);
	}

	const repaired = repairAgentConfigContents(configContents, configPath);
	if (repaired.changed) {
		configContents = repaired.contents;
	}

	if (removedAgentIds.length > 0 || addedAgentIds.length > 0 || repaired.changed) {
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(configContents),
			'utf8',
		);
	}

	for (const agentId of restoredAgentIds) { takeDisabledAgentBlock(storePath, agentId); }
	const staleDisabled = listDisabledAgentIds(storePath).flatMap((agentId) => {
		const entry = getDisabledAgentEntry(storePath, agentId);
		const role = parseAgentRoleDeclarations(entry?.block ?? '').find((item) => item.name === agentId);
		if (!role?.configFile) { return []; }
		const file = path.resolve(path.dirname(configPath), role.configFile);
		return fs.existsSync(file) ? [] : [{ agentId, file }];
	});
	for (const agentId of removedAgentIds) {
		removeSyncStateEntry(codexDir, 'agents', removedFileNames.get(agentId)!);
	}

	for (const { agentId, file } of staleDisabled) {
		// Remove stale disabled stash and sync metadata for deleted agents.
		takeDisabledAgentBlock(storePath, agentId);
		if (sameAgentPath(path.dirname(file), agentsDir)) { removeSyncStateEntry(codexDir, 'agents', path.basename(file)); }
	}
	pruneMissingAgentBackups(configPath);

	return { addedAgentIds, removedAgentIds };
}

function listExistingAgentIds(agentsDir: string): Set<string> {
	if (!fs.existsSync(agentsDir)) {
		return new Set<string>();
	}
	const ids = fs
		.readdirSync(agentsDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.toml')
		.map((entry) => path.basename(entry.name, path.extname(entry.name)));
	return new Set(ids);
}
