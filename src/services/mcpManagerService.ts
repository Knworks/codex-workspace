import fs from 'fs';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';

export type McpTransport = 'stdio' | 'http';

export type McpEnvEntry = {
	key: string;
	value: string;
};

export type McpFormModel = {
	id: string;
	transport: McpTransport;
	command: string;
	args: string[];
	url: string;
	env: McpEnvEntry[];
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
	parentId?: string;
	settingName?: string;
};

type McpHeaderInfo = {
	id: string;
	parentId?: string;
	settingName?: string;
};

const MCP_HEADER_PATTERN =
	/^\s*\[mcp_servers\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.-]+))\]\s*$/;
const MCP_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseMcpHeader(line: string): McpHeaderInfo | undefined {
	const match = line.match(MCP_HEADER_PATTERN);
	if (!match) {
		return undefined;
	}
	const quotedId = match[1];
	const bareId = match[2];
	const id = unescapeTomlString(quotedId ?? bareId ?? '');
	if (id.toLowerCase().endsWith('.env')) {
		return {
			id,
			parentId: id.slice(0, -4),
			settingName: 'env',
		};
	}
	if (!quotedId && bareId?.includes('.')) {
		const [parentId, ...settingSegments] = bareId.split('.');
		if (parentId && settingSegments.length > 0) {
			return {
				id,
				parentId,
				settingName: settingSegments.join('.'),
			};
		}
	}
	return { id };
}

export function listMcpFormModels(configPath: string): McpFormModel[] {
	if (!fs.existsSync(configPath)) {
		return [];
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	const blocks = parseMcpBlocks(contents);
	const envBlocks = new Map(
		blocks
			.filter((block) => block.settingName === 'env' && block.parentId)
			.map((block) => [block.parentId!, block] as const),
	);
	return blocks
		.filter((block) => !block.parentId)
		.map((block) => blockToModel(block, envBlocks.get(block.id)));
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
	const seenEnvKeys = new Set<string>();
	for (const entry of model.env) {
		const key = entry.key.trim();
		const value = entry.value.trim();
		if (!key && !value) {
			continue;
		}
		if (!key) {
			errors.push('envKeyRequired');
			continue;
		}
		if (!MCP_ENV_KEY_PATTERN.test(key)) {
			errors.push('envKeyInvalid');
			continue;
		}
		if (seenEnvKeys.has(key)) {
			errors.push('envKeyDuplicate');
			continue;
		}
		seenEnvKeys.add(key);
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
		blocks.filter((block) => !block.parentId).map((block) => block.id),
		previousId,
	);
	if (!validation.ok) {
		return validation;
	}
	const target = previousId
		? blocks.find((block) => block.id === previousId)
		: undefined;
	const targetEnv = previousId
		? blocks.find((block) => block.parentId === previousId && block.settingName === 'env')
		: undefined;
	const targetCompanions = previousId
		? blocks.filter(
				(block) =>
					block.parentId === previousId &&
					block.settingName &&
					block.settingName !== 'env',
			)
		: [];
	const newBlock = buildMcpBlock(model, target).split('\n');
	const newEnvBlock = buildMcpEnvBlock(model).split('\n');
	if (!target) {
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		const envSection =
			model.env.length > 0 ? `\n\n${newEnvBlock.join('\n')}` : '';
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(
				`${contents}${separator}${newBlock.join('\n')}${envSection}\n`,
			),
			'utf8',
		);
		return validation;
	}
	const lines = contents.split(/\r?\n/);
	const replacements = [
		{ target, nextLines: newBlock },
		...(targetEnv
			? [{ target: targetEnv, nextLines: model.env.length > 0 ? newEnvBlock : [] }]
			: []),
		...targetCompanions.map((block) => ({
			target: block,
			nextLines: rewriteCompanionBlock(block, model.id).split('\n'),
		})),
	].sort((left, right) => right.target.startLine - left.target.startLine);
	for (const replacement of replacements) {
		lines.splice(
			replacement.target.startLine,
			replacement.target.endLine - replacement.target.startLine + 1,
			...replacement.nextLines,
		);
	}
	if (!targetEnv && model.env.length > 0) {
		lines.push('', ...newEnvBlock);
	}
	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(normalizeLines(lines)),
		'utf8',
	);
	return validation;
}

export function deleteMcpServer(configPath: string, serverId: string): boolean {
	const contents = fs.readFileSync(configPath, 'utf8');
	const blocks = parseMcpBlocks(contents);
	const targets = blocks.filter(
		(block) => block.id === serverId || block.parentId === serverId,
	);
	if (targets.length === 0) {
		return false;
	}
	const lines = contents.split(/\r?\n/);
	for (const target of [...targets].sort((left, right) => right.startLine - left.startLine)) {
		lines.splice(target.startLine, target.endLine - target.startLine + 1);
	}
	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(normalizeLines(lines)),
		'utf8',
	);
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
			const headerInfo = parseMcpHeader(lines[index]);
			if (headerInfo) {
				current = {
					id: headerInfo.id,
					startLine: index,
					endLine: lines.length - 1,
					lines: [],
					parentId: headerInfo.parentId,
					settingName: headerInfo.settingName,
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

function blockToModel(block: McpBlock, envBlock?: McpBlock): McpFormModel {
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
		env: envBlock ? readEnvBlockEntries(envBlock.lines) : toEnvEntries(values.env),
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
	const literalStringMatch = trimmed.match(/^'([^']*)'$/);
	if (literalStringMatch) {
		return literalStringMatch[1];
	}
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
			match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
		);
	}
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		return parseTomlInlineTable(trimmed);
	}
	return trimmed;
}

function parseTomlInlineTable(value: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of value.matchAll(
		/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g,
	)) {
		result[match[1]] = match[2]
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
	}
	return result;
}

function toEnvEntries(value: unknown): McpEnvEntry[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return [];
	}
	return Object.entries(value as Record<string, unknown>)
		.filter(([, entryValue]) => typeof entryValue === 'string')
		.map(([key, entryValue]) => ({ key, value: entryValue as string }));
}

function readEnvBlockEntries(lines: string[]): McpEnvEntry[] {
	return Object.entries(readBlockValues(lines))
		.filter(([, entryValue]) => typeof entryValue === 'string')
		.map(([key, value]) => ({ key, value: value as string }));
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
		'env',
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

function buildMcpEnvBlock(model: McpFormModel): string {
	const envHeader = buildCompanionHeader(model.id, 'env');
	const lines = [envHeader];
	for (const entry of model.env) {
		if (!entry.key.trim()) {
			continue;
		}
		lines.push(`${entry.key} = '${escapeTomlLiteralString(entry.value)}'`);
	}
	return lines.join('\n');
}

function escapeTomlLiteralString(value: string): string {
	return value.replace(/'/g, "''");
}

function buildCompanionHeader(parentId: string, settingName: string): string {
	return /^[A-Za-z0-9_-]+$/.test(parentId) && /^[A-Za-z0-9_.-]+$/.test(settingName)
		? `[mcp_servers.${parentId}.${settingName}]`
		: `[mcp_servers.${formatHeaderKey(`${parentId}.${settingName}`)}]`;
}

function rewriteCompanionBlock(block: McpBlock, parentId: string): string {
	if (!block.settingName) {
		return block.lines.join('\n');
	}
	return [buildCompanionHeader(parentId, block.settingName), ...block.lines.slice(1)].join('\n');
}

function normalizeLines(lines: string[]): string {
	return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}
