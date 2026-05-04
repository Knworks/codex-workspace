import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { messages } from '../i18n';
import { getConfiguredMaxHistoryCount, getIncludeReasoningMessage } from './settings';
import { buildHistoryIndex, HistoryDayNode, HistoryIndex, HistoryTurnRecord } from './historyService';
import {
	AgentsChainNode,
	addTrustedDirectory,
	buildAgentsLoadingChain,
	listTrustedDirectories,
	removeTrustedDirectory,
} from './coreDiagnosticsService';
import {
	createHooksJsonFile,
	listFeatureFlagRecords,
	listHookDiagnostics,
	setFeatureFlag,
} from './coreManagerConfigService';
import { getCoreWorkspaceStatus, resolveCodexPaths } from './workspaceStatus';
import { CODICON_RESOURCE_ROOTS, getCodiconCssHref, getCodiconIconPath } from './webviewAssets';

const HISTORY_VIEW_TYPE = 'codex-workspace.coreView';
export const HISTORY_MESSAGE_PREVIEW_MAX_CHARS = 100;

type HistoryPanelInboundMessage =
	| { type: 'ready' }
	| { type: 'selectTurn'; turnId: string }
	| { type: 'search'; query: string }
	| { type: 'clearSearch' }
	| { type: 'copyText'; text: string }
	| { type: 'refreshTab'; tab: CoreViewTab }
	| { type: 'addTrustedDirectory' }
	| { type: 'removeTrustedDirectory'; targetPath: string }
	| { type: 'setFeatureFlag'; featureKey: string; enabled: boolean }
	| { type: 'openPath'; targetPath: string }
	| { type: 'createHooksFile'; targetPath: string }
	| { type: 'createEmptyFile'; targetPath: string };

type CoreViewTab = 'history' | 'chain' | 'trusted' | 'features' | 'hooks';

type HistoryTurnSummary = {
	turnId: string;
	userMessage: string;
	displayMessage: string;
	localTime: string;
};

type HistoryDayView = {
	dateKey: string;
	turns: HistoryTurnSummary[];
};

type HistorySelectedTurn = {
	turnId: string;
	localTime: string;
	userMessage: string;
	userMessageLocalTime: string;
	assistantMessages: string[];
	assistantMessageLocalTimes: string[];
	reasoningMessages: string[];
	reasoningMessageLocalTimes: string[];
	aiTimeline: Array<{
		kind: 'assistant' | 'reasoning';
		message: string;
		localTime: string;
		sortTimestampMs: number;
		sequence: number;
	}>;
};

type HistoryPanelViewModel = {
	appliedQuery: string;
	days: HistoryDayView[];
	selectedTurn?: HistorySelectedTurn;
};

type HistoryPanelState = {
	index: HistoryIndex;
	selectedTurnId?: string;
	appliedQuery: string;
	includeReasoningMessage: boolean;
};

type AgentsChainDisplaySection = 'current' | 'ignored' | 'problems' | 'details';

type AgentsChainDisplayEntry = {
	id: string;
	section: AgentsChainDisplaySection;
	title: string;
	subtitle: string;
	statusLabel: string;
	summary: string;
	path: string;
	explanation: string;
	contentPreview?: string;
	defaultVisible: boolean;
};

type AgentsChainDisplayPayload = {
	entries: AgentsChainDisplayEntry[];
	summary: {
		currentCount: number;
		ignoredCount: number;
		problemCount: number;
		hiddenCount: number;
	};
	workspaceRoot?: string;
	emptyStateMessage?: string;
};

function normalizeQuery(query: string): string {
	return query.trim();
}

function includesCaseInsensitive(text: string, query: string): boolean {
	if (!query) {
		return true;
	}
	return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function truncateMessage(message: string, maxChars: number): string {
	if (message.length <= maxChars) {
		return message;
	}
	return `${message.slice(0, maxChars)}...`;
}

function toTurnSummary(turn: HistoryTurnRecord): HistoryTurnSummary {
	return {
		turnId: turn.turnId,
		userMessage: turn.userMessage,
		displayMessage: truncateMessage(turn.userMessage, HISTORY_MESSAGE_PREVIEW_MAX_CHARS),
		localTime: turn.localTime,
	};
}

function toSelectedTurn(
	turn: HistoryTurnRecord | undefined,
	includeReasoningMessage: boolean,
): HistorySelectedTurn | undefined {
	if (!turn) {
		return undefined;
	}
	const assistantMessageLocalTimes =
		turn.agentMessageLocalTimes ?? turn.agentMessages.map(() => turn.localTime);
	const assistantMessageTimestampMs =
		turn.agentMessageTimestampMs ?? turn.agentMessages.map(() => turn.sortTimestampMs);
	const reasoningMessages = includeReasoningMessage ? turn.reasoningMessages : [];
	const reasoningMessageLocalTimes = includeReasoningMessage
		? (turn.reasoningMessageLocalTimes ??
			turn.reasoningMessages.map(() => turn.localTime))
		: [];
	const reasoningMessageTimestampMs = includeReasoningMessage
		? (turn.reasoningMessageTimestampMs ??
			turn.reasoningMessages.map(() => turn.sortTimestampMs))
		: [];
	const fallbackTimeline = [
		...turn.agentMessages.map((message, index) => ({
			kind: 'assistant' as const,
			message,
			localTime: assistantMessageLocalTimes[index] ?? turn.localTime,
			sortTimestampMs: assistantMessageTimestampMs[index] ?? turn.sortTimestampMs,
			sequence: index,
		})),
		...reasoningMessages.map((message, index) => ({
			kind: 'reasoning' as const,
			message,
			localTime: reasoningMessageLocalTimes[index] ?? turn.localTime,
			sortTimestampMs: reasoningMessageTimestampMs[index] ?? turn.sortTimestampMs,
			sequence: turn.agentMessages.length + index,
		})),
	].sort((left, right) => {
		if (left.sortTimestampMs !== right.sortTimestampMs) {
			return left.sortTimestampMs - right.sortTimestampMs;
		}
		return left.sequence - right.sequence;
	});
	const aiTimeline = includeReasoningMessage
		? (turn.aiTimeline && turn.aiTimeline.length > 0 ? turn.aiTimeline : fallbackTimeline)
		: fallbackTimeline.filter((item) => item.kind === 'assistant');

	return {
		turnId: turn.turnId,
		localTime: turn.localTime,
		userMessage: turn.userMessage,
		userMessageLocalTime: turn.userMessageLocalTime ?? turn.localTime,
		assistantMessages: turn.agentMessages,
		assistantMessageLocalTimes,
		reasoningMessages,
		reasoningMessageLocalTimes,
		aiTimeline,
	};
}

function filterDays(days: HistoryDayNode[], query: string): HistoryDayView[] {
	return days
		.map((day) => ({
			dateKey: day.dateKey,
			turns: day.turns
				.filter((turn) => includesCaseInsensitive(turn.userMessage, query))
				.map(toTurnSummary),
		}))
		.filter((day) => day.turns.length > 0);
}

function flattenTurnIds(days: HistoryDayView[]): string[] {
	const turnIds: string[] = [];
	for (const day of days) {
		for (const turn of day.turns) {
			turnIds.push(turn.turnId);
		}
	}
	return turnIds;
}

function createEmptyHistoryIndex(): HistoryIndex {
	return {
		days: [],
		turns: [],
	};
}

export function deriveHistoryPanelViewModel(state: HistoryPanelState): HistoryPanelViewModel {
	const appliedQuery = normalizeQuery(state.appliedQuery);
	const days = filterDays(state.index.days, appliedQuery);
	const visibleTurnIds = flattenTurnIds(days);
	const selectedTurnId = visibleTurnIds.includes(state.selectedTurnId ?? '')
		? state.selectedTurnId
		: visibleTurnIds[0];
	const selectedTurn = toSelectedTurn(
		state.index.turns.find((turn) => turn.turnId === selectedTurnId),
		state.includeReasoningMessage,
	);
	return { appliedQuery, days, selectedTurn };
}

function limitHistoryIndex(index: HistoryIndex, maxHistoryCount: number | undefined): HistoryIndex {
	if (!maxHistoryCount) {
		return index;
	}
	const limitedTurns = index.turns.slice(0, maxHistoryCount);
	const limitedTurnIds = new Set(
		limitedTurns.map((turn) => turn.turnId),
	);
	const limitedDays = index.days
		.map((day) => ({
			...day,
			turns: day.turns.filter((turn) => limitedTurnIds.has(turn.turnId)),
		}))
		.filter((day) => day.turns.length > 0);
	return {
		turns: limitedTurns,
		days: limitedDays,
	};
}

function createNonce(): string {
	const alphabet =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 24; index += 1) {
		nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return nonce;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function isCoreViewTab(value: unknown): value is CoreViewTab {
	return (
		value === 'history' ||
		value === 'chain' ||
		value === 'trusted' ||
		value === 'features' ||
		value === 'hooks'
	);
}

function buildRefreshButtonHtml(tab: CoreViewTab): string {
	return `<button class="icon-button refresh-button" type="button" data-refresh-tab="${tab}" title="${escapeHtml(messages.commandRefresh)}" aria-label="${escapeHtml(messages.commandRefresh)}"><span class="codicon codicon-refresh" aria-hidden="true"></span></button>`;
}

function buildWorkspaceContextHtml(workspaceRoot: string | undefined, emptyLabel: string): string {
	const value = workspaceRoot ?? emptyLabel;
	return `<span class="codicon codicon-workspace-trusted" aria-hidden="true"></span><span>${escapeHtml(messages.chainWorkspaceRootLabel)}: ${escapeHtml(value)}</span>`;
}

function toChainSubtitle(node: AgentsChainNode): string {
	return `${node.kind} / ${node.type}`;
}

function explainCurrentNode(node: AgentsChainNode): string {
	return messages.chainExplainCurrent(node.kind, node.fileName);
}

function explainSkippedNode(node: AgentsChainNode): string {
	const preferred = node.reason.match(/^(.+?) has higher priority\./)?.[1];
	if (preferred) {
		return messages.chainExplainIgnoredPreferred(preferred);
	}
	return messages.chainExplainIgnoredGeneric;
}

function explainProblemNode(node: AgentsChainNode): string {
	return messages.chainExplainProblem(node.reason);
}

function explainMissingNode(node: AgentsChainNode): string {
	if (node.type === 'Fallback') {
		return messages.chainExplainMissingFallback;
	}
	return messages.chainExplainMissingGeneric;
}

function toDisplayEntry(node: AgentsChainNode, index: number): AgentsChainDisplayEntry {
	if (node.status === 'Active') {
		return {
			id: `chain-${index}`,
			section: 'current',
			title: node.fileName,
			subtitle: toChainSubtitle(node),
			statusLabel: messages.chainStatusCurrent,
			summary: explainCurrentNode(node),
			path: node.absolutePath,
			explanation: explainCurrentNode(node),
			contentPreview: node.contentPreview,
			defaultVisible: true,
		};
	}
	if (node.status === 'Skipped') {
		return {
			id: `chain-${index}`,
			section: 'ignored',
			title: node.fileName,
			subtitle: toChainSubtitle(node),
			statusLabel: messages.chainStatusIgnored,
			summary: explainSkippedNode(node),
			path: node.absolutePath,
			explanation: explainSkippedNode(node),
			contentPreview: node.contentPreview,
			defaultVisible: true,
		};
	}
	if (node.status === 'Error') {
		return {
			id: `chain-${index}`,
			section: 'problems',
			title: node.fileName,
			subtitle: toChainSubtitle(node),
			statusLabel: messages.chainStatusProblem,
			summary: explainProblemNode(node),
			path: node.absolutePath,
			explanation: explainProblemNode(node),
			contentPreview: node.contentPreview,
			defaultVisible: true,
		};
	}
	return {
		id: `chain-${index}`,
		section: 'details',
		title: node.fileName,
		subtitle: toChainSubtitle(node),
		statusLabel: messages.chainStatusMissing,
		summary: explainMissingNode(node),
		path: node.absolutePath,
		explanation: explainMissingNode(node),
		contentPreview: node.contentPreview,
		defaultVisible: false,
	};
}

function buildAgentsChainPayload(
	workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
): AgentsChainDisplayPayload {
	if (!workspaceRoot) {
		return {
			entries: [],
			summary: {
				currentCount: 0,
				ignoredCount: 0,
				problemCount: 0,
				hiddenCount: 0,
			},
			emptyStateMessage: messages.chainNoWorkspace,
		};
	}
	const entries = buildAgentsLoadingChain(workspaceRoot).map(toDisplayEntry);
	return {
		entries,
		summary: {
			currentCount: entries.filter((entry) => entry.section === 'current').length,
			ignoredCount: entries.filter((entry) => entry.section === 'ignored').length,
			problemCount: entries.filter((entry) => entry.section === 'problems').length,
			hiddenCount: entries.filter((entry) => !entry.defaultVisible).length,
		},
		workspaceRoot,
	};
}

function buildTrustedDirectoriesHtml(): string {
	const trustedDirectories = listTrustedDirectories(resolveCodexPaths().configPath);
	const coreStatus = getCoreWorkspaceStatus();
	const trustedHtml = trustedDirectories.map((directory) => `<article class="trusted-row turn-card">
		<span class="codicon ${directory.exists ? 'codicon-pass-filled trusted-ok' : 'codicon-warning trusted-warning'}" aria-hidden="true"></span>
		<span class="trusted-path" title="${escapeHtml(directory.reason ?? directory.path)}">${escapeHtml(directory.path)}</span>
		<button class="icon-button" type="button" data-remove-trusted="${escapeHtml(directory.path)}" title="${escapeHtml(messages.mcpManagerDelete)}" aria-label="${escapeHtml(messages.mcpManagerDelete)}" ${coreStatus.isConfigInvalid ? 'disabled' : ''}><span class="codicon codicon-trash" aria-hidden="true"></span></button>
	</article>`).join('');
	return `<div class="trusted-toolbar">
		<button id="addTrusted" class="icon-button" type="button" title="${escapeHtml(messages.mcpManagerAdd)}" aria-label="${escapeHtml(messages.mcpManagerAdd)}" ${coreStatus.isConfigInvalid ? 'disabled' : ''}><span class="codicon codicon-add" aria-hidden="true"></span></button>
		${buildRefreshButtonHtml('trusted')}
		${coreStatus.isConfigInvalid ? `<span class="muted">${messages.reasonConfigInvalid}</span>` : ''}
	</div>
	<div class="trusted-list">${trustedHtml || `<p class="muted">${messages.historyNoResult}</p>`}</div>`;
}

function buildFeatureFlagsHtml(): string {
	const configPath = resolveCodexPaths().configPath;
	const flags = listFeatureFlagRecords(configPath);
	const coreStatus = getCoreWorkspaceStatus();
	const rows = flags
		.map((flag) => {
			const configuredLabel =
				flag.configuredValue === undefined
					? messages.featureFlagSourceDefault
					: messages.featureFlagSourceConfig;
			const checked = flag.enabled ? 'checked' : '';
			const disabled = coreStatus.isConfigInvalid ? 'disabled' : '';
			return `<article class="setting-card">
				<div class="setting-card-main">
					<div class="setting-card-title-row">
						<div>
							<h3 class="setting-card-title">${escapeHtml(flag.key)}</h3>
							<p class="setting-card-subtitle">${escapeHtml(flag.description)}</p>
						</div>
						<div class="feature-badges">
							<span class="feature-badge ${escapeHtml(flag.maturity.toLowerCase())}">${escapeHtml(flag.maturity)}</span>
							<span class="feature-badge subtle">${escapeHtml(configuredLabel)}</span>
						</div>
					</div>
					<div class="setting-card-meta muted">
						<span>${escapeHtml(messages.featureFlagDefaultLabel)}: ${flag.defaultEnabled ? 'true' : 'false'}</span>
						<span>${escapeHtml(messages.featureFlagEffectiveLabel)}: ${flag.enabled ? 'true' : 'false'}</span>
					</div>
				</div>
				<label class="setting-toggle">
					<input type="checkbox" data-feature-toggle="${escapeHtml(flag.key)}" ${checked} ${disabled} />
					<span class="chain-toggle-switch" aria-hidden="true"></span>
				</label>
			</article>`;
		})
		.join('');
	return `<div class="trusted-toolbar">
		${buildRefreshButtonHtml('features')}
		${coreStatus.isConfigInvalid ? `<span class="muted">${messages.reasonConfigInvalid}</span>` : ''}
	</div>
	<div class="settings-list">${rows || `<p class="muted">${messages.historyNoResult}</p>`}</div>`;
}

function buildHooksHtml(): string {
	const diagnostics = listHookDiagnostics();
	const hookFeatureAction = diagnostics.hooksEnabled
		? ''
		: `<button class="icon-button" type="button" data-enable-hooks="true" title="${escapeHtml(messages.hooksEnableFeature)}" aria-label="${escapeHtml(messages.hooksEnableFeature)}"><span class="codicon codicon-pass-filled" aria-hidden="true"></span></button>`;
	const warnings = diagnostics.warnings
		.map((warning) => `<article class="warning-card"><span class="codicon codicon-warning" aria-hidden="true"></span><span>${escapeHtml(warning)}</span></article>`)
		.join('');
	const hookRadios = diagnostics.sources
		.map(
			(_source, index) =>
				`<input id="hooks-source-${index}" class="hook-source-radio" type="radio" name="hooks-source" ${index === 0 ? 'checked' : ''} />`,
		)
		.join('');
	const hookPanelSelectors = diagnostics.sources
		.map(
			(_source, index) =>
				`#hooks-source-${index}:checked ~ .hooks-layout [data-hook-panel="${index}"] { display: grid; }
#hooks-source-${index}:checked ~ .hooks-layout label[for="hooks-source-${index}"] { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
#hooks-source-${index}:checked ~ .hooks-layout label[for="hooks-source-${index}"] .setting-card-subtitle,
#hooks-source-${index}:checked ~ .hooks-layout label[for="hooks-source-${index}"] .muted,
#hooks-source-${index}:checked ~ .hooks-layout label[for="hooks-source-${index}"] .feature-badge.subtle { color: var(--vscode-list-activeSelectionForeground); opacity: 0.9; }`,
		)
		.join('\n');
	const sourceCards = diagnostics.sources
		.map((source, index) => {
			const sourceDomId = `hooks-source-${index}`;
			const openButton = source.exists
				? `<button class="icon-button" type="button" data-open-path="${escapeHtml(source.path)}" title="${escapeHtml(messages.hooksOpenSource)}" aria-label="${escapeHtml(messages.hooksOpenSource)}"><span class="codicon codicon-go-to-file" aria-hidden="true"></span></button>`
				: source.format === 'hooks.json'
					? `<button class="icon-button" type="button" data-create-hooks-file="${escapeHtml(source.path)}" title="${escapeHtml(messages.hooksCreateFile)}" aria-label="${escapeHtml(messages.hooksCreateFile)}"><span class="codicon codicon-add" aria-hidden="true"></span></button>`
					: `<button class="icon-button" type="button" data-create-empty-file="${escapeHtml(source.path)}" title="${escapeHtml(messages.hooksCreateConfigFile)}" aria-label="${escapeHtml(messages.hooksCreateConfigFile)}"><span class="codicon codicon-add" aria-hidden="true"></span></button>`;
			return `<article class="hooks-source-item">
				<label class="setting-card hook-source-card" for="${sourceDomId}">
				<div class="setting-card-main">
					<div class="setting-card-title-row">
						<div>
							<h3 class="setting-card-title">${escapeHtml(source.layer === 'user' ? messages.hooksLayerUser : messages.hooksLayerProject)} / ${escapeHtml(source.format)}</h3>
							<p class="setting-card-subtitle">${escapeHtml(source.path)}</p>
						</div>
						<div class="feature-badges">
							<span class="feature-badge ${source.active ? 'stable' : 'deprecated'}">${escapeHtml(source.active ? messages.hooksActive : messages.hooksInactive)}</span>
							<span class="feature-badge subtle">${escapeHtml(messages.hooksEntryCount(source.entryCount))}</span>
						</div>
					</div>
					${source.warning ? `<p class="muted">${escapeHtml(source.warning)}</p>` : ''}
				</div>
				</label>
				<div class="inline-actions">${openButton}</div>
			</article>`;
		})
		.join('');
	const entryPanels = diagnostics.sources
		.map((source, index) => {
			const matchingEntries = diagnostics.entries.filter(
				(entry) => entry.layer === source.layer && entry.format === source.format && entry.sourcePath === source.path,
			);
			const panelRows = matchingEntries
				.map((entry) => `<article class="hook-entry-card">
			<div class="setting-card-title-row">
				<div>
					<h3 class="setting-card-title">${escapeHtml(entry.event)}</h3>
					<p class="setting-card-subtitle">${escapeHtml(entry.command ?? messages.hooksNoCommand)}</p>
				</div>
				<div class="feature-badges">
					<span class="feature-badge ${entry.active ? 'stable' : 'deprecated'}">${escapeHtml(entry.active ? messages.hooksActive : messages.hooksInactive)}</span>
					<span class="feature-badge subtle">${escapeHtml(entry.layer === 'user' ? messages.hooksLayerUser : messages.hooksLayerProject)} / ${escapeHtml(entry.format)}</span>
				</div>
			</div>
			<div class="setting-card-meta muted">
				<span>${escapeHtml(messages.hooksMatcherLabel)}: ${escapeHtml(entry.matcher ?? messages.hooksMatcherNotUsed)}</span>
				<span>${escapeHtml(messages.hooksTypeLabel)}: ${escapeHtml(entry.handlerType)}</span>
				<span>${escapeHtml(messages.hooksTimeoutLabel)}: ${escapeHtml(entry.timeout?.toString() ?? '600')}</span>
			</div>
			${entry.statusMessage ? `<p class="muted">${escapeHtml(messages.hooksStatusMessageLabel)}: ${escapeHtml(entry.statusMessage)}</p>` : ''}
			${entry.warning ? `<p class="muted">${escapeHtml(entry.warning)}</p>` : ''}
		</article>`)
				.join('');
			return `<section class="hooks-detail-panel" data-hook-panel="${index}">
				<h2 class="section-heading">${escapeHtml(messages.hooksEntriesHeading)}</h2>
				${panelRows || `<p class="muted hooks-empty-state">${messages.hooksNoEntries}</p>`}
			</section>`;
		})
		.join('');
	return `<div class="trusted-toolbar">
		<div class="chain-toolbar-main">
			<div class="chain-context">${buildWorkspaceContextHtml(diagnostics.workspaceRoot, messages.chainNoWorkspace)}</div>
			<div class="chain-summary">
				<span>${escapeHtml(messages.hooksFeatureStatus(diagnostics.hooksEnabled ? messages.hooksActive : messages.hooksInactive))}</span>
				<span>${escapeHtml(messages.hooksProjectTrustLabel)}: ${escapeHtml(diagnostics.projectTrusted ? messages.hooksActive : messages.hooksInactive)}</span>
			</div>
		</div>
		${hookFeatureAction}
		${buildRefreshButtonHtml('hooks')}
	</div>
	<style>${hookPanelSelectors}</style>
	${hookRadios}
	<div class="hooks-layout">
		<section class="settings-list">
			<h2 class="section-heading">${escapeHtml(messages.hooksSourcesHeading)}</h2>
			${warnings}
			${sourceCards || `<p class="muted">${messages.historyNoResult}</p>`}
		</section>
		<section class="settings-list">
			${entryPanels || `<p class="muted">${messages.hooksNoEntries}</p>`}
		</section>
	</div>`;
}

function serializeAgentsChain(payload: AgentsChainDisplayPayload): string {
	return JSON.stringify(payload);
}

function buildHistoryWebviewHtml(
	webview: vscode.Webview,
	codiconCssHref: string | undefined,
): string {
	const nonce = createNonce();
	const labels = JSON.stringify({
		conversationHistoryTab: messages.coreViewConversationHistoryTab,
		agentsChainTab: messages.coreViewAgentsChainTab,
		trustedDirectoriesTab: messages.coreViewTrustedDirectoriesTab,
		featureFlagsTab: messages.coreViewFeatureFlagsTab,
		hooksTab: messages.coreViewHooksTab,
		searchPlaceholder: messages.historySearchPlaceholder,
		clear: messages.historyClear,
		noResult: messages.historyNoResult,
		noPreview: messages.historyNoPreview,
		copy: messages.historyCopy,
		user: messages.historyUserLabel,
		assistant: messages.historyAssistantLabel,
		agentPreviewEmpty: messages.historyNoPreview,
		chainCurrentSection: messages.chainCurrentSection,
		chainIgnoredSection: messages.chainIgnoredSection,
		chainProblemsSection: messages.chainProblemsSection,
		chainDetailsSection: messages.chainDetailsSection,
		chainToggleDetails: messages.chainToggleDetails,
		chainSummaryCurrent: messages.chainSummaryCurrent,
		chainSummaryIgnored: messages.chainSummaryIgnored,
		chainSummaryProblems: messages.chainSummaryProblems,
		chainSummaryHidden: messages.chainSummaryHidden,
		chainWorkspaceRootLabel: messages.chainWorkspaceRootLabel,
		chainNoWorkspace: messages.chainNoWorkspace,
		chainPreviewEmpty: messages.chainPreviewEmpty,
		chainDetailStatus: messages.chainDetailStatus,
		chainDetailClassification: messages.chainDetailClassification,
		chainDetailPath: messages.chainDetailPath,
		chainDetailExplanation: messages.chainDetailExplanation,
	});
	const csp = [
		"default-src 'none'",
		`img-src ${webview.cspSource} https: data:`,
		`font-src ${webview.cspSource} data:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	const codiconLink = codiconCssHref
		? `<link rel="stylesheet" href="${codiconCssHref}" />`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	${codiconLink}
	<title>${messages.coreViewPanelTitle}</title>
	<style>
		:root { color-scheme: light dark; }
		body {
			margin: 0;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.root {
			display: grid;
			grid-template-rows: auto auto 1fr;
			height: 100vh;
		}
		.top-pane {
			padding: 10px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.tabs {
			display: flex;
			gap: 4px;
			padding: 8px 12px 0;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.tab {
			border: 1px solid var(--vscode-panel-border);
			border-bottom: 0;
			background: var(--vscode-tab-inactiveBackground);
			color: var(--vscode-tab-inactiveForeground);
			padding: 6px 10px;
			border-radius: 4px 4px 0 0;
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.tab.active {
			background: var(--vscode-tab-activeBackground);
			color: var(--vscode-tab-activeForeground);
		}
		.search-box {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.search-box input {
			flex: 1;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			border-radius: 8px;
			padding: 6px 8px;
		}
		.search-box input:focus {
			outline: none;
			border-color: var(--vscode-focusBorder, #0e639c);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0e639c);
		}
		.bottom-pane {
			display: grid;
			grid-template-columns: 30% 70%;
			height: 100%;
			min-height: 0;
		}
		.left-pane {
			border-right: 1px solid var(--vscode-panel-border);
			overflow: auto;
			min-height: 0;
			padding: 10px 8px;
		}
		.right-pane {
			overflow: auto;
			min-height: 0;
			padding: 12px;
		}
		details {
			margin: 4px 0;
		}
		summary {
			cursor: pointer;
			user-select: none;
			font-weight: 600;
		}
		.day-turns {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin: 8px 0 0 12px;
		}
		.turn-card {
			background: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 8px;
			text-align: left;
			color: inherit;
			cursor: pointer;
		}
		.turn-card.active {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}
		.turn-title {
			font-size: 12px;
			line-height: 1.4;
			word-break: break-word;
		}
		mark.search-highlight {
			background: var(--vscode-editor-findMatchHighlightBackground);
			border: 1px solid var(--vscode-editor-findMatchBorder, transparent);
			color: inherit;
			border-radius: 2px;
			padding: 0 1px;
		}
		.preview-empty {
			color: var(--vscode-descriptionForeground);
		}
		.answer-block {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			padding: 12px;
			display: grid;
			gap: 12px;
		}
		.copy-button, .icon-button {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			width: 24px;
			height: 24px;
			padding: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
		}
		.icon-button:disabled {
			opacity: 0.45;
			cursor: not-allowed;
		}
		.codicon {
			font: normal normal normal 16px/1 codicon;
			display: inline-block;
			speak: never;
		}
		.codicon-copy::before {
			content: '\\ebcc';
		}
		.codicon-account::before {
			content: '\\eb99';
		}
		.codicon-hubot::before {
			content: '\\eb08';
		}
		.codicon-history::before {
			content: '\\ea82';
		}
		.codicon-server::before {
			content: '\\eb50';
		}
		.codicon-shield::before {
			content: '\\eb65';
		}
		.codicon-refresh::before {
			content: '\\eb37';
		}
		.codicon-add::before {
			content: '\\ea60';
		}
		.codicon-trash::before {
			content: '\\ea81';
		}
		.codicon-pass-filled::before {
			content: '\\ebb3';
		}
		.codicon-warning::before {
			content: '\\ea6c';
		}
		.codicon-chevron-right::before {
			content: '\\eab6';
		}
		.codicon-chevron-down::before {
			content: '\\eab4';
		}
		.message-frame {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 10px;
		}
		.frame-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
		}
		.section-title {
			margin: 0;
			font-size: 12px;
			font-weight: 600;
		}
		.message-meta {
			margin: 0;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.message-role-icon {
			font: normal normal normal 24px/1 codicon !important;
			width: 24px;
			height: 24px;
			line-height: 24px;
		}
		.reasoning-frame {
			padding: 0;
			overflow: hidden;
		}
		.reasoning-summary {
			list-style: none;
			cursor: pointer;
			padding: 10px;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.reasoning-summary::-webkit-details-marker {
			display: none;
		}
		.reasoning-chevron::before {
			content: '\\eab6';
		}
		.reasoning-frame[open] .reasoning-chevron::before {
			content: '\\eab4';
		}
		.reasoning-frame[open] .reasoning-summary {
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.reasoning-content {
			padding: 10px;
		}
		.diag-tab { display: none; min-height: 0; }
		#historyTab.active,
		#chainTab.active {
			display: grid;
			grid-template-rows: auto 1fr;
			height: 100%;
			min-height: 0;
			overflow: hidden;
		}
		#trustedTab.active,
		#featuresTab.active,
		#hooksTab.active {
			display: block;
			height: 100%;
			overflow: auto;
		}
		.chain-summary {
			margin-right: auto;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			align-items: center;
		}
		.chain-toggle {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			font-size: 12px;
			color: var(--vscode-foreground);
			cursor: pointer;
			user-select: none;
		}
		.chain-toggle input {
			position: absolute;
			opacity: 0;
			width: 1px;
			height: 1px;
			pointer-events: none;
		}
		.chain-toggle-switch {
			position: relative;
			width: 34px;
			height: 18px;
			border-radius: 999px;
			background: var(--vscode-checkbox-background, var(--vscode-input-background));
			border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border));
			flex: 0 0 auto;
			box-sizing: border-box;
			transition: background 0.15s ease, border-color 0.15s ease;
		}
		.chain-toggle-switch::after {
			content: '';
			position: absolute;
			top: 50%;
			left: 1px;
			width: 14px;
			height: 14px;
			border-radius: 50%;
			background: var(--vscode-button-secondaryForeground);
			transform: translateY(-50%);
			transition: transform 0.15s ease;
		}
		.chain-toggle input:checked + .chain-toggle-switch {
			background: var(--vscode-button-background);
			border-color: var(--vscode-button-background);
		}
		.chain-toggle input:checked + .chain-toggle-switch::after {
			transform: translate(16px, -50%);
			background: var(--vscode-button-foreground);
		}
		.chain-toggle input:focus-visible + .chain-toggle-switch {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}
		.chain-toggle-label {
			color: var(--vscode-descriptionForeground);
		}
		.chain-list {
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.chain-section {
			display: grid;
			gap: 6px;
		}
		.chain-section-title {
			margin: 0;
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
		}
		.chain-card {
			width: 100%;
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 8px;
			align-items: start;
		}
		.chain-card.skipped {
			opacity: 0.55;
		}
		.chain-card.missing {
			opacity: 0.55;
		}
		.chain-card.error {
			border-color: var(--vscode-inputValidation-errorBorder);
		}
		.chain-status {
			font-size: 11px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 999px;
			padding: 1px 6px;
			white-space: nowrap;
		}
		.chain-status.current {
			background: color-mix(in srgb, var(--vscode-testing-iconPassed) 15%, transparent);
		}
		.chain-status.problems {
			background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder) 12%, transparent);
		}
		.chain-status.details {
			opacity: 0.7;
		}
		.chain-meta {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
			margin-top: 3px;
		}
		.chain-summary-text {
			margin: 3px 0 0;
			font-size: 12px;
			line-height: 1.5;
		}
		.chain-toolbar-main {
			display: grid;
			gap: 6px;
			min-width: 0;
			margin-right: auto;
		}
		.chain-context {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			word-break: break-all;
		}
		.chain-detail {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 14px;
			background: var(--vscode-editorWidget-background);
			display: grid;
			gap: 12px;
		}
		.chain-detail-grid {
			display: grid;
			grid-template-columns: 120px 1fr;
			gap: 10px 14px;
			align-items: start;
		}
		.chain-detail-label {
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
		}
		.chain-detail-grid > div:not(.chain-detail-label) {
			font-size: 13px;
			line-height: 1.55;
			color: var(--vscode-foreground);
			word-break: break-word;
		}
		.chain-detail pre {
			background: var(--vscode-textCodeBlock-background);
			border: 1px solid var(--vscode-panel-border);
			padding: 10px;
			border-radius: 4px;
			overflow: auto;
			margin: 0;
			font-size: 12px;
			line-height: 1.6;
			color: var(--vscode-editor-foreground);
			white-space: pre-wrap;
			word-break: break-word;
		}
		.trusted-row {
			display: grid;
			grid-template-columns: auto 1fr auto;
			gap: 8px;
			align-items: center;
			margin: 0 0 6px 0;
			width: 100%;
			box-sizing: border-box;
			cursor: default;
		}
		.trusted-path { word-break: break-all; }
		.trusted-ok { color: var(--vscode-testing-iconPassed); }
		.trusted-warning { color: var(--vscode-editorWarning-foreground); }
		.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.tab-toolbar, .trusted-toolbar {
			display: flex;
			gap: 8px;
			align-items: center;
			padding: 10px 12px;
			justify-content: flex-end;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.trusted-list { padding: 10px 8px; }
		.settings-list {
			padding: 10px 12px;
			display: grid;
			gap: 10px;
		}
		.hooks-layout {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0;
		}
		.hooks-source-item {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 12px;
			align-items: center;
		}
		.hook-source-radio {
			position: absolute;
			opacity: 0;
			width: 1px;
			height: 1px;
			pointer-events: none;
		}
		.hook-source-card {
			cursor: pointer;
		}
		.setting-card, .hook-entry-card, .warning-card {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			padding: 10px 12px;
			background: var(--vscode-editorWidget-background);
		}
		.warning-card {
			display: flex;
			gap: 8px;
			align-items: center;
			line-height: 1.5;
		}
		.warning-card .codicon {
			line-height: 1;
			flex: 0 0 auto;
		}
		.setting-card {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 12px;
			align-items: center;
		}
		.setting-card-main {
			display: grid;
			gap: 6px;
			min-width: 0;
		}
		.setting-card-title-row {
			display: flex;
			gap: 12px;
			align-items: start;
			justify-content: space-between;
		}
		.setting-card-title {
			margin: 0;
			font-size: 13px;
			font-weight: 600;
		}
		.setting-card-subtitle {
			margin: 4px 0 0;
			font-size: 12px;
			line-height: 1.5;
			color: var(--vscode-descriptionForeground);
			word-break: break-word;
		}
		.setting-card-meta {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
		}
		.setting-toggle {
			display: inline-flex;
			align-items: center;
			cursor: pointer;
		}
		.setting-toggle input {
			position: absolute;
			opacity: 0;
			width: 1px;
			height: 1px;
			pointer-events: none;
		}
		.setting-toggle input:checked + .chain-toggle-switch {
			background: var(--vscode-button-background);
			border-color: var(--vscode-button-background);
		}
		.setting-toggle input:checked + .chain-toggle-switch::after {
			transform: translate(16px, -50%);
			background: var(--vscode-button-foreground);
		}
		.setting-toggle input:focus-visible + .chain-toggle-switch {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}
		.feature-badges {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
			justify-content: flex-end;
		}
		.feature-badge {
			font-size: 11px;
			padding: 2px 8px;
			border-radius: 999px;
			border: 1px solid var(--vscode-panel-border);
			white-space: nowrap;
		}
		.feature-badge.stable {
			background: color-mix(in srgb, var(--vscode-testing-iconPassed) 14%, transparent);
		}
		.feature-badge.experimental {
			background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 14%, transparent);
		}
		.feature-badge.deprecated {
			background: color-mix(in srgb, var(--vscode-inputValidation-errorBorder) 12%, transparent);
		}
		.feature-badge.subtle {
			color: var(--vscode-descriptionForeground);
		}
		.inline-actions {
			display: inline-flex;
			gap: 8px;
			align-items: center;
		}
		.hooks-detail-panel {
			display: none;
			gap: 10px;
			align-content: start;
		}
		.hooks-detail-panel > .section-heading {
			margin: 0;
		}
		.hooks-empty-state {
			margin: 0;
			align-self: start;
			justify-self: start;
			text-align: left;
		}
		.section-heading {
			margin: 0;
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
		}
		.markdown-content p {
			margin: 0 0 10px 0;
			line-height: 1.5;
		}
		.markdown-content pre {
			background: var(--vscode-textCodeBlock-background);
			padding: 8px;
			border-radius: 4px;
			overflow: auto;
		}
	</style>
</head>
<body>
	<div class="root">
		<nav class="tabs" aria-label="${escapeHtml(messages.coreViewTabsAriaLabel)}">
			<button class="tab active" data-tab="history" type="button"><span class="codicon codicon-history" aria-hidden="true"></span>${messages.coreViewConversationHistoryTab}</button>
			<button class="tab" data-tab="chain" type="button"><span class="codicon codicon-server" aria-hidden="true"></span>${messages.coreViewAgentsChainTab}</button>
			<button class="tab" data-tab="trusted" type="button"><span class="codicon codicon-shield" aria-hidden="true"></span>${messages.coreViewTrustedDirectoriesTab}</button>
			<button class="tab" data-tab="features" type="button"><span class="codicon codicon-settings-gear" aria-hidden="true"></span>${messages.coreViewFeatureFlagsTab}</button>
			<button class="tab" data-tab="hooks" type="button"><span class="codicon codicon-symbol-event" aria-hidden="true"></span>${messages.coreViewHooksTab}</button>
		</nav>
		<section id="historyTab" class="diag-tab active">
			<section class="top-pane">
				<div class="search-box">
					<input id="searchInput" type="text" />
					<button id="clearButton" class="copy-button" type="button"></button>
					${buildRefreshButtonHtml('history')}
				</div>
			</section>
			<section class="bottom-pane">
				<aside id="treeArea" class="left-pane"></aside>
				<main id="previewArea" class="right-pane"></main>
			</section>
		</section>
		<section id="chainTab" class="diag-tab">
			<div class="tab-toolbar">
				<div class="chain-toolbar-main">
					<div id="chainContext" class="chain-context"></div>
					<div id="chainSummary" class="chain-summary"></div>
				</div>
				<label class="chain-toggle">
					<span class="chain-toggle-label">${messages.chainToggleDetails}</span>
					<input id="chainDetailsToggle" type="checkbox" />
					<span class="chain-toggle-switch" aria-hidden="true"></span>
				</label>
				${buildRefreshButtonHtml('chain')}
			</div>
			<section class="bottom-pane">
				<aside id="chainList" class="left-pane"></aside>
				<main id="chainPreview" class="right-pane"></main>
			</section>
		</section>
		<section id="trustedTab" class="diag-tab">
			<div id="trustedContent"></div>
		</section>
		<section id="featuresTab" class="diag-tab">
			<div id="featuresContent"></div>
		</section>
		<section id="hooksTab" class="diag-tab">
			<div id="hooksContent"></div>
		</section>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const labels = ${labels};
		let chainPayload = ${serializeAgentsChain({
			entries: [],
			summary: {
				currentCount: 0,
				ignoredCount: 0,
				problemCount: 0,
				hiddenCount: 0,
			},
		})};
		let showDetailedChainCandidates = false;
		const loadedTabs = new Set();
		let selectedChainId = chainPayload.entries.find((entry) => entry.section === 'current')?.id
			|| chainPayload.entries.find((entry) => entry.defaultVisible)?.id
			|| chainPayload.entries[0]?.id;
		const searchInput = document.getElementById('searchInput');
		const clearButton = document.getElementById('clearButton');
		const treeArea = document.getElementById('treeArea');
		const previewArea = document.getElementById('previewArea');
		const chainList = document.getElementById('chainList');
		const chainPreview = document.getElementById('chainPreview');
		const chainContext = document.getElementById('chainContext');
		const chainSummary = document.getElementById('chainSummary');
		const chainDetailsToggle = document.getElementById('chainDetailsToggle');
		for (const button of document.querySelectorAll('[data-tab]')) {
			button.addEventListener('click', () => {
				document.querySelectorAll('[data-tab]').forEach((item) => item.classList.remove('active'));
				document.querySelectorAll('.diag-tab').forEach((item) => item.classList.remove('active'));
				button.classList.add('active');
				const tab = button.dataset.tab;
				document.getElementById(tab + 'Tab')?.classList.add('active');
				if (tab && !loadedTabs.has(tab)) {
					vscode.postMessage({ type: 'refreshTab', tab });
				}
			});
		}
		document.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const addTrustedButton = target?.closest('#addTrusted');
			if (addTrustedButton) {
				vscode.postMessage({ type: 'addTrustedDirectory' });
				return;
			}
			const refreshButton = target?.closest('[data-refresh-tab]');
			if (refreshButton?.dataset?.refreshTab) {
				vscode.postMessage({ type: 'refreshTab', tab: refreshButton.dataset.refreshTab });
				return;
			}
			const removeTrustedButton = target?.closest('[data-remove-trusted]');
			if (removeTrustedButton?.dataset?.removeTrusted) {
				vscode.postMessage({ type: 'removeTrustedDirectory', targetPath: removeTrustedButton.dataset.removeTrusted });
				return;
			}
			const openPathButton = target?.closest('[data-open-path]');
			if (openPathButton?.dataset?.openPath) {
				vscode.postMessage({ type: 'openPath', targetPath: openPathButton.dataset.openPath });
				return;
			}
			const createHooksFileButton = target?.closest('[data-create-hooks-file]');
			if (createHooksFileButton?.dataset?.createHooksFile) {
				vscode.postMessage({ type: 'createHooksFile', targetPath: createHooksFileButton.dataset.createHooksFile });
				return;
			}
			const createEmptyFileButton = target?.closest('[data-create-empty-file]');
			if (createEmptyFileButton?.dataset?.createEmptyFile) {
				vscode.postMessage({ type: 'createEmptyFile', targetPath: createEmptyFileButton.dataset.createEmptyFile });
				return;
			}
			const enableHooksButton = target?.closest('[data-enable-hooks]');
			if (enableHooksButton) {
				vscode.postMessage({ type: 'setFeatureFlag', featureKey: 'codex_hooks', enabled: true });
			}
		});
		document.addEventListener('change', (event) => {
			const target = event.target instanceof HTMLInputElement ? event.target : null;
			if (target?.dataset?.featureToggle) {
				vscode.postMessage({
					type: 'setFeatureFlag',
					featureKey: target.dataset.featureToggle,
					enabled: target.checked,
				});
			}
		});
		searchInput.placeholder = labels.searchPlaceholder;
		clearButton.title = labels.clear;
		clearButton.setAttribute('aria-label', labels.clear);
		clearButton.innerHTML = '<span class="codicon codicon-clear-all" aria-hidden="true"></span>';

		let state = { appliedQuery: '', days: [], selectedTurn: undefined };

		const escapeHtml = (value) =>
			String(value)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#39;');

		const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&');

		const highlightTitle = (text, query) => {
			const escapedText = escapeHtml(text);
			if (!query) {
				return escapedText;
			}
			const matcher = new RegExp(escapeRegExp(query), 'gi');
			return escapedText.replace(
				matcher,
				(match) => '<mark class="search-highlight">' + match + '</mark>',
			);
		};

		const renderMarkdown = (markdown) => {
			const escaped = escapeHtml(markdown || '');
			const withCodeBlocks = escaped.replace(
				/\`\`\`([\\s\\S]*?)\`\`\`/g,
				(_, code) => '<pre><code>' + code + '</code></pre>',
			);
			const withInline = withCodeBlocks
				.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
				.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
			return withInline
				.split(/\\n{2,}/)
				.map((chunk) => '<p>' + chunk.replaceAll('\\n', '<br />') + '</p>')
				.join('');
		};

		const chainSections = [
			['current', labels.chainCurrentSection],
			['ignored', labels.chainIgnoredSection],
			['problems', labels.chainProblemsSection],
			['details', labels.chainDetailsSection],
		];

		const getVisibleChainEntries = () =>
			(chainPayload.entries || []).filter((entry) => entry.defaultVisible || showDetailedChainCandidates);

		const ensureSelectedChainId = (entries) => {
			if (!entries.some((entry) => entry.id === selectedChainId)) {
				selectedChainId = entries[0]?.id;
			}
		};

		const renderChainSummary = () => {
			if (!chainSummary || !chainContext) {
				return;
			}
			const summary = chainPayload.summary || {
				currentCount: 0,
				ignoredCount: 0,
				problemCount: 0,
				hiddenCount: 0,
			};
			chainContext.innerHTML = chainPayload.workspaceRoot
				? '<span class="codicon codicon-workspace-trusted" aria-hidden="true"></span><span>' +
					escapeHtml(labels.chainWorkspaceRootLabel + ': ' + chainPayload.workspaceRoot) +
					'</span>'
				: '<span class="codicon codicon-workspace-trusted" aria-hidden="true"></span><span>' +
					escapeHtml(labels.chainWorkspaceRootLabel + ': ' + labels.chainNoWorkspace) +
					'</span>';
			chainSummary.innerHTML =
				'<span>' + labels.chainSummaryCurrent + ': ' + summary.currentCount + '</span>' +
				'<span>' + labels.chainSummaryIgnored + ': ' + summary.ignoredCount + '</span>' +
				'<span>' + labels.chainSummaryProblems + ': ' + summary.problemCount + '</span>' +
				(summary.hiddenCount > 0
					? '<span>' + labels.chainSummaryHidden + ': ' + summary.hiddenCount + '</span>'
					: '');
		};

		const renderChain = () => {
			if (!chainList || !chainPreview) {
				return;
			}
			const visibleEntries = getVisibleChainEntries();
			renderChainSummary();
			if (visibleEntries.length === 0) {
				const emptyMessage = chainPayload.emptyStateMessage || labels.noResult;
				chainList.innerHTML = '<div class="preview-empty">' + emptyMessage + '</div>';
				chainPreview.innerHTML = '<div class="preview-empty">' + emptyMessage + '</div>';
				return;
			}
			ensureSelectedChainId(visibleEntries);
			chainList.innerHTML = '<div class="chain-list"></div>';
			const container = chainList.querySelector('.chain-list');
			chainSections.forEach(([sectionId, sectionLabel]) => {
				const sectionEntries = visibleEntries.filter((entry) => entry.section === sectionId);
				if (sectionEntries.length === 0) {
					return;
				}
				const section = document.createElement('section');
				section.className = 'chain-section';
				section.innerHTML = '<h3 class="chain-section-title">' + escapeHtml(sectionLabel) + '</h3>';
				sectionEntries.forEach((entry) => {
					const card = document.createElement('button');
					card.type = 'button';
					card.className =
						'turn-card chain-card ' +
						String(entry.section || '').toLocaleLowerCase() +
						(entry.id === selectedChainId ? ' active' : '');
					card.addEventListener('click', () => {
						selectedChainId = entry.id;
						renderChain();
					});
					card.innerHTML =
						'<span>' +
						'<span class="turn-title">' + escapeHtml(entry.title) + '</span>' +
						'<span class="chain-meta muted"><span>' + escapeHtml(entry.subtitle) + '</span></span>' +
						'<p class="chain-summary-text">' + escapeHtml(entry.summary) + '</p>' +
						'</span>' +
						'<span class="chain-status ' + escapeHtml(entry.section) + '">' + escapeHtml(entry.statusLabel) + '</span>';
					section.appendChild(card);
				});
				container?.appendChild(section);
			});
			const selected = visibleEntries.find((entry) => entry.id === selectedChainId) || visibleEntries[0];
			chainPreview.innerHTML =
				'<section class="chain-detail">' +
				'<div class="frame-header">' +
				'<div>' +
				'<h2 class="section-title">' + escapeHtml(selected.title) + '</h2>' +
				'<p class="message-meta">' + escapeHtml(selected.subtitle) + ' / ' + escapeHtml(selected.statusLabel) + '</p>' +
				'</div>' +
				'</div>' +
				'<div class="chain-detail-grid">' +
				'<div class="chain-detail-label">' + escapeHtml(labels.chainDetailStatus) + '</div><div>' + escapeHtml(selected.statusLabel) + '</div>' +
				'<div class="chain-detail-label">' + escapeHtml(labels.chainDetailClassification) + '</div><div>' + escapeHtml(selected.subtitle) + '</div>' +
				'<div class="chain-detail-label">' + escapeHtml(labels.chainDetailPath) + '</div><div class="muted">' + escapeHtml(selected.path) + '</div>' +
				'<div class="chain-detail-label">' + escapeHtml(labels.chainDetailExplanation) + '</div><div>' + escapeHtml(selected.explanation) + '</div>' +
				'</div>' +
				(selected.contentPreview ? '<pre>' + escapeHtml(selected.contentPreview) + '</pre>' : '') +
				'</section>';
		};

		const renderTree = () => {
			const previousScrollTop = treeArea.scrollTop;
			const openDayKeys = new Set(
				Array.from(treeArea.querySelectorAll('details[data-day-key]'))
					.filter((element) => element.open)
					.map((element) => element.dataset.dayKey)
					.filter((dayKey) => Boolean(dayKey)),
			);
			if (state.days.length === 0) {
				treeArea.innerHTML = '<div class="preview-empty">' + labels.noResult + '</div>';
				return;
			}
			treeArea.innerHTML = '';
			for (const day of state.days) {
				const dayDetails = document.createElement('details');
				dayDetails.dataset.dayKey = day.dateKey;
				dayDetails.open = openDayKeys.size === 0 || openDayKeys.has(day.dateKey);
				const daySummary = document.createElement('summary');
				daySummary.textContent = day.dateKey;
				dayDetails.appendChild(daySummary);

				const turnsContainer = document.createElement('div');
				turnsContainer.className = 'day-turns';
				for (const turn of day.turns) {
					const card = document.createElement('button');
					card.type = 'button';
					card.className =
						'turn-card' +
						(state.selectedTurn?.turnId === turn.turnId ? ' active' : '');
					card.addEventListener('click', () => {
						vscode.postMessage({ type: 'selectTurn', turnId: turn.turnId });
					});

					const title = document.createElement('div');
					title.className = 'turn-title';
					title.innerHTML =
						'💬 ' +
						escapeHtml(turn.localTime) +
						' ' +
						highlightTitle(turn.displayMessage, state.appliedQuery);
					card.appendChild(title);
					turnsContainer.appendChild(card);
				}

				dayDetails.appendChild(turnsContainer);
				treeArea.appendChild(dayDetails);
			}
			treeArea.scrollTop = previousScrollTop;
		};

		const renderPreview = () => {
			if (!state.selectedTurn) {
				previewArea.innerHTML = '<div class="preview-empty">' + labels.noPreview + '</div>';
				return;
			}
			const selected = state.selectedTurn;
			const copyLabel = escapeHtml(labels.copy);
			const aiBlocks = selected.aiTimeline
				.map((item, index) => {
					const itemLocalTime = escapeHtml(item.localTime);
					if (item.kind === 'assistant') {
						return (
							'<section class="message-frame">' +
							'<div class="frame-header">' +
							'<div>' +
							'<p class="message-meta"><span class="codicon codicon-hubot message-role-icon" aria-hidden="true"></span>' +
							itemLocalTime +
							'</p>' +
							'</div>' +
							'<button id="copyAssistantButton-' +
							index +
							'" class="copy-button" type="button" title="' +
							copyLabel +
							'" aria-label="' +
							copyLabel +
							'"><span class="codicon codicon-copy" aria-hidden="true"></span></button>' +
							'</div>' +
							'<div class="markdown-content">' +
							renderMarkdown(item.message) +
							'</div>' +
							'</section>'
						);
					}
					return (
						'<details class="message-frame reasoning-frame">' +
						'<summary class="reasoning-summary">' +
						'<span class="codicon reasoning-chevron" aria-hidden="true"></span>' +
						'<p class="message-meta"><span class="codicon codicon-hubot message-role-icon" aria-hidden="true"></span>' +
						itemLocalTime +
						'</p>' +
						'</summary>' +
						'<div class="reasoning-content">' +
						'<div class="markdown-content">' +
						renderMarkdown(item.message) +
						'</div>' +
						'</div>' +
						'</details>'
					);
				})
				.join('');
			previewArea.innerHTML =
				'<article class="answer-block">' +
				'<section class="message-frame">' +
				'<div class="frame-header">' +
				'<div>' +
				'<p class="message-meta"><span class="codicon codicon-account message-role-icon" aria-hidden="true"></span>' +
				escapeHtml(selected.userMessageLocalTime) +
				'</p>' +
				'</div>' +
				'<button id="copyUserButton" class="copy-button" type="button" title="' +
				copyLabel +
				'" aria-label="' +
				copyLabel +
				'"><span class="codicon codicon-copy" aria-hidden="true"></span></button>' +
				'</div>' +
				'<div class="markdown-content">' + renderMarkdown(selected.userMessage) + '</div>' +
				'</section>' +
				aiBlocks +
				'</article>';
			const copyUserButton = document.getElementById('copyUserButton');
			if (copyUserButton) {
				copyUserButton.addEventListener('click', () => {
					vscode.postMessage({ type: 'copyText', text: selected.userMessage });
				});
			}
			for (let index = 0; index < selected.aiTimeline.length; index += 1) {
				if (selected.aiTimeline[index].kind !== 'assistant') {
					continue;
				}
				const copyAssistantButton = document.getElementById('copyAssistantButton-' + index);
				if (!copyAssistantButton) {
					continue;
				}
				const assistantMessage = selected.aiTimeline[index].message;
				copyAssistantButton.addEventListener('click', () => {
					vscode.postMessage({ type: 'copyText', text: assistantMessage || '' });
				});
			}
		};

		const render = () => {
			searchInput.value = state.appliedQuery;
			renderTree();
			renderPreview();
			renderChain();
		};

		const postSearch = () => {
			vscode.postMessage({ type: 'search', query: searchInput.value });
		};

		searchInput.addEventListener('input', postSearch);
		searchInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				postSearch();
			}
		});
		clearButton.addEventListener('click', () => {
			searchInput.value = '';
			vscode.postMessage({ type: 'clearSearch' });
		});
		chainDetailsToggle?.addEventListener('change', () => {
			showDetailedChainCandidates = Boolean(chainDetailsToggle.checked);
			renderChain();
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message?.type === 'tabContent') {
				if (message.tab === 'chain') {
					loadedTabs.add('chain');
					chainPayload = message.payload || {
						entries: [],
						summary: { currentCount: 0, ignoredCount: 0, problemCount: 0, hiddenCount: 0 },
					};
					selectedChainId = chainPayload.entries.find((entry) => entry.section === 'current')?.id
						|| chainPayload.entries.find((entry) => entry.defaultVisible)?.id
						|| chainPayload.entries[0]?.id;
					renderChain();
				}
				if (message.tab === 'trusted') {
					loadedTabs.add('trusted');
					const trustedContent = document.getElementById('trustedContent');
					if (trustedContent) {
						trustedContent.innerHTML = message.html;
					}
				}
				if (message.tab === 'features') {
					loadedTabs.add('features');
					const featuresContent = document.getElementById('featuresContent');
					if (featuresContent) {
						featuresContent.innerHTML = message.html;
					}
				}
				if (message.tab === 'hooks') {
					loadedTabs.add('hooks');
					const hooksContent = document.getElementById('hooksContent');
					if (hooksContent) {
						hooksContent.innerHTML = message.html;
					}
				}
				return;
			}
			if (message?.type !== 'state') {
				return;
			}
			loadedTabs.add('history');
			state = message.payload;
			render();
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}

export function createHistoryWebviewPanel(): vscode.WebviewPanel {
	const panelOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
		enableScripts: true,
		retainContextWhenHidden: true,
		...(CODICON_RESOURCE_ROOTS.length > 0
			? { localResourceRoots: CODICON_RESOURCE_ROOTS }
			: {}),
	};
	const panel = vscode.window.createWebviewPanel(
		HISTORY_VIEW_TYPE,
		messages.coreViewPanelTitle,
		{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
		panelOptions,
	);
	panel.iconPath = getCodiconIconPath('terminal');
	return panel;
}

export class HistoryPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private state: HistoryPanelState | undefined;

	constructor(
		private readonly panelFactory: () => vscode.WebviewPanel = createHistoryWebviewPanel,
		private readonly loadIndex: () => HistoryIndex = () => buildHistoryIndex(),
		private readonly copyToClipboard: (text: string) => Thenable<void> = (text) =>
			vscode.env.clipboard.writeText(text),
		private readonly notifyCopied: () => Thenable<string | undefined> = () =>
			vscode.window.showInformationMessage(messages.historyCopied),
		private readonly getMaxHistoryCount: () => number | undefined = () =>
			getConfiguredMaxHistoryCount(),
		private readonly includeReasoningMessage: () => boolean = () =>
			getIncludeReasoningMessage(),
		private readonly registerPanelDispose: (
			panel: vscode.WebviewPanel,
			listener: () => void,
		) => vscode.Disposable | void = (panel, listener) => panel.onDidDispose(listener),
	) {}

	show(): vscode.WebviewPanel {
		if (this.panel) {
			if (this.state) {
				this.state.includeReasoningMessage = this.includeReasoningMessage();
			}
			this.panel.reveal(vscode.ViewColumn.Active, true);
			this.postState();
			return this.panel;
		}

		const panel = this.panelFactory();
		this.state = {
			index: createEmptyHistoryIndex(),
			selectedTurnId: undefined,
			appliedQuery: '',
			includeReasoningMessage: this.includeReasoningMessage(),
		};
		const codiconCssHref = getCodiconCssHref(panel.webview);
		panel.webview.html = buildHistoryWebviewHtml(panel.webview, codiconCssHref);
		panel.webview.onDidReceiveMessage((message: unknown) =>
			this.handleInboundMessage(message),
		);
		this.registerPanelDispose(panel, () => {
			if (this.panel === panel) {
				this.panel = undefined;
				this.state = undefined;
			}
		});
		this.panel = panel;
		return panel;
	}

	private handleInboundMessage(message: unknown): void {
		if (!this.panel || !this.state || !message || typeof message !== 'object') {
			return;
		}
		const incoming = message as Partial<HistoryPanelInboundMessage>;
		if (incoming.type === 'ready') {
			this.refreshTab('history');
			return;
		}
		if (incoming.type === 'selectTurn' && typeof incoming.turnId === 'string') {
			this.state.selectedTurnId = incoming.turnId;
			this.postState();
			return;
		}
		if (incoming.type === 'search' && typeof incoming.query === 'string') {
			this.state.appliedQuery = normalizeQuery(incoming.query);
			this.state.selectedTurnId = undefined;
			this.postState();
			return;
		}
		if (incoming.type === 'clearSearch') {
			this.state.appliedQuery = '';
			this.state.selectedTurnId = undefined;
			this.postState();
			return;
		}
		if (incoming.type === 'copyText' && typeof incoming.text === 'string') {
			void this.copyToClipboard(incoming.text);
			void this.notifyCopied();
			return;
		}
		if (incoming.type === 'refreshTab' && isCoreViewTab(incoming.tab)) {
			this.refreshTab(incoming.tab);
			return;
		}
		if (incoming.type === 'addTrustedDirectory') {
			void this.addTrustedDirectory();
			return;
		}
		if (
			incoming.type === 'removeTrustedDirectory' &&
			typeof incoming.targetPath === 'string'
		) {
			void this.removeTrustedDirectory(incoming.targetPath);
			return;
		}
		if (
			incoming.type === 'setFeatureFlag' &&
			typeof incoming.featureKey === 'string' &&
			typeof incoming.enabled === 'boolean'
		) {
			void this.setFeatureFlag(incoming.featureKey, incoming.enabled);
			return;
		}
		if (incoming.type === 'openPath' && typeof incoming.targetPath === 'string') {
			void this.openPath(incoming.targetPath);
			return;
		}
		if (
			incoming.type === 'createHooksFile' &&
			typeof incoming.targetPath === 'string'
		) {
			void this.createHooksFile(incoming.targetPath);
			return;
		}
		if (
			incoming.type === 'createEmptyFile' &&
			typeof incoming.targetPath === 'string'
		) {
			void this.createEmptyFile(incoming.targetPath);
		}
	}

	private async addTrustedDirectory(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});
		const targetPath = picked?.[0]?.fsPath;
		if (!targetPath) {
			return;
		}
		addTrustedDirectory(resolveCodexPaths().configPath, targetPath);
		vscode.window.showInformationMessage(messages.mcpToggleUpdated);
		this.refreshTab('trusted');
	}

	private async removeTrustedDirectory(targetPath: string): Promise<void> {
		const choice = await vscode.window.showWarningMessage(
			messages.trustedDirectoryDeleteConfirm(targetPath),
			{ modal: true },
			messages.dialogOk,
		);
		if (choice !== messages.dialogOk) {
			return;
		}
		removeTrustedDirectory(resolveCodexPaths().configPath, targetPath);
		vscode.window.showInformationMessage(messages.mcpToggleUpdated);
		this.refreshTab('trusted');
	}

	private async setFeatureFlag(featureKey: string, enabled: boolean): Promise<void> {
		setFeatureFlag(resolveCodexPaths().configPath, featureKey, enabled);
		vscode.window.showInformationMessage(messages.mcpToggleUpdated);
		this.refreshTab('features');
		if (featureKey === 'codex_hooks') {
			this.refreshTab('hooks');
		}
	}

	private async openPath(targetPath: string): Promise<void> {
		const targetUri = vscode.Uri.file(targetPath);
		await vscode.commands.executeCommand('vscode.open', targetUri);
	}

	private async createHooksFile(targetPath: string): Promise<void> {
		createHooksJsonFile(targetPath);
		await this.openPath(targetPath);
		this.refreshTab('hooks');
	}

	private async createEmptyFile(targetPath: string): Promise<void> {
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		if (!fs.existsSync(targetPath)) {
			fs.writeFileSync(targetPath, '', 'utf8');
		}
		await this.openPath(targetPath);
		this.refreshTab('hooks');
	}

	private refreshTab(tab: CoreViewTab): void {
		if (!this.panel || !this.state) {
			return;
		}
		if (tab === 'chain') {
			void this.panel.webview.postMessage({
				type: 'tabContent',
				tab,
				payload: buildAgentsChainPayload(),
			});
			return;
		}
		if (tab === 'trusted') {
			void this.panel.webview.postMessage({
				type: 'tabContent',
				tab,
				html: buildTrustedDirectoriesHtml(),
			});
			return;
		}
		if (tab === 'features') {
			void this.panel.webview.postMessage({
				type: 'tabContent',
				tab,
				html: buildFeatureFlagsHtml(),
			});
			return;
		}
		if (tab === 'hooks') {
			void this.panel.webview.postMessage({
				type: 'tabContent',
				tab,
				html: buildHooksHtml(),
			});
			return;
		}
		this.state.index = limitHistoryIndex(this.loadIndex(), this.getMaxHistoryCount());
		this.state.includeReasoningMessage = this.includeReasoningMessage();
		this.postState();
	}

	private postState(): void {
		if (!this.panel || !this.state) {
			return;
		}
		const viewModel = deriveHistoryPanelViewModel(this.state);
		this.state.selectedTurnId = viewModel.selectedTurn?.turnId;
		void this.panel.webview.postMessage({ type: 'state', payload: viewModel });
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
		this.state = undefined;
	}
}
