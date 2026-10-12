import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import * as vscode from 'vscode';
import { parse } from 'toml';
import { messages } from '../i18n';
import { listTrustedDirectories } from './coreDiagnosticsService';
import { resolveCodexPaths } from './workspaceStatus';

export type FeatureFlagRecord = {
	key: string;
	enabled: boolean;
	maturity: string;
	maturityClass: string;
	description: string;
};

export type HookEventName =
	| 'SessionStart'
	| 'PreToolUse'
	| 'PermissionRequest'
	| 'PostToolUse'
	| 'UserPromptSubmit'
	| 'Stop';

export type HookSourceRecord = {
	id: string;
	layer: 'user' | 'project';
	format: 'hooks.json' | 'inline';
	path: string;
	exists: boolean;
	active: boolean;
	entryCount: number;
	warning?: string;
};

export type HookEntryRecord = {
	id: string;
	layer: 'user' | 'project';
	format: 'hooks.json' | 'inline';
	event: HookEventName;
	matcher?: string;
	handlerType: string;
	command?: string;
	timeout?: number;
	statusMessage?: string;
	active: boolean;
	supported: boolean;
	sourcePath: string;
	warning?: string;
};

export type HookDiagnosticsSnapshot = {
	hooksEnabled: boolean;
	workspaceRoot?: string;
	projectTrusted: boolean;
	sources: HookSourceRecord[];
	entries: HookEntryRecord[];
	warnings: string[];
};

type ParsedHookGroup = {
	event: HookEventName;
	matcher?: string;
	handlers: Array<{
		type: string;
		command?: string;
		timeout?: number;
		statusMessage?: string;
	}>;
};

function getFeatureFlagDescription(key: string): string {
	switch (key) {
		case 'apps':
			return messages.featureFlagDescriptionApps;
		case 'browser_use':
			return messages.featureFlagDescriptionBrowserUse;
		case 'fast_mode':
			return messages.featureFlagDescriptionFastMode;
		case 'hooks':
			return messages.featureFlagDescriptionHooks;
		case 'memories':
			return messages.featureFlagDescriptionMemories;
		case 'multi_agent':
			return messages.featureFlagDescriptionMultiAgent;
		case 'personality':
			return messages.featureFlagDescriptionPersonality;
		case 'shell_snapshot':
			return messages.featureFlagDescriptionShellSnapshot;
		case 'shell_tool':
			return messages.featureFlagDescriptionShellTool;
		case 'unified_exec':
			return messages.featureFlagDescriptionUnifiedExec;
		case 'workspace_dependencies':
			return messages.featureFlagDescriptionWorkspaceDependencies;
		case 'undo':
			return messages.featureFlagDescriptionUndo;
		case 'web_search_cached':
			return messages.featureFlagDescriptionWebSearchCached;
		case 'web_search_request':
			return messages.featureFlagDescriptionWebSearchRequest;
		default:
			return messages.featureFlagDescriptionGeneric(key);
	}
}

const HOOK_EVENTS: HookEventName[] = [
	'SessionStart',
	'PreToolUse',
	'PermissionRequest',
	'PostToolUse',
	'UserPromptSubmit',
	'Stop',
];

const FEATURES_HEADER_PATTERN = /^\s*\[features\]\s*$/;
const BOOLEAN_FEATURE_PATTERN = /^\s*([A-Za-z0-9_]+)\s*=\s*(true|false)(\s*#.*)?$/i;

function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Parses the installed CLI's key, stage and effective enabled columns. */
export function parseFeatureFlagOutput(output: string): FeatureFlagRecord[] {
	const keys = new Set<string>();
	const records: FeatureFlagRecord[] = [];
	for (const line of output.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s+([A-Za-z][A-Za-z ]*?)\s+(true|false)\s*$/);
		if (!match || keys.has(match[1])) {
			throw new Error('Invalid codex features list output');
		}
		const [, key, stage, enabled] = match;
		keys.add(key);
		records.push({
			key,
			enabled: enabled === 'true',
			maturity: stage.charAt(0).toUpperCase() + stage.slice(1),
			maturityClass: stage.toLowerCase().replace(/\s+/g, '-'),
			description: getFeatureFlagDescription(key),
		});
	}
	if (records.length === 0) {
		throw new Error('Empty codex features list output');
	}
	return records;
}

export async function listFeatureFlagRecords(
	configPath: string = resolveCodexPaths().configPath,
	runCommand: FeatureCommandRunner = runFeatureCommand,
): Promise<FeatureFlagRecord[]> {
	return parseFeatureFlagOutput(await runCommand(['features', 'list'], path.resolve(path.dirname(configPath))));
}

export async function setFeatureFlag(
	configPath: string,
	featureKey: string,
	enabled: boolean,
	runCommand: FeatureCommandRunner = runFeatureCommand,
): Promise<FeatureFlagRecord[]> {
	if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(featureKey)) {
		throw new Error('Invalid feature key');
	}
	const records = await listFeatureFlagRecords(configPath, runCommand);
	const record = records.find((candidate) => candidate.key === featureKey);
	if (!record) {
		throw new Error('Unknown feature key: ' + featureKey);
	}
	if (record.maturity.toLowerCase() === 'removed') {
		throw new Error(`${messages.featureCleanupReasonRemoved}: ${featureKey}`);
	}
	await runCommand(['features', enabled ? 'enable' : 'disable', featureKey], path.resolve(path.dirname(configPath)));
	return listFeatureFlagRecords(configPath, runCommand);
}

export type FeatureCommandRunner = (args: string[], codexHome: string) => Promise<string>;

export type ObsoleteFeatureSetting = {
	key: string;
	value: boolean;
	reason: 'removed' | 'unlisted';
};

export type FeatureCleanupPlan = {
	configPath: string;
	contents: string;
	settings: ObsoleteFeatureSetting[];
};

export function ensureFeatureConfigSaved(configPath: string): void {
	const normalize = (filePath: string) => {
		const resolved = path.resolve(filePath);
		return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
	};
	if (vscode.workspace.textDocuments.some((document) =>
		document.isDirty && normalize(document.uri.fsPath) === normalize(configPath))) {
		throw new Error(messages.featureCleanupDirty);
	}
}

/** Captures the exact file and settings that the user will review before deletion. */
export function planFeatureFlagCleanup(configPath: string, records: FeatureFlagRecord[]): FeatureCleanupPlan {
	if (!records.length) {
		throw new Error(messages.featureCleanupChanged);
	}
	const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	let parsed: Record<string, unknown>;
	try {
		parsed = parse(contents) as Record<string, unknown>;
	} catch {
		throw new Error(messages.featureCleanupUnsupported);
	}
	const features = parsed.features;
	if (features !== undefined && (!features || typeof features !== 'object' || Array.isArray(features))) {
		throw new Error(messages.featureCleanupUnsupported);
	}
	const registry = new Map(records.map((record) => [record.key, record]));
	const settings: ObsoleteFeatureSetting[] = [];
	for (const [key, value] of Object.entries(features ?? {})) {
		const record = registry.get(key);
		if (record && record.maturity.toLowerCase() !== 'removed') {
			continue;
		}
		if (typeof value !== 'boolean') {
			throw new Error(messages.featureCleanupUnsupported);
		}
		settings.push({ key, value, reason: record ? 'removed' : 'unlisted' });
	}
	return { configPath: path.resolve(configPath), contents, settings };
}

/** Deletes only reviewed, still-obsolete boolean assignments; preserves all other bytes. */
export async function removeObsoleteFeatureFlags(
	plan: FeatureCleanupPlan,
	runCommand: FeatureCommandRunner = runFeatureCommand,
): Promise<number> {
	if (plan.settings.length === 0) {
		return 0;
	}
	const records = await listFeatureFlagRecords(plan.configPath, runCommand);
	const current = planFeatureFlagCleanup(plan.configPath, records);
	const keys = new Set(plan.settings.map((setting) => setting.key));
	const currentKeys = new Set(current.settings.map((setting) => setting.key));
	if (current.contents !== plan.contents || keys.size !== plan.settings.length
		|| [...keys].some((key) => !currentKeys.has(key))) {
		throw new Error(messages.featureCleanupChanged);
	}

	const deleted = new Set<string>();
	let inFeatures = false;
	const lines = current.contents.match(/[^\n]*(?:\n|$)/g) ?? [];
	const remaining = lines.filter((line) => {
		if (/^\s*\[/.test(line)) {
			inFeatures = /^\s*\[(?:features|"features"|'features')\]\s*(?:#.*)?$/.test(line.trimEnd());
			return true;
		}
		if (!inFeatures || !/^\s*.+?\s*=\s*(true|false)\s*(?:#.*)?$/.test(line.trimEnd())) {
			return true;
		}
		const assignment = Object.entries(parse(line) as Record<string, unknown>);
		if (assignment.length !== 1 || typeof assignment[0][1] !== 'boolean' || !keys.has(assignment[0][0])) {
			return true;
		}
		const key = assignment[0][0];
		if (deleted.has(key)) {
			throw new Error(messages.featureCleanupUnsupported);
		}
		deleted.add(key);
		return false;
	}).join('');

	const expected = parse(current.contents) as { features: Record<string, unknown> };
	for (const key of keys) {
		delete expected.features[key];
	}
	// Reject inline tables, dotted assignments and matches inside multiline strings
	// unless parsing proves that only the reviewed feature values were removed.
	if (deleted.size !== keys.size || !isDeepStrictEqual(parse(remaining), expected)) {
		throw new Error(messages.featureCleanupUnsupported);
	}
	ensureFeatureConfigSaved(plan.configPath);
	fs.writeFileSync(plan.configPath, remaining, 'utf8');
	return deleted.size;
}

/** Runs outside the workspace so project configuration and profiles are not applied. */
async function runFeatureCommand(args: string[], codexHome: string): Promise<string> {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-features-'));
	try {
		const execute = (command: string): Promise<string> => new Promise<string>((resolve, reject) => {
			execFile(command, args, {
				cwd,
				env: { ...process.env, CODEX_HOME: codexHome },
				windowsHide: true,
				shell: process.platform === 'win32' && command.endsWith('.cmd'),
				timeout: 15000,
				maxBuffer: 1024 * 1024,
			}, (error, stdout, stderr) => {
				if (error) {
					reject(Object.assign(new Error('Codex CLI feature command failed: ' + (stderr.trim() || error.message)), { code: error.code }));
					return;
				}
				resolve(stdout);
			});
		});
		try {
			return await execute(process.platform === 'win32' ? 'codex.exe' : 'codex');
		} catch (error) {
			if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
				return await execute('codex.cmd');
			}
			throw error;
		}
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
}

export function listHookDiagnostics(
	configPath: string = resolveCodexPaths().configPath,
	homeDir: string = os.homedir(),
	workspaceRoot: string | undefined = getWorkspaceRoot(),
): HookDiagnosticsSnapshot {
	const hooksEnabled = readConfiguredFeatureFlags(configPath).get('hooks') ?? true;
	const trustedDirectories = listTrustedDirectories(configPath);
	const projectTrusted = workspaceRoot
		? trustedDirectories.some(
				(directory) => path.resolve(directory.path) === path.resolve(workspaceRoot),
			)
		: false;
	const userCodexDir = resolveCodexPaths(homeDir).codexDir;

	const layers: Array<{
		layer: 'user' | 'project';
		configPath: string;
		hooksJsonPath: string;
		active: boolean;
	}> = [
		{
			layer: 'user',
			configPath: path.join(userCodexDir, 'config.toml'),
			hooksJsonPath: path.join(userCodexDir, 'hooks.json'),
			active: hooksEnabled,
		},
	];
	if (workspaceRoot) {
		layers.push({
			layer: 'project',
			configPath: path.join(workspaceRoot, '.codex', 'config.toml'),
			hooksJsonPath: path.join(workspaceRoot, '.codex', 'hooks.json'),
			active: hooksEnabled && projectTrusted,
		});
	}

	const warnings: string[] = [];
	const sources: HookSourceRecord[] = [];
	const entries: HookEntryRecord[] = [];

	for (const layer of layers) {
		const inlineGroups = parseInlineHooks(layer.configPath);
		const jsonGroups = parseHooksJson(layer.hooksJsonPath);
		if (inlineGroups.groups.length > 0 && jsonGroups.groups.length > 0) {
			warnings.push(
				messages.hooksWarningMergedSources(
					layer.layer === 'user'
						? messages.hooksLayerUser
						: messages.hooksLayerProject,
				),
			);
		}

		sources.push({
			id: `${layer.layer}:hooks.json`,
			layer: layer.layer,
			format: 'hooks.json',
			path: layer.hooksJsonPath,
			exists: fs.existsSync(layer.hooksJsonPath),
			active: layer.active,
			entryCount: countHookHandlers(jsonGroups.groups),
			warning: jsonGroups.error,
		});
		sources.push({
			id: `${layer.layer}:inline`,
			layer: layer.layer,
			format: 'inline',
			path: layer.configPath,
			exists: fs.existsSync(layer.configPath),
			active: layer.active,
			entryCount: countHookHandlers(inlineGroups.groups),
			warning: inlineGroups.error,
		});

		entries.push(
			...toHookEntries(layer.layer, 'hooks.json', layer.hooksJsonPath, layer.active, jsonGroups.groups),
			...toHookEntries(layer.layer, 'inline', layer.configPath, layer.active, inlineGroups.groups),
		);
	}

	if (!hooksEnabled) {
		warnings.unshift(messages.hooksWarningFeatureDisabled);
	}
	if (workspaceRoot && !projectTrusted) {
		warnings.push(messages.hooksWarningProjectUntrusted);
	}

	return {
		hooksEnabled,
		workspaceRoot,
		projectTrusted,
		sources,
		entries,
		warnings,
	};
}

export function createHooksJsonFile(targetPath: string): void {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	if (!fs.existsSync(targetPath)) {
		fs.writeFileSync(targetPath, `${JSON.stringify({ hooks: {} }, null, 2)}\n`, 'utf8');
	}
}

function readConfiguredFeatureFlags(configPath: string): Map<string, boolean> {
	if (!fs.existsSync(configPath)) {
		return new Map<string, boolean>();
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	const lines = contents.split(/\r?\n/);
	const configured = new Map<string, boolean>();
	let inFeatures = false;

	for (const line of lines) {
		if (/^\s*\[/.test(line)) {
			inFeatures = FEATURES_HEADER_PATTERN.test(line);
			continue;
		}
		if (!inFeatures) {
			continue;
		}
		const match = line.match(BOOLEAN_FEATURE_PATTERN);
		if (!match) {
			continue;
		}
		configured.set(match[1], match[2].toLowerCase() === 'true');
	}

	return configured;
}

function countHookHandlers(groups: ParsedHookGroup[]): number {
	return groups.reduce((total, group) => total + group.handlers.length, 0);
}

function toHookEntries(
	layer: 'user' | 'project',
	format: 'hooks.json' | 'inline',
	sourcePath: string,
	active: boolean,
	groups: ParsedHookGroup[],
): HookEntryRecord[] {
	return groups.flatMap((group, groupIndex) =>
		group.handlers.map((handler, handlerIndex) => ({
			id: `${layer}:${format}:${group.event}:${groupIndex}:${handlerIndex}`,
			layer,
			format,
			event: group.event,
			matcher: group.matcher,
			handlerType: handler.type,
			command: handler.command,
			timeout: handler.timeout,
			statusMessage: handler.statusMessage,
			active,
			supported: handler.type === 'command',
			sourcePath,
			warning:
				handler.type !== 'command'
					? messages.hooksWarningUnsupportedHandler
					: undefined,
		})),
	);
}

function parseHooksJson(filePath: string): {
	groups: ParsedHookGroup[];
	error?: string;
} {
	if (!fs.existsSync(filePath)) {
		return { groups: [] };
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
			hooks?: Partial<Record<HookEventName, Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>>>;
		};
		const groups: ParsedHookGroup[] = [];
		for (const event of HOOK_EVENTS) {
			for (const group of parsed.hooks?.[event] ?? []) {
				groups.push({
					event,
					matcher: typeof group.matcher === 'string' ? group.matcher : undefined,
					handlers: (group.hooks ?? []).map((handler) => ({
						type: typeof handler.type === 'string' ? handler.type : 'unknown',
						command: typeof handler.command === 'string' ? handler.command : undefined,
						timeout:
							typeof handler.timeout === 'number'
								? handler.timeout
								: typeof handler.timeout === 'string'
									? Number(handler.timeout)
									: undefined,
						statusMessage:
							typeof handler.statusMessage === 'string'
								? handler.statusMessage
								: undefined,
					})),
				});
			}
		}
		return { groups };
	} catch (error) {
		return {
			groups: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function parseInlineHooks(filePath: string): {
	groups: ParsedHookGroup[];
	error?: string;
} {
	if (!fs.existsSync(filePath)) {
		return { groups: [] };
	}
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const groups: ParsedHookGroup[] = [];
	let currentGroup: ParsedHookGroup | undefined;
	let currentHandler:
		| {
				type: string;
				command?: string;
				timeout?: number;
				statusMessage?: string;
		  }
		| undefined;

	for (const line of lines) {
		const groupMatch = line.match(/^\s*\[\[hooks\.(SessionStart|PreToolUse|PermissionRequest|PostToolUse|UserPromptSubmit|Stop)\]\]\s*$/);
		if (groupMatch) {
			currentGroup = {
				event: groupMatch[1] as HookEventName,
				handlers: [],
			};
			groups.push(currentGroup);
			currentHandler = undefined;
			continue;
		}

		const handlerMatch = line.match(/^\s*\[\[hooks\.(SessionStart|PreToolUse|PermissionRequest|PostToolUse|UserPromptSubmit|Stop)\.hooks\]\]\s*$/);
		if (handlerMatch) {
			if (!currentGroup || currentGroup.event !== handlerMatch[1]) {
				currentGroup = {
					event: handlerMatch[1] as HookEventName,
					handlers: [],
				};
				groups.push(currentGroup);
			}
			currentHandler = { type: 'unknown' };
			currentGroup.handlers.push(currentHandler);
			continue;
		}

		const keyValueMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:#.*)?$/);
		if (!keyValueMatch) {
			continue;
		}
		const key = keyValueMatch[1];
		const value = parseTomlScalar(keyValueMatch[2]);
		if (currentHandler) {
			if (key === 'type' && typeof value === 'string') {
				currentHandler.type = value;
			}
			if (key === 'command' && typeof value === 'string') {
				currentHandler.command = value;
			}
			if (key === 'timeout' && typeof value === 'number') {
				currentHandler.timeout = value;
			}
			if (key === 'statusMessage' && typeof value === 'string') {
				currentHandler.statusMessage = value;
			}
			continue;
		}
		if (currentGroup && key === 'matcher' && typeof value === 'string') {
			currentGroup.matcher = value;
		}
	}

	return { groups };
}

function parseTomlScalar(rawValue: string): string | number | boolean | undefined {
	const value = rawValue.trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	if (value === 'true' || value === 'false') {
		return value === 'true';
	}
	const numeric = Number(value);
	if (!Number.isNaN(numeric)) {
		return numeric;
	}
	return undefined;
}
