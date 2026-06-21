import fs from 'fs';
import path from 'path';

const AGENT_CONFIG_HEADER_PATTERN = /^\s*\[agents\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/;
const AGENT_DESCRIPTION_PATTERN =
	/^(\s*description\s*=\s*")((?:[^"\\]|\\.)*)(")(\s*#.*)?$/;
const AGENT_NAME_PATTERN =
	/^(\s*name\s*=\s*")((?:[^"\\]|\\.)*)(")(\s*#.*)?$/;
const AGENT_NAME_LINE_PATTERN =
	/^\s*name\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/m;
const AGENT_DESCRIPTION_LINE_PATTERN =
	/^\s*description\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/m;
const AGENT_DEVELOPER_INSTRUCTIONS_PATTERN =
	/^\s*developer_instructions\s*=\s*(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*(?:#.*)?$/m;

type AgentBlock = {
	id: string;
	startLine: number;
	endLine: number;
	description?: string;
	descriptionLineIndex?: number;
	configFile?: string;
	configFileLineIndex?: number;
};
const AGENT_CONFIG_FILE_PATTERN =
	/^(\s*config_file\s*=\s*")((?:[^"\\]|\\.)*)(")(\s*#.*)?$/;

/**
 * Returns true when config.toml already has an `[agents.<agentId>]` block.
 */
export function hasAgentConfigBlock(contents: string, agentId: string): boolean {
	return parseAgentBlocks(contents).some((block) => block.id === agentId);
}

/**
 * Appends a new agent block unless the target already exists.
 */
export function appendAgentConfigBlock(
	contents: string,
	agentId: string,
	description: string,
): { contents: string; appended: boolean } {
	if (hasAgentConfigBlock(contents, agentId)) {
		return { contents, appended: false };
	}
	return {
		contents: appendAgentConfigRawBlock(
			contents,
			buildAgentConfigBlock(agentId, description),
		),
		appended: true,
	};
}

/**
 * Appends a prebuilt `[agents.*]` block while preserving document formatting.
 */
export function appendAgentConfigRawBlock(contents: string, block: string): string {
	const normalizedBlock = block.trimEnd();
	if (contents.trim().length === 0) {
		return `${normalizedBlock}\n`;
	}

	const separator = contents.endsWith('\n') ? '\n' : '\n\n';
	return `${contents}${separator}${normalizedBlock}\n`;
}

/**
 * Replaces an existing agent block (or appends when missing).
 */
export function upsertAgentConfigBlock(
	contents: string,
	previousAgentId: string,
	nextAgentId: string,
	description: string,
): string {
	const lines = contents.split(/\r?\n/);
	const blocks = parseAgentBlocks(contents);
	const target = blocks.find((block) => block.id === previousAgentId);
	const replacement = buildAgentConfigBlock(nextAgentId, description).split('\n');

	if (!target) {
		return appendAgentConfigBlock(contents, nextAgentId, description).contents;
	}

	lines.splice(
		target.startLine,
		target.endLine - target.startLine + 1,
		...replacement,
	);
	return normalizeTomlContents(lines);
}

/**
 * Removes an existing `[agents.<agentId>]` block and returns the raw removed text.
 */
export function extractAgentConfigBlock(
	contents: string,
	agentId: string,
): { contents: string; block?: string; removed: boolean } {
	const lines = contents.split(/\r?\n/);
	const target = parseAgentBlocks(contents).find((block) => block.id === agentId);
	if (!target) {
		return { contents, removed: false };
	}
	const removedLines = lines.slice(target.startLine, target.endLine + 1);
	lines.splice(target.startLine, target.endLine - target.startLine + 1);
	return {
		contents: normalizeTomlContents(lines),
		block: `${removedLines.join('\n').trimEnd()}\n`,
		removed: true,
	};
}

/**
 * Builds the minimal agent block required by the spec.
 */
export function buildAgentConfigBlock(agentId: string, description: string): string {
	return buildAgentConfigBlockWithPath(
		agentId,
		description,
		`agents/${agentId}.toml`,
	);
}

export function buildAgentConfigBlockWithPath(
	agentId: string,
	description: string,
	configFile: string,
): string {
	const quotedAgentId = isUnquotedHeaderKey(agentId)
		? agentId
		: `"${escapeTomlString(agentId)}"`;
	const escapedDescription = escapeTomlString(description);
	const escapedConfigPath = escapeTomlString(configFile);
	return [
		`[agents.${quotedAgentId}]`,
		`description = "${escapedDescription}"`,
		`config_file = "${escapedConfigPath}"`,
	].join('\n');
}

export function upsertAgentConfigMetadata(
	contents: string,
	agentId: string,
	description: string | undefined,
	configFile: string,
): string {
	const lines = contents.split(/\r?\n/);
	const target = parseAgentBlocks(contents).find((block) => block.id === agentId);
	if (!target) {
		return appendAgentConfigRawBlock(
			contents,
			buildAgentConfigBlockWithPath(agentId, description ?? '', configFile),
		);
	}

	const blockLines = lines.slice(target.startLine, target.endLine + 1);
	const nextDescription = description ?? target.description ?? '';
	const descriptionLine = `description = "${escapeTomlString(nextDescription)}"`;
	const configFileLine = `config_file = "${escapeTomlString(configFile)}"`;
	const descriptionIndex =
		target.descriptionLineIndex !== undefined
			? target.descriptionLineIndex - target.startLine
			: undefined;
	const configFileIndex =
		target.configFileLineIndex !== undefined
			? target.configFileLineIndex - target.startLine
			: undefined;

	if (descriptionIndex !== undefined) {
		const match = blockLines[descriptionIndex]?.match(AGENT_DESCRIPTION_PATTERN);
		if (match) {
			blockLines[descriptionIndex] =
				`${match[1]}${escapeTomlString(nextDescription)}${match[3]}${match[4] ?? ''}`;
		}
	} else {
		blockLines.splice(1, 0, descriptionLine);
	}

	const insertionBaseIndex =
		descriptionIndex !== undefined
			? descriptionIndex + 1
			: 2;
	if (configFileIndex !== undefined) {
		const match = blockLines[configFileIndex]?.match(AGENT_CONFIG_FILE_PATTERN);
		if (match) {
			blockLines[configFileIndex] =
				`${match[1]}${escapeTomlString(configFile)}${match[3]}${match[4] ?? ''}`;
		}
	} else {
		blockLines.splice(insertionBaseIndex, 0, configFileLine);
	}

	lines.splice(
		target.startLine,
		target.endLine - target.startLine + 1,
		...blockLines,
	);
	return normalizeTomlContents(lines);
}

export function upsertAgentTomlMetadata(
	contents: string,
	agentId: string,
	description?: string,
): string {
	const lines = contents.split(/\r?\n/);
	const escapedAgentId = escapeTomlString(agentId);
	const nameLine = `name = "${escapedAgentId}"`;
	const descriptionLine =
		description !== undefined
			? `description = "${escapeTomlString(description)}"`
			: undefined;

	const nameLineIndex = lines.findIndex((line) => AGENT_NAME_PATTERN.test(line));
	const descriptionLineIndex = lines.findIndex((line) => AGENT_DESCRIPTION_PATTERN.test(line));

	if (nameLineIndex >= 0) {
		const match = lines[nameLineIndex]?.match(AGENT_NAME_PATTERN);
		if (match) {
			lines[nameLineIndex] =
				`${match[1]}${escapedAgentId}${match[3]}${match[4] ?? ''}`;
		}
	} else {
		const insertIndex = descriptionLineIndex >= 0 ? descriptionLineIndex : 0;
		lines.splice(insertIndex, 0, nameLine);
	}

	if (descriptionLine !== undefined) {
		const nextDescription = description ?? '';
		const nextDescriptionLineIndex = lines.findIndex((line) =>
			AGENT_DESCRIPTION_PATTERN.test(line),
		);
		if (nextDescriptionLineIndex >= 0) {
			const match = lines[nextDescriptionLineIndex]?.match(AGENT_DESCRIPTION_PATTERN);
			if (match) {
				lines[nextDescriptionLineIndex] =
					`${match[1]}${escapeTomlString(nextDescription)}${match[3]}${match[4] ?? ''}`;
			}
		} else {
			const nextNameLineIndex = lines.findIndex((line) => AGENT_NAME_PATTERN.test(line));
			const insertIndex = nextNameLineIndex >= 0 ? nextNameLineIndex + 1 : 0;
			lines.splice(insertIndex, 0, descriptionLine);
		}
	}

	return normalizeTomlContents(lines);
}

export function syncAgentTomlMetadata(
	agentFilePath: string,
	agentId: string,
	description?: string,
): boolean {
	if (!fs.existsSync(agentFilePath)) {
		return false;
	}
	const original = fs.readFileSync(agentFilePath, 'utf8');
	const next = upsertAgentTomlMetadata(original, agentId, description);
	if (next === original) {
		return false;
	}
	fs.writeFileSync(agentFilePath, next, 'utf8');
	return true;
}

export function validateAgentTomlContents(contents: string): string[] {
	const missing: string[] = [];
	if (!contents.match(AGENT_NAME_LINE_PATTERN)) {
		missing.push('name');
	}
	if (!contents.match(AGENT_DESCRIPTION_LINE_PATTERN)) {
		missing.push('description');
	}
	if (!contents.match(AGENT_DEVELOPER_INSTRUCTIONS_PATTERN)) {
		missing.push('developer_instructions');
	}
	return missing;
}

export function ensureAgentTomlRequiredFields(
	contents: string,
	agentId: string,
	description?: string,
): string {
	const nextContents = upsertAgentTomlMetadata(contents, agentId, description);
	if (nextContents.match(AGENT_DEVELOPER_INSTRUCTIONS_PATTERN)) {
		return nextContents;
	}

	const fallbackInstructions = [
		'Follow this agent description as your default behavior.',
		description ?? agentId,
	].join('\n');
	const lines = nextContents.split(/\r?\n/);
	const descriptionLineIndex = lines.findIndex((line) =>
		AGENT_DESCRIPTION_PATTERN.test(line),
	);
	const insertIndex = descriptionLineIndex >= 0 ? descriptionLineIndex + 1 : lines.length;
	lines.splice(
		insertIndex,
		0,
		'developer_instructions = """',
		fallbackInstructions,
		'"""',
	);
	return normalizeTomlContents(lines);
}

export function validateAgentTomlFile(agentFilePath: string): string[] {
	if (!fs.existsSync(agentFilePath)) {
		return ['name', 'description', 'developer_instructions'];
	}
	return validateAgentTomlContents(fs.readFileSync(agentFilePath, 'utf8'));
}

export function readAgentTomlDescription(agentFilePath: string): string | undefined {
	if (!fs.existsSync(agentFilePath)) {
		return undefined;
	}
	const contents = fs.readFileSync(agentFilePath, 'utf8');
	const match = contents.match(/^description\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/m);
	return match ? unescapeTomlString(match[1]) : undefined;
}

export function toAgentConfigFilePath(configPath: string, agentFilePath: string): string {
	return path.relative(path.dirname(configPath), agentFilePath).replace(/\\/g, '/');
}

/**
 * Extracts description from an existing `[agents.<agentId>]` block.
 */
export function getAgentDescription(
	contents: string,
	agentId: string,
): string | undefined {
	const block = parseAgentBlocks(contents).find((item) => item.id === agentId);
	return block?.description;
}

/**
 * Lists configured agent ids from `[agents.*]` blocks in config.toml.
 */
export function listConfiguredAgentIds(contents: string): string[] {
	return parseAgentBlocks(contents).map((block) => block.id);
}

export function getAgentConfigFile(
	contents: string,
	agentId: string,
): string | undefined {
	const block = parseAgentBlocks(contents).find((item) => item.id === agentId);
	return block?.configFile;
}

export function replaceAgentConfigRawBlock(
	contents: string,
	agentId: string,
	block: string,
): string {
	const extracted = extractAgentConfigBlock(contents, agentId);
	return appendAgentConfigRawBlock(extracted.contents, block);
}

function parseAgentBlocks(contents: string): AgentBlock[] {
	const lines = contents.split(/\r?\n/);
	const blocks: AgentBlock[] = [];
	let current: AgentBlock | null = null;

	for (let i = 0; i < lines.length; i += 1) {
		const headerMatch = lines[i].match(/^\s*\[[^\]]+\]\s*$/);
		if (headerMatch) {
			if (current) {
				current.endLine = i - 1;
				current = null;
			}
			const agentMatch = lines[i].match(AGENT_CONFIG_HEADER_PATTERN);
			if (agentMatch) {
				current = {
					id: agentMatch[1] ?? agentMatch[2] ?? '',
					startLine: i,
					endLine: lines.length - 1,
				};
				blocks.push(current);
			}
			continue;
		}

		if (!current) {
			continue;
		}

		const descriptionMatch = lines[i].match(AGENT_DESCRIPTION_PATTERN);
		if (descriptionMatch && current.description === undefined) {
			current.description = unescapeTomlString(descriptionMatch[2]);
			current.descriptionLineIndex = i;
		}
		const configFileMatch = lines[i].match(AGENT_CONFIG_FILE_PATTERN);
		if (configFileMatch && current.configFile === undefined) {
			current.configFile = unescapeTomlString(configFileMatch[2]);
			current.configFileLineIndex = i;
		}
	}

	return blocks;
}

function normalizeTomlContents(lines: string[]): string {
	return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

function isUnquotedHeaderKey(value: string): boolean {
	return /^[A-Za-z0-9_-]+$/.test(value);
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

function unescapeTomlString(value: string): string {
	return value
		.replace(/\\n/g, '\n')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}
