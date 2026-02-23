import * as fs from 'fs';
import * as path from 'path';
import {
	appendAgentConfigBlock,
	extractAgentConfigBlock,
	listConfiguredAgentIds,
} from './agentConfigService';
import {
	getDisabledAgentsStorePath,
	listDisabledAgentIds,
	takeDisabledAgentBlock,
} from './disabledAgentsStore';
import { removeSyncStateEntry } from './syncService';

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
	const addedAgentIds: string[] = [];

	for (const agentId of configuredAgentIds) {
		if (existingAgentIds.has(agentId)) {
			continue;
		}
		const extracted = extractAgentConfigBlock(configContents, agentId);
		if (!extracted.removed) {
			continue;
		}
		configContents = extracted.contents;
		removedAgentIds.push(agentId);
	}

	configuredAgentIds = new Set(listConfiguredAgentIds(configContents));
	for (const agentId of existingAgentIds) {
		if (existingAgentIdsBeforeSync.has(agentId) || configuredAgentIds.has(agentId)) {
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
		fs.writeFileSync(configPath, configContents, 'utf8');
	}

	const staleDisabledIds = listDisabledAgentIds(storePath).filter(
		(agentId) => !existingAgentIds.has(agentId),
	);
	const cleanupIds = new Set<string>([...removedAgentIds, ...staleDisabledIds]);
	for (const agentId of cleanupIds) {
		// Remove stale disabled stash and sync metadata for deleted agents.
		takeDisabledAgentBlock(storePath, agentId);
		removeSyncStateEntry(codexDir, 'agents', `${agentId}.toml`);
	}

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
