const AGENT_CONFIG_HEADER_PATTERN = /^\s*\[agents\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/;
const AGENT_DESCRIPTION_PATTERN =
	/^\s*description\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/;

type AgentBlock = {
	id: string;
	startLine: number;
	endLine: number;
	description?: string;
};

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
	const quotedAgentId = isUnquotedHeaderKey(agentId)
		? agentId
		: `"${escapeTomlString(agentId)}"`;
	const escapedDescription = escapeTomlString(description);
	const escapedConfigPath = escapeTomlString(`agents/${agentId}.toml`);
	return [
		`[agents.${quotedAgentId}]`,
		`description = "${escapedDescription}"`,
		`config_file = "${escapedConfigPath}"`,
	].join('\n');
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

		if (current.description !== undefined) {
			continue;
		}

		const descriptionMatch = lines[i].match(AGENT_DESCRIPTION_PATTERN);
		if (!descriptionMatch) {
			continue;
		}
		current.description = unescapeTomlString(descriptionMatch[1]);
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
