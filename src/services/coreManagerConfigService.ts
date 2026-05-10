import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { messages } from '../i18n';
import { listTrustedDirectories } from './coreDiagnosticsService';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';
import { resolveCodexPaths } from './workspaceStatus';

export type FeatureFlagRecord = {
	key: string;
	enabled: boolean;
	configuredValue?: boolean;
	defaultEnabled: boolean;
	maturity:
		| 'Stable'
		| 'Experimental'
		| 'Deprecated'
		| 'Under development'
		| 'Removed';
	maturityClass:
		| 'stable'
		| 'experimental'
		| 'deprecated'
		| 'under-development'
		| 'removed';
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

type FeatureFlagDefinition = {
	key: string;
	defaultEnabled: boolean;
	maturity: FeatureFlagRecord['maturity'];
	getDescription: () => string;
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

function defineFeature(
	key: string,
	defaultEnabled: boolean,
	maturity: FeatureFlagRecord['maturity'],
): FeatureFlagDefinition {
	return {
		key,
		defaultEnabled,
		maturity,
		getDescription: () => getFeatureFlagDescription(key),
	};
}

const FEATURE_DEFINITIONS: FeatureFlagDefinition[] = [
	defineFeature('apply_patch_freeform', false, 'Under development'),
	defineFeature('apply_patch_streaming_events', false, 'Under development'),
	defineFeature('apps', true, 'Stable'),
	defineFeature('apps_mcp_path_override', false, 'Under development'),
	defineFeature('artifact', false, 'Under development'),
	defineFeature('auth_elicitation', false, 'Under development'),
	defineFeature('browser_use', true, 'Stable'),
	defineFeature('browser_use_external', true, 'Stable'),
	defineFeature('builtin_mcp', false, 'Under development'),
	defineFeature('child_agents_md', false, 'Under development'),
	defineFeature('chronicle', false, 'Under development'),
	defineFeature('code_mode', false, 'Under development'),
	defineFeature('code_mode_only', false, 'Under development'),
	defineFeature('codex_git_commit', false, 'Under development'),
	defineFeature('collaboration_modes', true, 'Removed'),
	defineFeature('computer_use', true, 'Stable'),
	defineFeature('default_mode_request_user_input', false, 'Under development'),
	defineFeature('elevated_windows_sandbox', false, 'Removed'),
	defineFeature('enable_fanout', false, 'Under development'),
	defineFeature('enable_mcp_apps', false, 'Under development'),
	defineFeature('enable_request_compression', true, 'Stable'),
	defineFeature('exec_permission_approvals', false, 'Under development'),
	defineFeature('experimental_windows_sandbox', false, 'Removed'),
	defineFeature('external_migration', false, 'Experimental'),
	defineFeature('fast_mode', true, 'Stable'),
	defineFeature('goals', false, 'Experimental'),
	defineFeature('guardian_approval', true, 'Stable'),
	defineFeature('hooks', true, 'Stable'),
	defineFeature('image_detail_original', false, 'Removed'),
	defineFeature('image_generation', true, 'Stable'),
	defineFeature('in_app_browser', true, 'Stable'),
	defineFeature('js_repl', false, 'Removed'),
	defineFeature('js_repl_tools_only', false, 'Removed'),
	defineFeature('memories', true, 'Experimental'),
	defineFeature('multi_agent', true, 'Stable'),
	defineFeature('multi_agent_v2', false, 'Under development'),
	defineFeature('personality', true, 'Stable'),
	defineFeature('plugin_hooks', false, 'Under development'),
	defineFeature('plugins', true, 'Stable'),
	defineFeature('prevent_idle_sleep', false, 'Experimental'),
	defineFeature('realtime_conversation', false, 'Under development'),
	defineFeature('remote_compaction_v2', false, 'Under development'),
	defineFeature('remote_control', false, 'Under development'),
	defineFeature('remote_models', false, 'Removed'),
	defineFeature('remote_plugin', false, 'Under development'),
	defineFeature('request_permissions_tool', false, 'Under development'),
	defineFeature('request_rule', false, 'Removed'),
	defineFeature('responses_websocket_response_processed', false, 'Under development'),
	defineFeature('responses_websockets', false, 'Removed'),
	defineFeature('responses_websockets_v2', false, 'Removed'),
	defineFeature('runtime_metrics', false, 'Under development'),
	defineFeature('search_tool', false, 'Removed'),
	defineFeature('shell_snapshot', true, 'Stable'),
	defineFeature('shell_tool', true, 'Stable'),
	defineFeature('shell_zsh_fork', false, 'Under development'),
	defineFeature('skill_env_var_dependency_prompt', false, 'Under development'),
	defineFeature('skill_mcp_dependency_install', true, 'Stable'),
	defineFeature('sqlite', true, 'Removed'),
	defineFeature('steer', true, 'Removed'),
	defineFeature('terminal_resize_reflow', true, 'Experimental'),
	defineFeature('tool_call_mcp_elicitation', true, 'Stable'),
	defineFeature('tool_search', true, 'Stable'),
	defineFeature('tool_search_always_defer_mcp_tools', false, 'Under development'),
	defineFeature('tool_suggest', true, 'Stable'),
	defineFeature('tui_app_server', true, 'Removed'),
	defineFeature('unavailable_dummy_tools', true, 'Stable'),
	defineFeature('undo', false, 'Removed'),
	defineFeature('unified_exec', false, 'Stable'),
	defineFeature('use_legacy_landlock', false, 'Deprecated'),
	defineFeature('use_linux_sandbox_bwrap', false, 'Removed'),
	defineFeature('web_search_cached', false, 'Deprecated'),
	defineFeature('web_search_request', false, 'Deprecated'),
	defineFeature('workspace_dependencies', true, 'Stable'),
	defineFeature('workspace_owner_usage_nudge', false, 'Under development'),
];

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

export function listFeatureFlagRecords(
	configPath: string = resolveCodexPaths().configPath,
): FeatureFlagRecord[] {
	const configured = readConfiguredFeatureFlags(configPath);
	return FEATURE_DEFINITIONS.map((definition) => {
		const configuredValue = configured.get(definition.key);
		return {
			key: definition.key,
			enabled: configuredValue ?? definition.defaultEnabled,
			configuredValue,
			defaultEnabled: definition.defaultEnabled,
			maturity: definition.maturity,
			maturityClass: definition.maturity.toLocaleLowerCase().replace(/\s+/g, '-') as FeatureFlagRecord['maturityClass'],
			description: definition.getDescription(),
		};
	});
}

export function setFeatureFlag(
	configPath: string,
	featureKey: string,
	enabled: boolean,
): void {
	const contents = fs.existsSync(configPath)
		? fs.readFileSync(configPath, 'utf8')
		: '';
	const lines = contents.split(/\r?\n/);
	let featuresHeaderIndex: number | undefined;
	let insertIndex = lines.length;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (FEATURES_HEADER_PATTERN.test(line)) {
			featuresHeaderIndex = index;
			insertIndex = lines.length;
			let lastFeatureLineIndex = index;
			for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
				if (/^\s*\[/.test(lines[cursor])) {
					insertIndex =
						lastFeatureLineIndex > index ? lastFeatureLineIndex + 1 : cursor;
					break;
				}
				const match = lines[cursor].match(BOOLEAN_FEATURE_PATTERN);
				if (match) {
					lastFeatureLineIndex = cursor;
				}
				if (match?.[1] === featureKey) {
					lines[cursor] = `${featureKey} = ${enabled ? 'true' : 'false'}${match[3] ?? ''}`;
					fs.writeFileSync(
						configPath,
						stabilizeManagedConfigToml(lines.join('\n')),
						'utf8',
					);
					return;
				}
			}
			if (insertIndex === lines.length && lastFeatureLineIndex > index) {
				insertIndex = lastFeatureLineIndex + 1;
			}
			break;
		}
	}

	if (featuresHeaderIndex === undefined) {
		const nextContents = `${contents.trimEnd()}${contents.trim().length > 0 ? '\n\n' : ''}[features]\n${featureKey} = ${enabled ? 'true' : 'false'}\n`;
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(nextContents),
			'utf8',
		);
		return;
	}

	lines.splice(insertIndex, 0, `${featureKey} = ${enabled ? 'true' : 'false'}`);
	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(lines.join('\n')),
		'utf8',
	);
}

export function listHookDiagnostics(
	configPath: string = resolveCodexPaths().configPath,
	homeDir: string = os.homedir(),
	workspaceRoot: string | undefined = getWorkspaceRoot(),
): HookDiagnosticsSnapshot {
	const featureFlags = listFeatureFlagRecords(configPath);
	const hooksEnabled = featureFlags.find((record) => record.key === 'hooks')?.enabled ?? true;
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
