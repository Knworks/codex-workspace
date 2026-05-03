import fs from 'fs';

export type McpTransport = 'stdio' | 'http';

export type McpFormModel = {
	id: string;
	transport: McpTransport;
	command: string;
	args: string[];
	url: string;
	required?: boolean;
	startupTimeoutSec?: number;
	toolTimeoutSec?: number;
	enabledTools: string[];
	disabledTools: string[];
	enabled: boolean;
};

export type McpValidationResult = {
	ok: boolean;
	errors: string[];
};

type McpBlock = {
	id: string;
	startLine: number;
	endLine: number;
	lines: string[];
};

const MCP_HEADER_PATTERN =
	/^\s*\[mcp_servers\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.-]+))\]\s*$/;

export function listMcpFormModels(configPath: string): McpFormModel[] {
	if (!fs.existsSync(configPath)) {
		return [];
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	return parseMcpBlocks(contents)
		.filter((block) => !block.id.endsWith('.env'))
		.map(blockToModel);
}

export function validateMcpModel(
	model: McpFormModel,
	existingIds: string[],
	previousId?: string,
): McpValidationResult {
	const errors: string[] = [];
	if (!model.id.trim()) {
		errors.push('serverNameRequired');
	}
	if (existingIds.includes(model.id) && model.id !== previousId) {
		errors.push('serverNameDuplicate');
	}
	if (model.transport !== 'stdio' && model.transport !== 'http') {
		errors.push('transportRequired');
	}
	if (model.transport === 'stdio' && !model.command.trim()) {
		errors.push('commandRequired');
	}
	if (model.transport === 'http' && !model.url.trim()) {
		errors.push('urlRequired');
	}
	for (const timeout of [model.startupTimeoutSec, model.toolTimeoutSec]) {
		if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
			errors.push('timeoutInvalid');
		}
	}
	if (model.enabledTools.length > 0 && model.disabledTools.length > 0) {
		errors.push('toolsMutuallyExclusive');
	}
	return { ok: errors.length === 0, errors };
}

export function saveMcpServer(
	configPath: string,
	model: McpFormModel,
	previousId?: string,
): McpValidationResult {
	const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	const blocks = parseMcpBlocks(contents);
	const validation = validateMcpModel(
		model,
		blocks.map((block) => block.id),
		previousId,
	);
	if (!validation.ok) {
		return validation;
	}
	const target = previousId
		? blocks.find((block) => block.id === previousId)
		: undefined;
	const newBlock = buildMcpBlock(model, target).split('\n');
	if (!target) {
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		fs.writeFileSync(configPath, `${contents}${separator}${newBlock.join('\n')}\n`, 'utf8');
		return validation;
	}
	const lines = contents.split(/\r?\n/);
	lines.splice(target.startLine, target.endLine - target.startLine + 1, ...newBlock);
	fs.writeFileSync(configPath, normalizeLines(lines), 'utf8');
	return validation;
}

export function deleteMcpServer(configPath: string, serverId: string): boolean {
	const contents = fs.readFileSync(configPath, 'utf8');
	const blocks = parseMcpBlocks(contents);
	const targetIds = new Set([serverId, `${serverId}.env`]);
	const targets = blocks.filter((block) => targetIds.has(block.id));
	if (targets.length === 0) {
		return false;
	}
	const lines = contents.split(/\r?\n/);
	for (const target of [...targets].sort((left, right) => right.startLine - left.startLine)) {
		lines.splice(target.startLine, target.endLine - target.startLine + 1);
	}
	fs.writeFileSync(configPath, normalizeLines(lines), 'utf8');
	return true;
}

function parseMcpBlocks(contents: string): McpBlock[] {
	const lines = contents.split(/\r?\n/);
	const blocks: McpBlock[] = [];
	let current: McpBlock | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const header = lines[index].match(/^\s*\[[^\]]+\]\s*$/);
		if (header) {
			if (current) {
				current.endLine = index - 1;
				current.lines = lines.slice(current.startLine, current.endLine + 1);
				current = undefined;
			}
			const mcpHeader = lines[index].match(MCP_HEADER_PATTERN);
			if (mcpHeader) {
				const id = unescapeTomlString(mcpHeader[1] ?? mcpHeader[2] ?? '');
				current = {
					id,
					startLine: index,
					endLine: lines.length - 1,
					lines: [],
				};
				blocks.push(current);
			}
		}
	}
	if (current) {
		current.lines = lines.slice(current.startLine, current.endLine + 1);
	}
	return blocks;
}

function blockToModel(block: McpBlock): McpFormModel {
	const values = readBlockValues(block.lines);
	const hasUrl = typeof values.url === 'string';
	const args = Array.isArray(values.args) ? values.args : [];
	const enabledTools = Array.isArray(values.enabled_tools) ? values.enabled_tools : [];
	const disabledTools = Array.isArray(values.disabled_tools) ? values.disabled_tools : [];
	return {
		id: block.id,
		transport: hasUrl ? 'http' : 'stdio',
		command: typeof values.command === 'string' ? values.command : '',
		args,
		url: typeof values.url === 'string' ? values.url : '',
		required: typeof values.required === 'boolean' ? values.required : undefined,
		startupTimeoutSec:
			typeof values.startup_timeout_sec === 'number'
				? values.startup_timeout_sec
				: undefined,
		toolTimeoutSec:
			typeof values.tool_timeout_sec === 'number'
				? values.tool_timeout_sec
				: undefined,
		enabledTools,
		disabledTools,
		enabled: typeof values.enabled === 'boolean' ? values.enabled : true,
	};
}

function readBlockValues(lines: string[]): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const line of lines.slice(1)) {
		const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/);
		if (!match) {
			continue;
		}
		values[match[1]] = parseTomlScalarOrArray(match[2]);
	}
	return values;
}

function parseTomlScalarOrArray(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === 'true') {
		return true;
	}
	if (trimmed === 'false') {
		return false;
	}
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		return Number(trimmed);
	}
	const stringMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
	if (stringMatch) {
		return stringMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
	}
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
			match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
		);
	}
	return trimmed;
}

function buildMcpBlock(model: McpFormModel, previous?: McpBlock): string {
	const preserved = new Map<string, string>();
	if (previous) {
		for (const line of previous.lines.slice(1)) {
			const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
			if (key) {
				preserved.set(key, line);
			}
		}
	}
	const controlled = new Set([
		'enabled',
		'command',
		'args',
		'url',
		'required',
		'startup_timeout_sec',
		'tool_timeout_sec',
		'enabled_tools',
		'disabled_tools',
	]);
	const lines = [`[mcp_servers.${formatHeaderKey(model.id)}]`];
	if (!model.enabled) {
		lines.push('enabled = false');
	}
	if (model.transport === 'stdio') {
		lines.push(`command = "${escapeTomlString(model.command)}"`);
		if (model.args.length > 0) {
			lines.push(`args = ${formatStringArray(model.args)}`);
		}
	} else {
		lines.push(`url = "${escapeTomlString(model.url)}"`);
	}
	if (model.required !== undefined) {
		lines.push(`required = ${model.required ? 'true' : 'false'}`);
	}
	if (model.startupTimeoutSec !== undefined) {
		lines.push(`startup_timeout_sec = ${model.startupTimeoutSec}`);
	}
	if (model.toolTimeoutSec !== undefined) {
		lines.push(`tool_timeout_sec = ${model.toolTimeoutSec}`);
	}
	if (model.enabledTools.length > 0) {
		lines.push(`enabled_tools = ${formatStringArray(model.enabledTools)}`);
	}
	if (model.disabledTools.length > 0) {
		lines.push(`disabled_tools = ${formatStringArray(model.disabledTools)}`);
	}
	for (const [key, line] of preserved) {
		if (!controlled.has(key)) {
			lines.push(line);
		}
	}
	return lines.join('\n');
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTomlString(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function formatHeaderKey(value: string): string {
	return /^[A-Za-z0-9_-]+$/.test(value)
		? value
		: `"${escapeTomlString(value)}"`;
}

function formatStringArray(values: string[]): string {
	return `[${values.map((value) => `"${escapeTomlString(value)}"`).join(', ')}]`;
}

function normalizeLines(lines: string[]): string {
	return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}
