import fs from 'fs';
import path from 'path';
import {
	readAgentTomlDescription,
	toAgentConfigFilePath,
	upsertAgentConfigMetadata,
} from './agentConfigService';
import { AgentLocation, getAgentLocations } from './agentLocations';
import {
	getDisabledAgentEntry,
	getDisabledAgentsStorePath,
} from './disabledAgentsStore';

/**
 * Rebuilds config.toml agent metadata from actual agent files.
 * Existing blocks are preserved where possible, but description/config_file
 * are corrected to match the file contents and actual file path.
 */
export function repairAgentConfigEntries(
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): { contents: string; changed: boolean } {
	const original = fs.existsSync(configPath)
		? fs.readFileSync(configPath, 'utf8')
		: '';
	return repairAgentConfigContents(original, configPath, locations);
}

export function repairAgentConfigContents(
	contents: string,
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): { contents: string; changed: boolean } {
	const seenAgentIds = new Set<string>();
	let nextContents = contents;
	const storePath = getDisabledAgentsStorePath(path.dirname(configPath));

	for (const location of locations) {
		if (!fs.existsSync(location.rootPath)) {
			continue;
		}
		const agentFiles = fs.readdirSync(location.rootPath, { withFileTypes: true })
			.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.toml')
			.map((entry) => path.join(location.rootPath, entry.name))
			.sort((left, right) =>
				path.basename(left).localeCompare(path.basename(right), undefined, {
					numeric: true,
					sensitivity: 'base',
				}),
			);

		for (const agentFilePath of agentFiles) {
			const agentId = path.basename(agentFilePath, path.extname(agentFilePath));
			if (seenAgentIds.has(agentId)) {
				continue;
			}
			if (getDisabledAgentEntry(storePath, agentId)?.source === 'config.toml') {
				continue;
			}
			seenAgentIds.add(agentId);
			nextContents = upsertAgentConfigMetadata(
				nextContents,
				agentId,
				readAgentTomlDescription(agentFilePath),
				toAgentConfigFilePath(configPath, agentFilePath),
			);
		}
	}

	return {
		contents: nextContents,
		changed: nextContents !== contents,
	};
}
