import * as vscode from 'vscode';
import * as path from 'path';
import { messages } from '../i18n';
import { getConfiguredMaxHistoryCount, getIncludeReasoningMessage } from './settings';
import { buildHistoryIndex, HistoryDayNode, HistoryIndex, HistoryTurnRecord } from './historyService';

const HISTORY_VIEW_TYPE = 'codex-workspace.history';
export const HISTORY_MESSAGE_PREVIEW_MAX_CHARS = 100;

function resolveCodiconCssFsPath(): string | undefined {
	try {
		return require.resolve('@vscode/codicons/dist/codicon.css');
	} catch {
		return undefined;
	}
}

const CODICON_CSS_FS_PATH = resolveCodiconCssFsPath();
const CODICON_RESOURCE_ROOTS = CODICON_CSS_FS_PATH
	? [vscode.Uri.file(path.dirname(CODICON_CSS_FS_PATH))]
	: [];

type HistoryPanelInboundMessage =
	| { type: 'ready' }
	| { type: 'selectTurn'; turnId: string }
	| { type: 'search'; query: string }
	| { type: 'clearSearch' }
	| { type: 'copyText'; text: string };

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

function buildHistoryWebviewHtml(
	webview: vscode.Webview,
	codiconCssHref: string | undefined,
): string {
	const nonce = createNonce();
	const labels = JSON.stringify({
		searchPlaceholder: messages.historySearchPlaceholder,
		clear: messages.historyClear,
		noResult: messages.historyNoResult,
		noPreview: messages.historyNoPreview,
		copy: messages.historyCopy,
		user: messages.historyUserLabel,
		assistant: messages.historyAssistantLabel,
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
	<title>${messages.historyPanelTitle}</title>
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
			grid-template-rows: auto 1fr;
			height: 100vh;
		}
		.top-pane {
			padding: 10px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
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
			min-height: 0;
		}
		.left-pane {
			border-right: 1px solid var(--vscode-panel-border);
			overflow: auto;
			padding: 10px 8px;
		}
		.right-pane {
			overflow: auto;
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
		.copy-button {
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
		<section class="top-pane">
			<div class="search-box">
				<input id="searchInput" type="text" />
				<button id="clearButton" class="copy-button" type="button"></button>
			</div>
		</section>
		<section class="bottom-pane">
			<aside id="treeArea" class="left-pane"></aside>
			<main id="previewArea" class="right-pane"></main>
		</section>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const labels = ${labels};
		const searchInput = document.getElementById('searchInput');
		const clearButton = document.getElementById('clearButton');
		const treeArea = document.getElementById('treeArea');
		const previewArea = document.getElementById('previewArea');
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

		const renderTree = () => {
			if (state.days.length === 0) {
				treeArea.innerHTML = '<div class="preview-empty">' + labels.noResult + '</div>';
				return;
			}
			treeArea.innerHTML = '';
			for (const day of state.days) {
				const dayDetails = document.createElement('details');
				dayDetails.open = true;
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

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message?.type !== 'state') {
				return;
			}
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
	return vscode.window.createWebviewPanel(
		HISTORY_VIEW_TYPE,
		messages.historyPanelTitle,
		{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
		panelOptions,
	);
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
			index: limitHistoryIndex(this.loadIndex(), this.getMaxHistoryCount()),
			selectedTurnId: undefined,
			appliedQuery: '',
			includeReasoningMessage: this.includeReasoningMessage(),
		};
		const codiconCssHref =
			CODICON_CSS_FS_PATH && typeof panel.webview.asWebviewUri === 'function'
				? panel.webview.asWebviewUri(vscode.Uri.file(CODICON_CSS_FS_PATH)).toString()
				: undefined;
		panel.webview.html = buildHistoryWebviewHtml(panel.webview, codiconCssHref);
		panel.webview.onDidReceiveMessage((message: unknown) =>
			this.handleInboundMessage(message),
		);
		panel.onDidDispose(() => {
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
			this.postState();
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
		}
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
