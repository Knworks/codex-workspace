import fs from 'fs';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';

export type McpTransport = 'stdio' | 'http';

export type McpEnvEntry = {
	key: string;
	value: string;
};

export type McpToolEntry = {
	name: string;
	enabled?: boolean;
	approvalMode?: 'auto' | 'prompt' | 'approve';
};

export type McpFormModel = {
	id: string;
	transport: McpTransport;
	command: string;
	args: string[];
	url: string;
	env: McpEnvEntry[];
	httpHeaders?: McpEnvEntry[];
	envHttpHeaders?: McpEnvEntry[];
	tools?: McpToolEntry[];
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
const MCP_TOOL_APPROVAL_MODES = new Set(['auto', 'prompt', 'approve']);

function parseKnownMcpCompanionId(
	id: string,
	allowUnknownBareCompanion = false,
): { parentId: string; settingName: string } | undefined {
	for (const settingName of ['env', 'http_headers', 'env_http_headers']) {
		const suffix = `.${settingName}`;
		if (id.toLowerCase().endsWith(suffix)) {
			return {
				parentId: id.slice(0, -suffix.length),
				settingName,
			};
		}
	}
	const toolsMarker = '.tools.';
	const toolsIndex = id.toLowerCase().indexOf(toolsMarker);
	if (toolsIndex > 0 && toolsIndex + toolsMarker.length < id.length) {
		return {
			parentId: id.slice(0, toolsIndex),
			settingName: id.slice(toolsIndex + 1),
		};
	}
	if (!allowUnknownBareCompanion) {
		return undefined;
	}
	const segments = id.split('.');
	if (segments.length > 1 && segments[0]) {
		return {
			parentId: segments[0],
			settingName: segments.slice(1).join('.'),
		};
	}
	return undefined;
}

function parseMcpHeader(line: string): McpHeaderInfo | undefined {
	const match = line.match(MCP_HEADER_PATTERN);
	if (!match) {
		return undefined;
	}
	const quotedId = match[1];
	const bareId = match[2];
	const id = unescapeTomlString(quotedId ?? bareId ?? '');
	const companion = parseKnownMcpCompanionId(id, !quotedId);
	if (companion) {
		return {
			id,
			parentId: companion.parentId,
			settingName: companion.settingName,
		};
	}
	return { id };
}

export function listMcpFormModels(configPath: string): McpFormModel[] {
	if (!fs.existsSync(configPath)) {
		return [];
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	const blocks = parseMcpBlocks(contents);
	return blocks
		.filter((block) => !block.parentId)
		.map((block) =>
			blockToModel(block, blocks.filter((candidate) => candidate.parentId === block.id)),
		);
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
	for (const entry of [
		...model.env,
		...(model.httpHeaders ?? []),
		...(model.envHttpHeaders ?? []),
	]) {
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
	for (const entry of model.tools ?? []) {
		const name = entry.name.trim();
		if (!name) {
			if (entry.enabled === undefined && !entry.approvalMode) {
				continue;
			}
			errors.push('toolNameRequired');
			continue;
		}
		if (entry.approvalMode && !MCP_TOOL_APPROVAL_MODES.has(entry.approvalMode)) {
			errors.push('toolApprovalModeInvalid');
		}
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
	const targetCompanions = previousId
		? blocks.filter((block) => block.parentId === previousId && block.settingName)
		: [];
	const existingModel = target ? blockToModel(target, targetCompanions) : undefined;
	const effectiveModel: McpFormModel = {
		...model,
		httpHeaders: model.httpHeaders ?? existingModel?.httpHeaders ?? [],
		envHttpHeaders: model.envHttpHeaders ?? existingModel?.envHttpHeaders ?? [],
		tools: model.tools ?? existingModel?.tools ?? [],
	};
	const newBlock = buildMcpBlock(effectiveModel, target).split('\n');
	const newCompanionBlocks = buildManagedCompanionBlocks(effectiveModel);
	if (!target) {
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		const companionSection =
			newCompanionBlocks.length > 0 ? `\n\n${newCompanionBlocks.join('\n\n')}` : '';
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(
				`${contents}${separator}${newBlock.join('\n')}${companionSection}\n`,
			),
			'utf8',
		);
		return validation;
	}
	const lines = contents.split(/\r?\n/);
	const managedCompanions = targetCompanions.filter((block) =>
		isManagedCompanionSetting(block.settingName),
	);
	const unknownCompanions = targetCompanions.filter(
		(block) => !isManagedCompanionSetting(block.settingName),
	);
	const replacements = [
		{ target, nextLines: newBlock },
		...managedCompanions.map((block, index) => ({
			target: block,
			nextLines:
				index < newCompanionBlocks.length
					? newCompanionBlocks[index].split('\n')
					: [],
		})),
		...unknownCompanions.map((block) => ({
			target: block,
			nextLines:
				previousId && model.id !== previousId
					? rewriteCompanionBlock(block, model.id).split('\n')
					: block.lines,
		})),
	].sort((left, right) => right.target.startLine - left.target.startLine);
	for (const replacement of replacements) {
		lines.splice(
			replacement.target.startLine,
			replacement.target.endLine - replacement.target.startLine + 1,
			...replacement.nextLines,
		);
	}
	if (newCompanionBlocks.length > managedCompanions.length) {
		const extraBlocks = newCompanionBlocks.slice(managedCompanions.length);
		lines.push(
			'',
			...extraBlocks.flatMap((block, index) =>
				index === 0 ? block.split('\n') : ['', ...block.split('\n')],
			),
		);
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

function blockToModel(block: McpBlock, companionBlocks: McpBlock[]): McpFormModel {
	const values = readBlockValues(block.lines);
	const hasUrl = typeof values.url === 'string';
	const args = Array.isArray(values.args) ? values.args : [];
	const enabledTools = Array.isArray(values.enabled_tools) ? values.enabled_tools : [];
	const disabledTools = Array.isArray(values.disabled_tools) ? values.disabled_tools : [];
	const envBlock = companionBlocks.find((candidate) => candidate.settingName === 'env');
	const httpHeadersBlock = companionBlocks.find(
		(candidate) => candidate.settingName === 'http_headers',
	);
	const envHttpHeadersBlock = companionBlocks.find(
		(candidate) => candidate.settingName === 'env_http_headers',
	);
	return {
		id: block.id,
		transport: hasUrl ? 'http' : 'stdio',
		command: typeof values.command === 'string' ? values.command : '',
		args,
		url: typeof values.url === 'string' ? values.url : '',
		env: envBlock ? readEnvBlockEntries(envBlock.lines) : toEnvEntries(values.env),
		httpHeaders: httpHeadersBlock
			? readEnvBlockEntries(httpHeadersBlock.lines)
			: toEnvEntries(values.http_headers),
		envHttpHeaders: envHttpHeadersBlock
			? readEnvBlockEntries(envHttpHeadersBlock.lines)
			: toEnvEntries(values.env_http_headers),
		tools: companionBlocks
			.filter((candidate) => candidate.settingName?.startsWith('tools.'))
			.map((candidate) => toToolEntry(candidate))
			.filter((entry): entry is McpToolEntry => entry !== undefined),
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

function toToolEntry(block: McpBlock): McpToolEntry | undefined {
	const toolName = block.settingName?.slice('tools.'.length).trim();
	if (!toolName) {
		return undefined;
	}
	const values = readBlockValues(block.lines);
	const approvalMode =
		typeof values.approval_mode === 'string' && MCP_TOOL_APPROVAL_MODES.has(values.approval_mode)
			? (values.approval_mode as McpToolEntry['approvalMode'])
			: undefined;
	return {
		name: toolName,
		enabled: typeof values.enabled === 'boolean' ? values.enabled : undefined,
		approvalMode,
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
		'http_headers',
		'env_http_headers',
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
	return buildKeyValueCompanionBlock(model.id, 'env', model.env);
}

function buildManagedCompanionBlocks(model: McpFormModel): string[] {
	const blocks: string[] = [];
	if (model.env.length > 0) {
		blocks.push(buildKeyValueCompanionBlock(model.id, 'env', model.env));
	}
	if ((model.httpHeaders ?? []).length > 0) {
		blocks.push(
			buildKeyValueCompanionBlock(model.id, 'http_headers', model.httpHeaders ?? []),
		);
	}
	if ((model.envHttpHeaders ?? []).length > 0) {
		blocks.push(
			buildKeyValueCompanionBlock(
				model.id,
				'env_http_headers',
				model.envHttpHeaders ?? [],
			),
		);
	}
	for (const tool of model.tools ?? []) {
		if (!tool.name.trim()) {
			continue;
		}
		blocks.push(buildToolCompanionBlock(model.id, tool));
	}
	return blocks;
}

function buildKeyValueCompanionBlock(
	parentId: string,
	settingName: string,
	entries: McpEnvEntry[],
): string {
	const lines = [buildCompanionHeader(parentId, settingName)];
	for (const entry of entries) {
		if (!entry.key.trim()) {
			continue;
		}
		lines.push(`${entry.key} = '${escapeTomlLiteralString(entry.value)}'`);
	}
	return lines.join('\n');
}

function buildToolCompanionBlock(parentId: string, entry: McpToolEntry): string {
	const lines = [buildCompanionHeader(parentId, `tools.${entry.name.trim()}`)];
	if (entry.enabled !== undefined) {
		lines.push(`enabled = ${entry.enabled ? 'true' : 'false'}`);
	}
	if (entry.approvalMode) {
		lines.push(`approval_mode = "${escapeTomlString(entry.approvalMode)}"`);
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

function isManagedCompanionSetting(settingName?: string): boolean {
	return Boolean(
		settingName &&
			(settingName === 'env' ||
				settingName === 'http_headers' ||
				settingName === 'env_http_headers' ||
				settingName.startsWith('tools.')),
	);
}

function normalizeLines(lines: string[]): string {
	return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}
