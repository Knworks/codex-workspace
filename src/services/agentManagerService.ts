import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { listProfileConfigFilesInDirectory } from './profileConfigService';
import { AgentLocation, getAgentLocations } from './agentLocations';
import {
	appendAgentConfigBlock,
	appendAgentConfigRawBlock,
	extractAgentConfigBlock,
	hasAgentConfigBlock,
	replaceAgentConfigRawBlock,
} from './agentConfigService';
import {
	getDisabledAgentBlock,
	listDisabledAgentIds,
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from './disabledAgentsStore';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';
import { resolveCodexPaths } from './workspaceStatus';

export type AgentManagerRecord = {
	id: string;
	name: string;
	description: string;
	model: string;
	reasoningEffort: string;
	sandboxMode: string;
	agentPath: string;
	configFile: string;
	configPath: string;
	location: AgentLocation;
	enabled: boolean;
	previewContent: string;
};

const INHERITED = '継承';

export function listAgentManagerRecords(
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): AgentManagerRecord[] {
	const baseDir = path.dirname(configPath);
	const workspaceLocation = locations.find((location) => location.kind === 'workspace') ?? {
		kind: 'workspace' as const, label: 'Workspace Agents', rootPath: path.join(baseDir, 'agents'), priority: 2,
	};
	const sources = [
		{ configPath, location: workspaceLocation },
		...listProfileConfigFilesInDirectory(baseDir).map((profile) => ({
			configPath: profile.configPath,
			location: { ...workspaceLocation, label: `Profile: ${profile.name}` },
		})),
		...locations.filter((location) => location.kind === 'project').map((location) => ({
			configPath: path.join(path.dirname(location.createPath ?? location.rootPath), 'config.toml'), location,
		})),
	];
	const seenSources = new Set<string>();
	return sources.flatMap((source) => {
		const sourcePath = path.resolve(source.configPath);
		if (seenSources.has(sourcePath)) { return []; }
		seenSources.add(sourcePath);
		const contents = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
		const roles = parseAgentRoleDeclarations(contents);
		const storePath = getAgentManagerStorePath(sourcePath);
		const disabled = listDisabledAgentIds(storePath);
		const records = roles.map((role) => createRecord(role, sourcePath, source.location, true));
		for (const key of disabled) {
			if (roles.some((role) => role.name === key)) { continue; }
			const block = getDisabledAgentBlock(storePath, key);
			for (const role of parseAgentRoleDeclarations(block ?? '')) {
				records.push(createRecord(role, sourcePath, source.location, false));
			}
		}
		return records;
	});
}

export type AgentRoleDeclaration = { name: string; description: string; configFile: string };

/** Read role keys from TOML tables, independently of role file names. */
export function parseAgentRoleDeclarations(contents: string): AgentRoleDeclaration[] {
	const parsed = toml.parse(contents) as { agents?: Record<string, unknown> };
	return Object.entries(parsed.agents ?? {}).flatMap(([name, value]) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) { return []; }
		const role = value as Record<string, unknown>;
		return [{ name, description: typeof role.description === 'string' ? role.description : '',
			configFile: typeof role.config_file === 'string' ? role.config_file : '' }];
	});
}

function createRecord(role: AgentRoleDeclaration, configPath: string, location: AgentLocation, enabled: boolean): AgentManagerRecord {
	const agentPath = role.configFile ? resolveAgentConfigFile(configPath, role.configFile) : configPath;
	const detail = role.configFile ? readAgentTomlDetails(agentPath) : {};
	return {
		id: JSON.stringify([configPath, role.name]), name: role.name, description: role.description,
		model: detail.model ?? INHERITED, reasoningEffort: detail.model_reasoning_effort ?? INHERITED,
		sandboxMode: detail.sandbox_mode ?? INHERITED, agentPath, configFile: role.configFile,
		configPath, location, enabled, previewContent: detail.developer_instructions?.trim() ?? '',
	};
}

/** Keep the legacy Base store; isolate Profile stores even when sharing a directory. */
function getAgentManagerStorePath(configPath: string): string {
	const storePath = getDisabledAgentsStorePath(path.dirname(configPath));
	return path.basename(configPath) === 'config.toml' ? storePath
		: path.join(path.dirname(storePath), `${path.basename(configPath)}.agents-disabled.json`);
}

export function disableAgentByName(_codexDir: string, configPath: string, agentName: string): void {
	const contents = fs.readFileSync(configPath, 'utf8');
	const extracted = extractAgentConfigBlock(contents, agentName);
	if (!extracted.removed || !extracted.block) {
		return;
	}
	saveDisabledAgentBlock(
		getAgentManagerStorePath(configPath),
		agentName,
		extracted.block,
	);
	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(extracted.contents),
		'utf8',
	);
}

export function enableAgentByName(
	_codexDir: string,
	configPath: string,
	agentName: string,
): { overwritten: boolean } {
	const storePath = getAgentManagerStorePath(configPath);
	const stashedBlock = getDisabledAgentBlock(storePath, agentName);
	const contents = fs.readFileSync(configPath, 'utf8');
	const alreadyExists = hasAgentConfigBlock(contents, agentName);
	if (stashedBlock) {
		takeDisabledAgentBlock(storePath, agentName);
		const nextContents = alreadyExists
			? replaceAgentConfigRawBlock(contents, agentName, stashedBlock)
			: appendAgentConfigRawBlock(contents, stashedBlock);
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(nextContents),
			'utf8',
		);
		return { overwritten: alreadyExists };
	}
	if (!alreadyExists) {
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(
				appendAgentConfigBlock(contents, agentName, '').contents,
			),
			'utf8',
		);
	}
	return { overwritten: false };
}

export function resolveAgentManagerPaths(): { codexDir: string; configPath: string } {
	return resolveCodexPaths();
}

function resolveAgentConfigFile(configPath: string, configFile: string): string {
	if (path.isAbsolute(configFile)) {
		return path.normalize(configFile);
	}
	return path.resolve(path.dirname(configPath), configFile);
}

function readAgentTomlDetails(agentPath: string): Record<string, string> {
	if (!fs.existsSync(agentPath)) { return {}; }
	const parsed = toml.parse(fs.readFileSync(agentPath, 'utf8')) as Record<string, unknown>;
	const result: Record<string, string> = {};
	for (const key of ['model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions']) {
		if (typeof parsed[key] === 'string') { result[key] = parsed[key]; }
	}
	return result;
}
