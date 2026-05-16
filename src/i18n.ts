import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

type MessageBundle = Record<string, string>;

let cachedBundle: MessageBundle | null = null;

function loadBundle(): MessageBundle {
	if (cachedBundle) {
		return cachedBundle;
	}

	const language = (vscode.env.language ?? 'en').toLowerCase();
	const extensionRoot = path.resolve(__dirname, '..');
	const candidates = language.startsWith('ja')
		? ['package.nls.ja.json', 'package.nls.json']
		: ['package.nls.json'];

	for (const fileName of candidates) {
		try {
			const bundlePath = path.join(extensionRoot, fileName);
			const contents = fs.readFileSync(bundlePath, 'utf8');
			cachedBundle = JSON.parse(contents) as MessageBundle;
			return cachedBundle;
		} catch {
			// ignore and try next candidate
		}
	}

	cachedBundle = {};
	return cachedBundle;
}

function localize(
	key: string,
	fallback: string,
	...args: string[]
): string {
	const bundle = loadBundle();
	const template = bundle[key] ?? fallback;
	if (args.length === 0) {
		return template;
	}
	return template.replace(/\{(\d+)\}/g, (match, index) => {
		const argIndex = Number(index);
		if (Number.isNaN(argIndex) || args[argIndex] === undefined) {
			return match;
		}
		return args[argIndex];
	});
}

export const messages = {
	selectionRequired: localize(
		'message.selectionRequired',
		'Please select a target.',
	),
	unavailablePrefix: localize(
		'message.unavailablePrefix',
		'? Unable to open Codex Workspace: ',
	),
	unavailableUnknown: localize(
		'message.unavailableUnknown',
		'Unknown reason.',
	),
	reasonCodexMissing: localize(
		'message.reason.codexMissing',
		'.codex does not exist.',
	),
	reasonConfigMissing: localize(
		'message.reason.configMissing',
		'config.toml does not exist.',
	),
	reasonConfigUnreadable: localize(
		'message.reason.configUnreadable',
		'config.toml cannot be read.',
	),
	reasonConfigInvalid: localize(
		'message.reason.configInvalid',
		'config.toml cannot be parsed.',
	),
	openFolderMissing: localize(
		'message.openFolderMissing',
		'Target folder does not exist.',
	),
	unexpectedError: localize(
		'message.unexpectedError',
		'An unexpected error occurred.',
	),
	mcpToggleUpdated: localize(
		'message.mcpToggleUpdated',
		'Settings updated. Please restart Codex to apply changes.',
	),
	pluginToggleUpdated: localize(
		'message.pluginToggleUpdated',
		'Plugin settings updated. Please restart Codex to apply changes.',
	),
	pluginsTab: localize('message.pluginsTab', 'Plugins'),
	pluginsSearchPlaceholder: localize(
		'message.pluginsSearchPlaceholder',
		'Search plugins',
	),
	pluginsNoResult: localize(
		'message.pluginsNoResult',
		'No plugins found.',
	),
	pluginsSelectPlaceholder: localize(
		'message.pluginsSelectPlaceholder',
		'Select a plugin to view details.',
	),
	pluginStatusEnabled: localize('message.pluginStatusEnabled', 'Enabled'),
	pluginStatusDisabled: localize('message.pluginStatusDisabled', 'Disabled'),
	pluginStatusReadonly: localize('message.pluginStatusReadonly', 'Read only'),
	pluginStatusNeedsReview: localize(
		'message.pluginStatusNeedsReview',
		'Needs review',
	),
	pluginReadonlyTooltip: localize(
		'message.pluginReadonlyTooltip',
		'Managed by the parent plugin. Individual feature toggles are not available in this release.',
	),
	pluginSkillBadge: localize('message.pluginSkillBadge', 'Plugin Skill'),
	pluginMcpBadge: localize('message.pluginMcpBadge', 'Plugin MCP'),
	pluginAppBadge: localize('message.pluginAppBadge', 'Plugin App'),
	pluginAgentBadge: localize('message.pluginAgentBadge', 'Plugin Agent'),
	pluginSkillsSection: localize('message.pluginSkillsSection', 'Plugin Skills'),
	pluginMcpSection: localize('message.pluginMcpSection', 'Plugin MCP'),
	pluginAgentsSection: localize('message.pluginAgentsSection', 'Plugin Agents'),
	pluginOpenManifest: localize('message.pluginOpenManifest', 'Open manifest'),
	pluginOpenFolder: localize('message.pluginOpenFolder', 'Open plugin folder'),
	pluginCacheEditWarning: localize(
		'message.pluginCacheEditWarning',
		'Plugin cache files may be overwritten by reinstall or upgrade.',
	),
	configTomlOrganized: (backupPath: string) =>
		localize(
			'message.configTomlOrganized',
			'config.toml was organized. Backup saved to {0}.',
			backupPath,
		),
	configTomlAlreadyOrganized: (backupPath: string) =>
		localize(
			'message.configTomlAlreadyOrganized',
			'config.toml was already organized. Backup saved to {0}.',
			backupPath,
		),
	configTomlOrganizeBackupFailed: localize(
		'message.configTomlOrganizeBackupFailed',
		'Could not create a config.toml backup, so the organize operation was cancelled.',
	),
	commandRefresh: localize('command.refresh', 'Refresh'),
	syncConfirm: (targetPath: string) =>
		localize(
			'message.syncConfirm',
			'Sync files with "{0}"?',
			targetPath,
		),
	syncSkipped: (count: number) =>
		localize(
			'message.syncSkipped',
			'Skipped {0} files due to sync errors.',
			String(count),
		),
	historyPanelTitle: localize(
		'message.historyPanelTitle',
		'Codex History',
	),
	coreViewPanelTitle: localize(
		'message.coreViewPanelTitle',
		'Codex Manager',
	),
	coreViewConversationHistoryTab: localize(
		'message.coreViewConversationHistoryTab',
		'History',
	),
	coreViewFeatureFlagsTab: localize(
		'message.coreViewFeatureFlagsTab',
		'Feature Flags',
	),
	coreViewHooksTab: localize(
		'message.coreViewHooksTab',
		'Hooks',
	),
	skillManagerTitle: localize(
		'message.skillManagerTitle',
		'Skill Manager',
	),
	skillManagerSearchPlaceholder: localize(
		'message.skillManagerSearchPlaceholder',
		'Search skills',
	),
	skillManagerOpen: localize('message.skillManagerOpen', 'Open'),
	skillManagerNoResult: localize(
		'message.skillManagerNoResult',
		'No skills found.',
	),
	agentManagerTitle: localize(
		'message.agentManagerTitle',
		'AGENTS Manager',
	),
	agentManagerSearchPlaceholder: localize(
		'message.agentManagerSearchPlaceholder',
		'Search agents',
	),
	agentManagerOpen: localize('message.agentManagerOpen', 'Open'),
	agentManagerNoResult: localize(
		'message.agentManagerNoResult',
		'No agents found.',
	),
	agentManagerOverwritten: (agentName: string) =>
		localize(
			'message.agentManagerOverwritten',
			'[agents.{0}] was overwritten with the disabled definition.',
			agentName,
		),
	mcpManagerTitle: localize('message.mcpManagerTitle', 'MCP Manager'),
	mcpManagerSearchPlaceholder: localize(
		'message.mcpManagerSearchPlaceholder',
		'Search MCP servers',
	),
	mcpManagerNoResult: localize(
		'message.mcpManagerNoResult',
		'No MCP servers found.',
	),
	mcpManagerAdd: localize('message.mcpManagerAdd', 'Add'),
	mcpManagerDelete: localize('message.mcpManagerDelete', 'Delete'),
	mcpManagerSave: localize('message.mcpManagerSave', 'Save'),
	mcpManagerCancel: localize('message.mcpManagerCancel', 'Cancel'),
	mcpManagerServerName: localize(
		'message.mcpManagerServerName',
		'Server name',
	),
	mcpManagerTransportLabel: localize(
		'message.mcpManagerTransportLabel',
		'Transport',
	),
	mcpManagerCommandLabel: localize(
		'message.mcpManagerCommandLabel',
		'Command',
	),
	mcpManagerArgsLabel: localize('message.mcpManagerArgsLabel', 'Args'),
	mcpManagerUrlLabel: localize('message.mcpManagerUrlLabel', 'URL'),
	mcpManagerEnvLabel: localize('message.mcpManagerEnvLabel', 'Env'),
	mcpManagerHttpHeadersLabel: localize(
		'message.mcpManagerHttpHeadersLabel',
		'HTTP Headers',
	),
	mcpManagerEnvHttpHeadersLabel: localize(
		'message.mcpManagerEnvHttpHeadersLabel',
		'Env HTTP Headers',
	),
	mcpManagerToolsLabel: localize('message.mcpManagerToolsLabel', 'Tools'),
	mcpManagerRequiredLabel: localize(
		'message.mcpManagerRequiredLabel',
		'Required',
	),
	mcpManagerStartupTimeoutLabel: localize(
		'message.mcpManagerStartupTimeoutLabel',
		'Startup Timeout',
	),
	mcpManagerToolTimeoutLabel: localize(
		'message.mcpManagerToolTimeoutLabel',
		'Tool Timeout',
	),
	mcpManagerEnabledToolsLabel: localize(
		'message.mcpManagerEnabledToolsLabel',
		'Enabled Tools',
	),
	mcpManagerDisabledToolsLabel: localize(
		'message.mcpManagerDisabledToolsLabel',
		'Disabled Tools',
	),
	mcpManagerAddEnv: localize('message.mcpManagerAddEnv', 'Add env'),
	mcpManagerRemoveEnv: localize(
		'message.mcpManagerRemoveEnv',
		'Remove env',
	),
	mcpManagerEnvKeyPlaceholder: localize(
		'message.mcpManagerEnvKeyPlaceholder',
		'KEY',
	),
	mcpManagerEnvValuePlaceholder: localize(
		'message.mcpManagerEnvValuePlaceholder',
		'value',
	),
	mcpManagerToolNamePlaceholder: localize(
		'message.mcpManagerToolNamePlaceholder',
		'tool-name',
	),
	mcpManagerToolEnabledDefault: localize(
		'message.mcpManagerToolEnabledDefault',
		'Enabled: default',
	),
	mcpManagerToolEnabledTrue: localize(
		'message.mcpManagerToolEnabledTrue',
		'Enabled: true',
	),
	mcpManagerToolEnabledFalse: localize(
		'message.mcpManagerToolEnabledFalse',
		'Enabled: false',
	),
	mcpManagerToolApprovalDefault: localize(
		'message.mcpManagerToolApprovalDefault',
		'Approval: default',
	),
	mcpManagerToggle: localize('message.mcpManagerToggle', 'Toggle'),
	mcpManagerDescriptionServerName: localize(
		'message.mcpManagerDescriptionServerName',
		'Unique server name under [mcp_servers.<name>].',
	),
	mcpManagerDescriptionTransport: localize(
		'message.mcpManagerDescriptionTransport',
		'Connection type. Use stdio for command based servers, http for URL based servers.',
	),
	mcpManagerDescriptionCommand: localize(
		'message.mcpManagerDescriptionCommand',
		'Command to launch a stdio MCP server. Leave empty for http servers.',
	),
	mcpManagerDescriptionArgs: localize(
		'message.mcpManagerDescriptionArgs',
		'Command arguments for stdio servers. Enter one item per line.',
	),
	mcpManagerDescriptionUrl: localize(
		'message.mcpManagerDescriptionUrl',
		'HTTP MCP server URL. Leave empty for stdio servers.',
	),
	mcpManagerDescriptionEnv: localize(
		'message.mcpManagerDescriptionEnv',
		'Environment variables passed to the MCP server. Enter key and value pairs.',
	),
	mcpManagerDescriptionHttpHeaders: localize(
		'message.mcpManagerDescriptionHttpHeaders',
		'Static HTTP headers sent to the MCP server. Enter header names and values.',
	),
	mcpManagerDescriptionEnvHttpHeaders: localize(
		'message.mcpManagerDescriptionEnvHttpHeaders',
		'HTTP header mappings whose values are read from environment variables. Enter header names and environment variable names.',
	),
	mcpManagerDescriptionTools: localize(
		'message.mcpManagerDescriptionTools',
		'Per-tool settings. Each row can override enabled and approval_mode for one tool.',
	),
	mcpManagerDescriptionRequired: localize(
		'message.mcpManagerDescriptionRequired',
		'Whether Codex should treat this MCP server as required.',
	),
	mcpManagerDescriptionStartupTimeout: localize(
		'message.mcpManagerDescriptionStartupTimeout',
		'Startup timeout in seconds. Use a non-negative number.',
	),
	mcpManagerDescriptionToolTimeout: localize(
		'message.mcpManagerDescriptionToolTimeout',
		'Tool execution timeout in seconds. Use a non-negative number.',
	),
	mcpManagerDescriptionEnabledTools: localize(
		'message.mcpManagerDescriptionEnabledTools',
		'Allow only these tools. Enter one tool name per line. Do not combine with Disabled Tools.',
	),
	mcpManagerDescriptionDisabledTools: localize(
		'message.mcpManagerDescriptionDisabledTools',
		'Disable these tools. Enter one tool name per line. Do not combine with Enabled Tools.',
	),
	mcpManagerDeleteConfirm: (serverId: string) =>
		localize(
			'message.mcpManagerDeleteConfirm',
			'Delete MCP server [mcp_servers.{0}]?',
			serverId,
		),
	mcpToggleAction: localize('message.mcpToggleAction', 'Toggle MCP'),
	mcpValidationServerNameRequired: localize(
		'message.mcpValidationServerNameRequired',
		'Server name is required.',
	),
	mcpValidationServerNameDuplicate: localize(
		'message.mcpValidationServerNameDuplicate',
		'An MCP server with the same name already exists.',
	),
	mcpValidationTransportRequired: localize(
		'message.mcpValidationTransportRequired',
		'Transport must be stdio or http.',
	),
	mcpValidationCommandRequired: localize(
		'message.mcpValidationCommandRequired',
		'Command is required for stdio transport.',
	),
	mcpValidationUrlRequired: localize(
		'message.mcpValidationUrlRequired',
		'URL is required for http transport.',
	),
	mcpValidationTimeoutInvalid: localize(
		'message.mcpValidationTimeoutInvalid',
		'Timeout must be a non-negative number.',
	),
	mcpValidationToolsMutuallyExclusive: localize(
		'message.mcpValidationToolsMutuallyExclusive',
		'enabled_tools and disabled_tools cannot be set at the same time.',
	),
	mcpValidationEnvKeyRequired: localize(
		'message.mcpValidationEnvKeyRequired',
		'Env rows with a value must also have a key.',
	),
	mcpValidationEnvKeyInvalid: localize(
		'message.mcpValidationEnvKeyInvalid',
		'Env keys must start with a letter or underscore and use only letters, numbers, and underscores.',
	),
	mcpValidationEnvKeyDuplicate: localize(
		'message.mcpValidationEnvKeyDuplicate',
		'Env keys must be unique.',
	),
	mcpValidationToolNameRequired: localize(
		'message.mcpValidationToolNameRequired',
		'Tool rows with settings must also have a tool name.',
	),
	mcpValidationToolApprovalModeInvalid: localize(
		'message.mcpValidationToolApprovalModeInvalid',
		'Tool approval_mode must be auto, prompt, or approve.',
	),
	coreViewAgentsChainTab: localize(
		'message.coreViewAgentsChainTab',
		'AGENTS Loading Chain',
	),
	chainCurrentSection: localize(
		'message.chainCurrentSection',
		'Current',
	),
	chainIgnoredSection: localize(
		'message.chainIgnoredSection',
		'Ignored',
	),
	chainProblemsSection: localize(
		'message.chainProblemsSection',
		'Needs attention',
	),
	chainDetailsSection: localize(
		'message.chainDetailsSection',
		'Detailed candidates',
	),
	chainToggleDetails: localize(
		'message.chainToggleDetails',
		'Show detailed candidates',
	),
	chainSummaryCurrent: localize(
		'message.chainSummaryCurrent',
		'Using',
	),
	chainSummaryIgnored: localize(
		'message.chainSummaryIgnored',
		'Ignored',
	),
	chainSummaryProblems: localize(
		'message.chainSummaryProblems',
		'Problems',
	),
	chainSummaryHidden: localize(
		'message.chainSummaryHidden',
		'Hidden candidates',
	),
	chainWorkspaceRootLabel: localize(
		'message.chainWorkspaceRootLabel',
		'Workspace root',
	),
	coreViewTabsAriaLabel: localize(
		'message.coreViewTabsAriaLabel',
		'Codex Manager tabs',
	),
	chainNoWorkspace: localize(
		'message.chainNoWorkspace',
		'Open a workspace folder to view the AGENTS loading chain.',
	),
	chainPreviewEmpty: localize(
		'message.chainPreviewEmpty',
		'Select an item on the left to view details.',
	),
	chainStatusCurrent: localize(
		'message.chainStatusCurrent',
		'Using',
	),
	chainStatusIgnored: localize(
		'message.chainStatusIgnored',
		'Ignored',
	),
	chainStatusProblem: localize(
		'message.chainStatusProblem',
		'Problem',
	),
	chainStatusMissing: localize(
		'message.chainStatusMissing',
		'Missing',
	),
	chainDetailStatus: localize(
		'message.chainDetailStatus',
		'Status',
	),
	chainDetailClassification: localize(
		'message.chainDetailClassification',
		'Classification',
	),
	chainDetailPath: localize(
		'message.chainDetailPath',
		'Path',
	),
	chainDetailExplanation: localize(
		'message.chainDetailExplanation',
		'Explanation',
	),
	chainExplainCurrent: (layer: string, fileName: string) =>
		localize(
			'message.chainExplainCurrent',
			'{0} layer is currently using {1}.',
			layer,
			fileName,
		),
	chainExplainIgnoredPreferred: (preferred: string) =>
		localize(
			'message.chainExplainIgnoredPreferred',
			'{0} has higher priority, so this file is not used.',
			preferred,
		),
	chainExplainIgnoredGeneric: localize(
		'message.chainExplainIgnoredGeneric',
		'A higher-priority candidate exists, so this file is not used.',
	),
	chainExplainProblem: (reason: string) =>
		localize(
			'message.chainExplainProblem',
			'The file exists but could not be read. {0}',
			reason,
		),
	chainExplainMissingFallback: localize(
		'message.chainExplainMissingFallback',
		'This fallback candidate is configured but the file does not exist.',
	),
	chainExplainMissingGeneric: localize(
		'message.chainExplainMissingGeneric',
		'This candidate was checked, but the file does not exist.',
	),
	coreViewTrustedDirectoriesTab: localize(
		'message.coreViewTrustedDirectoriesTab',
		'Trusted Directory',
	),
	featureFlagSourceDefault: localize(
		'message.featureFlagSourceDefault',
		'Default',
	),
	featureFlagSourceConfig: localize(
		'message.featureFlagSourceConfig',
		'Configured',
	),
	featureFlagDefaultLabel: localize(
		'message.featureFlagDefaultLabel',
		'Default',
	),
	featureFlagEffectiveLabel: localize(
		'message.featureFlagEffectiveLabel',
		'Effective',
	),
	featureFlagDescriptionApps: localize(
		'message.featureFlagDescriptionApps',
		'Enable ChatGPT Apps and connectors support.',
	),
	featureFlagDescriptionBrowserUse: localize(
		'message.featureFlagDescriptionBrowserUse',
		'Enable browser automation support in Codex.',
	),
	featureFlagDescriptionCodexHooks: localize(
		'message.featureFlagDescriptionCodexHooks',
		'Enable lifecycle hooks from hooks.json or inline [hooks].',
	),
	featureFlagDescriptionHooks: localize(
		'message.featureFlagDescriptionHooks',
		'Enable lifecycle hooks from hooks.json or inline [hooks].',
	),
	featureFlagDescriptionFastMode: localize(
		'message.featureFlagDescriptionFastMode',
		'Enable Fast mode selection and the service_tier = "fast" path.',
	),
	featureFlagDescriptionMemories: localize(
		'message.featureFlagDescriptionMemories',
		'Enable Memories.',
	),
	featureFlagDescriptionMultiAgent: localize(
		'message.featureFlagDescriptionMultiAgent',
		'Enable subagent collaboration tools.',
	),
	featureFlagDescriptionPersonality: localize(
		'message.featureFlagDescriptionPersonality',
		'Enable personality selection controls.',
	),
	featureFlagDescriptionShellSnapshot: localize(
		'message.featureFlagDescriptionShellSnapshot',
		'Snapshot the shell environment to speed up repeated commands.',
	),
	featureFlagDescriptionShellTool: localize(
		'message.featureFlagDescriptionShellTool',
		'Enable the default shell tool.',
	),
	featureFlagDescriptionUnifiedExec: localize(
		'message.featureFlagDescriptionUnifiedExec',
		'Use the unified PTY-backed exec tool.',
	),
	featureFlagDescriptionWorkspaceDependencies: localize(
		'message.featureFlagDescriptionWorkspaceDependencies',
		'Allow Codex to use workspace dependency metadata during task execution.',
	),
	featureFlagDescriptionUndo: localize(
		'message.featureFlagDescriptionUndo',
		'Enable undo via per-turn git ghost snapshots.',
	),
	featureFlagDescriptionWebSearchCached: localize(
		'message.featureFlagDescriptionWebSearchCached',
		'Legacy toggle that maps to web_search = "cached".',
	),
	featureFlagDescriptionWebSearchRequest: localize(
		'message.featureFlagDescriptionWebSearchRequest',
		'Legacy toggle that maps to web_search = "live".',
	),
	featureFlagDescriptionGeneric: (key: string) =>
		localize(
			'message.featureFlagDescriptionGeneric',
			'Codex CLI feature flag: {0}.',
			key,
		),
	hooksEnableFeature: localize(
		'message.hooksEnableFeature',
		'Enable hooks feature',
	),
	hooksLayerUser: localize('message.hooksLayerUser', 'User'),
	hooksLayerProject: localize('message.hooksLayerProject', 'Project'),
	hooksActive: localize('message.hooksActive', 'Active'),
	hooksInactive: localize('message.hooksInactive', 'Inactive'),
	hooksEntryCount: (count: number) =>
		localize('message.hooksEntryCount', '{0} entries', count.toString()),
	hooksOpenSource: localize('message.hooksOpenSource', 'Open source'),
	hooksCreateFile: localize('message.hooksCreateFile', 'Create hooks.json'),
	hooksCreateConfigFile: localize(
		'message.hooksCreateConfigFile',
		'Create config.toml',
	),
	hooksNoCommand: localize(
		'message.hooksNoCommand',
		'No command is configured for this handler.',
	),
	hooksMatcherLabel: localize('message.hooksMatcherLabel', 'Matcher'),
	hooksMatcherNotUsed: localize(
		'message.hooksMatcherNotUsed',
		'Not specified',
	),
	hooksTypeLabel: localize('message.hooksTypeLabel', 'Type'),
	hooksTimeoutLabel: localize('message.hooksTimeoutLabel', 'Timeout'),
	hooksStatusMessageLabel: localize(
		'message.hooksStatusMessageLabel',
		'Status message',
	),
	hooksFeatureStatus: (status: string) =>
		localize('message.hooksFeatureStatus', 'Hooks feature: {0}', status),
	hooksProjectTrustLabel: localize(
		'message.hooksProjectTrustLabel',
		'Project hooks',
	),
	hooksSourcesHeading: localize(
		'message.hooksSourcesHeading',
		'Hook sources',
	),
	hooksEntriesHeading: localize(
		'message.hooksEntriesHeading',
		'Hook entries',
	),
	hooksNoEntries: localize(
		'message.hooksNoEntries',
		'No hook entries were found in the active layers.',
	),
	hooksWarningMergedSources: (layer: string) =>
		localize(
			'message.hooksWarningMergedSources',
			'{0} layer has both hooks.json and inline hooks. Codex merges them and warns at startup.',
			layer,
		),
	hooksWarningFeatureDisabled: localize(
		'message.hooksWarningFeatureDisabled',
		'Hooks are disabled because features.codex_hooks is false.',
	),
	hooksWarningProjectUntrusted: localize(
		'message.hooksWarningProjectUntrusted',
		'Project-local hooks are inactive until this workspace is trusted.',
	),
	hooksWarningUnsupportedHandler: localize(
		'message.hooksWarningUnsupportedHandler',
		'Only command hook handlers are currently executed by Codex.',
	),
	trustedDirectoryDeleteConfirm: (targetPath: string) =>
		localize(
			'message.trustedDirectoryDeleteConfirm',
			'Remove trusted directory [{0}]?',
			targetPath,
		),
	historyPanelPlaceholder: localize(
		'message.historyPanelPlaceholder',
		'Conversation history view is ready.',
	),
	historySearchPlaceholder: localize(
		'message.historySearchPlaceholder',
		'Search',
	),
	historySearch: localize('message.historySearch', 'Search'),
	historyClear: localize('message.historyClear', 'Clear'),
	historyNoResult: localize(
		'message.historyNoResult',
		'No sessions found.',
	),
	historyNoPreview: localize(
		'message.historyNoPreview',
		'Select a session card to preview the conversation.',
	),
	historyCopy: localize('message.historyCopy', 'Copy'),
	historyCopied: localize('message.historyCopied', 'Copied to clipboard.'),
	historyUserLabel: localize('message.historyUserLabel', 'User'),
	historyAssistantLabel: localize(
		'message.historyAssistantLabel',
		'Assistant',
	),
	helloWorld: localize(
		'message.helloWorld',
		'Hello World from Codex Workspace!',
	),
	dialogOk: localize('message.dialogOk', 'OK'),
	file: {
		inputFileName: localize('message.inputFileName', 'Enter a file name.'),
		skillFileNamePlaceholder: localize(
			'message.skillFileNamePlaceholder',
			'Enter a file name. Leave blank to create SKILL.md.',
		),
		inputFolderName: localize(
			'message.inputFolderName',
			'Enter a folder name.',
		),
		inputRenameName: localize(
			'message.inputRenameName',
			'Enter a new name.',
		),
		invalidName: localize(
			'message.invalidName',
			'Please enter a valid name.',
		),
		renameRootNotAllowed: localize(
			'message.renameRootNotAllowed',
			'Root folders cannot be renamed.',
		),
		renameFolderExists: localize(
			'message.renameFolderExists',
			'A folder with the same name already exists.',
		),
		deleteFileConfirm: localize(
			'message.deleteFileConfirm',
			'Are you sure you want to delete this file?',
		),
		deleteFolderConfirm: localize(
			'message.deleteFolderConfirm',
			'Are you sure you want to delete this folder and its contents?',
		),
		deleteRootNotAllowed: localize(
			'message.deleteRootNotAllowed',
			'Root folders cannot be deleted.',
		),
		overwriteFileConfirm: localize(
			'message.overwriteFileConfirm',
			'Overwrite the file? The existing file will be deleted.',
		),
		overwrite: localize('message.overwrite', 'Overwrite'),
		fileExistsUseDifferentName: (originalName: string, suggestedName: string) =>
			localize(
				'message.fileExistsUseDifferentName',
				'A file named "{0}" already exists here. Rename "{0}" to "{1}"?',
				originalName,
				suggestedName,
			),
		useDifferentName: localize(
			'message.useDifferentName',
			'Use a different name (_1)',
		),
		cancel: localize('message.cancel', 'Cancel'),
		templateNone: localize('message.templateNone', 'Empty file'),
		templatePickPlaceholder: localize(
			'message.templatePickPlaceholder',
			'Select a template.',
		),
		skillLocationPickPlaceholder: localize(
			'message.skillLocationPickPlaceholder',
			'Select a Skill location.',
		),
		skillFileFolderRequired: localize(
			'message.skillFileFolderRequired',
			'Select a folder in Skills before adding a file.',
		),
		skillSubfolderPickPlaceholder: localize(
			'message.skillSubfolderPickPlaceholder',
			'Select a Skill subfolder to add.',
		),
		userSkillsDeleteWarning: localize(
			'message.userSkillsDeleteWarning',
			'Deleting User Skills may affect other projects.',
		),
		selectionNotSupported: localize(
			'message.selectionNotSupported',
			'Select a target in prompts, skills, or templates.',
		),
	},
	agent: {
		inputName: localize(
			'message.agent.inputName',
			'Enter an agent name.',
		),
		inputDescription: localize(
			'message.agent.inputDescription',
			'Enter an agent description.',
		),
		invalidName: localize(
			'message.agent.invalidName',
			'Please enter a valid agent name.',
		),
		fileExists: (agentName: string) =>
			localize(
				'message.agent.fileExists',
				'An agent named "{0}" already exists.',
				agentName,
			),
		configExists: (agentName: string) =>
			localize(
				'message.agent.configExists',
				'config.toml already has [agents.{0}].',
				agentName,
			),
		notEnabled: (agentName: string) =>
			localize(
				'message.agent.notEnabled',
				'Agent "{0}" is already disabled or missing in config.toml.',
				agentName,
			),
		toggleUpdated: localize(
			'message.agent.toggleUpdated',
			'Agent settings updated. Please restart Codex to apply changes.',
		),
		deleteConfirm: (agentName: string) =>
			localize(
				'message.agent.deleteConfirm',
				'Are you sure you want to delete agent "{0}"?',
				agentName,
			),
		locationPickPlaceholder: localize(
			'message.agent.locationPickPlaceholder',
			'Select an Agent location.',
		),
		userAgentsDeleteWarning: localize(
			'message.agent.userAgentsDeleteWarning',
			'Deleting User Agents may affect other projects.',
		),
		selectionNotSupported: localize(
			'message.agent.selectionNotSupported',
			'Select an agent file in the Agents view.',
		),
	},
};
