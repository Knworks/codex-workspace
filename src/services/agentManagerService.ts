import fs from 'fs';
import path from 'path';
import { AgentLocation, getAgentLocations } from './agentLocations';
import {
	appendAgentConfigBlock,
	appendAgentConfigRawBlock,
	extractAgentConfigBlock,
	getAgentConfigFile,
	getAgentDescription,
	hasAgentConfigBlock,
	replaceAgentConfigRawBlock,
} from './agentConfigService';
import {
	getDisabledAgentBlock,
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from './disabledAgentsStore';
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
	location: AgentLocation;
	enabled: boolean;
};

const INHERITED = '継承';

export function listAgentManagerRecords(
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
): AgentManagerRecord[] {
	const contents = fs.existsSync(configPath)
		? fs.readFileSync(configPath, 'utf8')
		: '';
	return locations.flatMap((location) =>
		listAgentFiles(location.rootPath).map((agentPath) => {
			const name = path.basename(agentPath, path.extname(agentPath));
			const configFile = getAgentConfigFile(contents, name) ?? `agents/${name}.toml`;
			const resolvedConfigFile = resolveAgentConfigFile(configPath, configFile);
			const detail = readAgentTomlDetails(resolvedConfigFile);
			const enabledDescription = getAgentDescription(contents, name);
			const disabledDescription = readDisabledAgentDescription(
				configPath,
				name,
			);
			return {
				id: `${location.kind}:${agentPath}`,
				name,
				description: enabledDescription ?? disabledDescription ?? '',
				model: detail.model ?? INHERITED,
				reasoningEffort: detail.model_reasoning_effort ?? INHERITED,
				sandboxMode: detail.sandbox_mode ?? INHERITED,
				agentPath: resolvedConfigFile,
				configFile,
				location,
				enabled: hasAgentConfigBlock(contents, name),
			};
		}),
	);
}

export function disableAgentByName(codexDir: string, configPath: string, agentName: string): void {
	const contents = fs.readFileSync(configPath, 'utf8');
	const extracted = extractAgentConfigBlock(contents, agentName);
	if (!extracted.removed || !extracted.block) {
		return;
	}
	saveDisabledAgentBlock(
		getDisabledAgentsStorePath(codexDir),
		agentName,
		extracted.block,
	);
	fs.writeFileSync(configPath, extracted.contents, 'utf8');
}

export function enableAgentByName(
	codexDir: string,
	configPath: string,
	agentName: string,
): { overwritten: boolean } {
	const storePath = getDisabledAgentsStorePath(codexDir);
	const stashedBlock = getDisabledAgentBlock(storePath, agentName);
	const contents = fs.readFileSync(configPath, 'utf8');
	const alreadyExists = hasAgentConfigBlock(contents, agentName);
	if (stashedBlock) {
		takeDisabledAgentBlock(storePath, agentName);
		const nextContents = alreadyExists
			? replaceAgentConfigRawBlock(contents, agentName, stashedBlock)
			: appendAgentConfigRawBlock(contents, stashedBlock);
		fs.writeFileSync(configPath, nextContents, 'utf8');
		return { overwritten: alreadyExists };
	}
	if (!alreadyExists) {
		fs.writeFileSync(
			configPath,
			appendAgentConfigBlock(contents, agentName, '').contents,
			'utf8',
		);
	}
	return { overwritten: false };
}

export function resolveAgentManagerPaths(): { codexDir: string; configPath: string } {
	return resolveCodexPaths();
}

function listAgentFiles(rootPath: string): string[] {
	if (!fs.existsSync(rootPath)) {
		return [];
	}
	return fs.readdirSync(rootPath, { withFileTypes: true })
		.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.toml')
		.map((entry) => path.join(rootPath, entry.name))
		.sort((left, right) =>
			path.basename(left).localeCompare(path.basename(right), undefined, {
				numeric: true,
				sensitivity: 'base',
			}),
		);
}

function resolveAgentConfigFile(configPath: string, configFile: string): string {
	if (path.isAbsolute(configFile)) {
		return configFile;
	}
	return path.join(path.dirname(configPath), configFile);
}

function readAgentTomlDetails(agentPath: string): Record<string, string> {
	if (!fs.existsSync(agentPath)) {
		return {};
	}
	const contents = fs.readFileSync(agentPath, 'utf8');
	const result: Record<string, string> = {};
	for (const key of ['model', 'model_reasoning_effort', 'sandbox_mode']) {
		const match = contents.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
		if (match) {
			result[key] = match[1];
		}
	}
	return result;
}

function readDisabledAgentDescription(
	configPath: string,
	agentName: string,
): string | undefined {
	const storePath = getDisabledAgentsStorePath(path.dirname(configPath));
	const block = getDisabledAgentBlock(storePath, agentName);
	if (!block) {
		return undefined;
	}
	const match = block.match(/^\s*description\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/m);
	return match ? unescapeTomlString(match[1]) : undefined;
}

function unescapeTomlString(value: string): string {
	return value
		.replace(/\\n/g, '\n')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}
