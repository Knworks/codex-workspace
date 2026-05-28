import * as vscode from 'vscode';
import { messages } from '../i18n';
import {
	AgentManagerRecord,
	disableAgentByName,
	enableAgentByName,
	listAgentManagerRecords,
	resolveAgentManagerPaths,
} from './agentManagerService';
import {
	createEmptyWorkflow,
	deleteWorkflowDefinition,
	generateWorkflowPrompt,
	getOrchestrationDirectory,
	listSavedWorkflowSummaries,
	loadWorkflowDefinition,
	saveWorkflowDefinition,
	validateWorkflowDefinition,
	type OrchestrationWorkflow,
} from './orchestrationService';
import {
	CODICON_RESOURCE_ROOTS,
	getCodiconCssHref,
	getCodiconIconPath,
	getWebviewFontFamily,
} from './webviewAssets';

const AGENT_MANAGER_VIEW_TYPE = 'codex-workspace.agentManager';

type InboundMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'openAgent'; agentPath: string }
	| { type: 'toggleAgent'; name: string; enabled: boolean }
	| { type: 'createWorkflow' }
	| { type: 'saveWorkflow'; workflow: OrchestrationWorkflow }
	| { type: 'loadWorkflow'; workflowId: string }
	| { type: 'deleteWorkflow'; workflowId: string }
	| { type: 'validateWorkflow'; workflow: OrchestrationWorkflow }
	| { type: 'generatePrompt'; workflow: OrchestrationWorkflow }
	| { type: 'copyPrompt'; prompt: string };

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
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

function buildRows(records: AgentManagerRecord[]): string {
	if (records.length === 0) {
		return `<p class="empty">${escapeHtml(messages.agentManagerNoResult)}</p>`;
	}
	return records.map((record) => {
		const disabledClass = record.enabled ? '' : ' disabled';
		return `<article class="agent-row${disabledClass}" data-filter-text="${escapeHtml(`${record.name} ${record.description} ${record.model} ${record.reasoningEffort} ${record.sandboxMode} ${record.agentPath}`.toLocaleLowerCase())}">
			<span class="codicon codicon-hubot row-icon" aria-hidden="true"></span>
			<div class="agent-main">
				<div class="agent-title">${escapeHtml(record.name)}</div>
				<div class="agent-description">${escapeHtml(record.description)}</div>
				<div class="agent-meta">
					<span>${escapeHtml(record.model)}</span>
					<span>${escapeHtml(record.reasoningEffort)}</span>
					<span>${escapeHtml(record.sandboxMode)}</span>
				</div>
				<div class="agent-path" title="${escapeHtml(record.location.label)}: ${escapeHtml(record.agentPath)}">${escapeHtml(record.agentPath)}</div>
			</div>
			<div class="agent-actions">
				<span class="location">${escapeHtml(record.location.label)}</span>
				<label class="switch">
					<input type="checkbox" data-agent-name="${escapeHtml(record.name)}" ${record.enabled ? 'checked' : ''} />
					<span></span>
				</label>
				<button class="icon-button" type="button" data-open-path="${escapeHtml(record.agentPath)}" title="${escapeHtml(messages.agentManagerOpen)}" aria-label="${escapeHtml(messages.agentManagerOpen)}"><span class="codicon codicon-file-text" aria-hidden="true"></span></button>
			</div>
		</article>`;
	}).join('');
}

function serializeForWebview(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildHtml(
	webview: vscode.Webview,
	records: AgentManagerRecord[],
	initialWorkflow: OrchestrationWorkflow,
): string {
	const nonce = createNonce();
	const codiconCssHref = getCodiconCssHref(webview);
	const webviewFontFamily = getWebviewFontFamily();
	const csp = [
		"default-src 'none'",
		`font-src ${webview.cspSource} data:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	const codiconLink = codiconCssHref
		? `<link rel="stylesheet" href="${codiconCssHref}" />`
		: '';
	const payload = serializeForWebview({
		agents: records.map((record) => ({
			name: record.name,
			description: record.description,
			model: record.model,
			reasoningEffort: record.reasoningEffort,
			sandboxMode: record.sandboxMode,
			agentPath: record.agentPath,
			locationLabel: record.location.label,
			enabled: record.enabled,
		})),
		agentRowsHtml: buildRows(records),
		workflow: initialWorkflow,
		savedWorkflows: listSavedWorkflowSummaries(),
		orchestrationDirectory: getOrchestrationDirectory(),
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	${codiconLink}
	<title>${escapeHtml(messages.agentManagerTitle)}</title>
	<style>
		:root {
			--card-width: 220px;
			--card-height: 112px;
		}
		body {
			margin: 0;
			font-family: ${webviewFontFamily};
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		button,
		input,
		select,
		textarea {
			font: inherit;
		}
		button {
			cursor: pointer;
		}
		.icon-button,
		.secondary-button,
		.primary-button {
			height: 28px;
			padding: 0 10px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			gap: 6px;
		}
		.primary-button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: transparent;
		}
		.toolbar-input,
		.toolbar-select,
		.inspector input,
		.inspector select,
		.inspector textarea {
			box-sizing: border-box;
			min-width: 0;
			width: 100%;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
			border-radius: 8px;
			padding: 6px 8px;
		}
		.toolbar-input:focus,
		.toolbar-select:focus,
		.inspector input:focus,
		.inspector select:focus,
		.inspector textarea:focus {
			outline: none;
			border-color: var(--vscode-focusBorder, #0e639c);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0e639c);
		}
		.manager-tabs {
			display: flex;
			gap: 2px;
			padding: 10px 12px 0;
			border-bottom: 1px solid var(--vscode-panel-border);
			background:
				linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 96%, var(--vscode-focusBorder) 4%), var(--vscode-editor-background));
		}
		.manager-tab {
			border: 0;
			border-radius: 10px 10px 0 0;
			padding: 8px 12px;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			display: inline-flex;
			gap: 6px;
			align-items: center;
		}
		.manager-tab.active {
			background: var(--vscode-editorWidget-background);
			color: var(--vscode-foreground);
			border: 1px solid var(--vscode-panel-border);
			border-bottom-color: transparent;
			margin-bottom: -1px;
		}
		.panel-section {
			display: none;
			min-height: calc(100vh - 48px);
		}
		.panel-section.active {
			display: block;
		}
		.agents-toolbar {
			padding: 10px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.agents-toolbar .toolbar-input {
			flex: 1;
		}
		.agents-body {
			padding: 10px 8px;
			display: grid;
			gap: 6px;
		}
		.agent-row {
			display: grid;
			grid-template-columns: auto 1fr auto;
			gap: 10px;
			align-items: center;
			padding: 8px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 10px;
			background: var(--vscode-editorWidget-background);
		}
		.agent-row.disabled {
			opacity: 0.55;
		}
		.agent-title {
			font-weight: 600;
		}
		.agent-description,
		.agent-path,
		.location,
		.agent-meta {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		.agent-meta {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
		}
		.agent-path {
			word-break: break-all;
		}
		.agent-actions {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.switch input {
			display: none;
		}
		.switch span {
			display: inline-block;
			width: 34px;
			height: 18px;
			border-radius: 999px;
			background: #d85b74;
			position: relative;
			vertical-align: middle;
		}
		.switch span::after {
			content: "";
			position: absolute;
			width: 14px;
			height: 14px;
			top: 2px;
			left: 2px;
			border-radius: 50%;
			background: #6e6e6e;
			transition: left 0.12s ease;
		}
		.switch input:checked + span {
			background: var(--vscode-testing-iconPassed);
		}
		.switch input:checked + span::after {
			left: 18px;
		}
		@media (prefers-color-scheme: dark) {
			.switch span::after {
				background: #ffffff;
			}
		}
		.row-icon {
			font-size: 22px;
			color: var(--vscode-descriptionForeground);
		}
		.empty {
			color: var(--vscode-descriptionForeground);
		}
		.orch-layout {
			display: grid;
			grid-template-rows: auto auto 1fr auto;
			min-height: calc(100vh - 48px);
		}
		.orch-toolbar,
		.card-toolbar {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			padding: 10px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.orch-toolbar .toolbar-select,
		.orch-toolbar .toolbar-input {
			min-width: 180px;
			max-width: 260px;
		}
		.orch-main {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			min-height: 0;
		}
		.canvas-column {
			min-height: 0;
			display: grid;
			grid-template-rows: auto 1fr;
			border-right: 1px solid var(--vscode-panel-border);
		}
		.canvas-shell {
			position: relative;
			min-height: 520px;
			overflow: auto;
			background:
				radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--vscode-descriptionForeground) 18%, transparent) 1px, transparent 0) 0 0 / 18px 18px,
				linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-focusBorder) 8%), var(--vscode-editor-background));
		}
		#edgeLayer,
		#canvas {
			position: absolute;
			inset: 0;
			min-width: 1200px;
			min-height: 720px;
		}
		#edgeLayer {
			pointer-events: none;
		}
		#edgeLayer .edge-hit {
			pointer-events: stroke;
			cursor: pointer;
		}
		.flow-card {
			position: absolute;
			width: var(--card-width);
			min-height: var(--card-height);
			border-radius: 16px;
			border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 76%, var(--vscode-focusBorder) 24%);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 94%, var(--vscode-editor-background) 6%);
			box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
			padding: 14px 16px;
			box-sizing: border-box;
			user-select: none;
		}
		.flow-card.selected {
			outline: 2px solid var(--vscode-focusBorder, #0e639c);
			outline-offset: 1px;
		}
		.flow-card.has-error {
			border-color: var(--vscode-testing-iconFailed);
		}
		.flow-card.has-warning {
			border-color: var(--vscode-testing-iconQueued);
		}
		.flow-card.review {
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 80%, var(--vscode-testing-iconQueued) 20%);
		}
		.flow-card.output {
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 86%, var(--vscode-testing-iconPassed) 14%);
		}
		.flow-card.start {
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 84%, var(--vscode-terminal-ansiBlue) 16%);
		}
		.card-head {
			display: flex;
			align-items: center;
			gap: 10px;
			cursor: grab;
		}
		.card-head:active {
			cursor: grabbing;
		}
		.card-icon {
			width: 28px;
			height: 28px;
			border-radius: 10px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
		}
		.card-title {
			font-weight: 700;
			font-size: 13px;
			line-height: 1.3;
			flex: 1;
		}
		.card-dot {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			flex: none;
		}
		.card-dot.valid {
			background: var(--vscode-testing-iconPassed);
		}
		.card-dot.warning {
			background: var(--vscode-testing-iconQueued);
		}
		.card-dot.disabled {
			background: var(--vscode-disabledForeground);
		}
		.card-role {
			margin-top: 10px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			font-weight: 600;
		}
		.card-summary {
			margin-top: 4px;
			font-size: 12px;
			line-height: 1.4;
			color: var(--vscode-descriptionForeground);
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}
		.port {
			position: absolute;
			top: 50%;
			width: 16px;
			height: 16px;
			margin-top: -8px;
			border-radius: 50%;
			border: 2px solid var(--vscode-editor-background);
			background: var(--vscode-button-background);
			padding: 0;
		}
		.port[data-port="input"] {
			left: -8px;
		}
		.port[data-port="output"] {
			right: -8px;
		}
		.port[hidden] {
			display: none;
		}
		.canvas-hint {
			position: sticky;
			left: 12px;
			top: 12px;
			display: inline-flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent);
			border: 1px solid var(--vscode-panel-border);
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			backdrop-filter: blur(8px);
		}
		.inspector {
			min-height: 0;
			padding: 14px;
			display: grid;
			align-content: start;
			gap: 14px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editorWidget-background) 18%);
			overflow: auto;
		}
		.inspector-shell {
			width: 340px;
			min-width: 260px;
			max-width: 560px;
			resize: horizontal;
			overflow: auto;
			border-left: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editorWidget-background) 18%);
		}
		.inspector-shell.collapsed {
			width: 0;
			min-width: 0;
			max-width: 0;
			resize: none;
			overflow: hidden;
			border-left: 0;
		}
		.inspector-card {
			padding: 12px;
			border-radius: 12px;
			border: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 95%, var(--vscode-editor-background) 5%);
			display: grid;
			align-content: start;
			gap: 10px;
		}
		.inspector h3,
		.preview-panel h3 {
			margin: 0;
			font-size: 13px;
		}
		.field-group {
			display: grid;
			gap: 6px;
			min-width: 0;
		}
		.field-label {
			font-size: 12px;
			font-weight: 600;
		}
		.field-help {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		}
		.inspector textarea {
			min-height: 88px;
			resize: vertical;
			overflow-wrap: anywhere;
			word-break: break-word;
			white-space: pre-wrap;
		}
		.inspector details {
			border-top: 1px solid var(--vscode-panel-border);
			padding-top: 8px;
		}
		.inspector summary {
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
		}
		.preview-layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			border-top: 1px solid var(--vscode-panel-border);
			min-height: 220px;
		}
		.preview-panel {
			padding: 14px;
			display: grid;
			gap: 10px;
		}
		.preview-content {
			margin: 0;
			padding: 14px;
			border-radius: 12px;
			border: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 98%, transparent);
			font-size: 12px;
			line-height: 1.55;
			min-height: 180px;
		}
		.markdown-content h1,
		.markdown-content h2,
		.markdown-content h3,
		.markdown-content h4,
		.markdown-content h5,
		.markdown-content h6,
		.markdown-content p,
		.markdown-content ul,
		.markdown-content ol,
		.markdown-content blockquote {
			margin: 0 0 10px;
		}
		.markdown-content ul,
		.markdown-content ol {
			padding-left: 18px;
		}
		.markdown-content pre {
			margin: 0 0 10px;
			padding: 10px;
			border-radius: 8px;
			background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
			overflow: auto;
		}
		.markdown-content code {
			font-family: var(--vscode-editor-font-family, ${webviewFontFamily});
		}
		.validation-list {
			display: grid;
			gap: 8px;
		}
		.validation-item {
			padding: 10px;
			border-radius: 10px;
			border: 1px solid var(--vscode-panel-border);
			font-size: 12px;
			line-height: 1.45;
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent);
		}
		.validation-item.error {
			border-color: color-mix(in srgb, var(--vscode-testing-iconFailed) 44%, var(--vscode-panel-border) 56%);
		}
		.validation-item.warning {
			border-color: color-mix(in srgb, var(--vscode-testing-iconQueued) 44%, var(--vscode-panel-border) 56%);
		}
		.status-banner {
			padding: 8px 12px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			border-bottom: 1px solid var(--vscode-panel-border);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent);
		}
		.status-banner:empty {
			display: none;
		}
		@media (max-width: 1000px) {
			.orch-main,
			.preview-layout {
				grid-template-columns: 1fr;
			}
			.inspector-shell {
				width: auto;
				max-width: none;
				min-width: 0;
				resize: none;
				border-left: 0;
				border-top: 1px solid var(--vscode-panel-border);
			}
		}
	</style>
</head>
<body>
	<nav class="manager-tabs" aria-label="AGENTS Manager Tabs">
		<button class="manager-tab active" data-tab-target="agents" type="button"><span class="codicon codicon-hubot" aria-hidden="true"></span>Agents</button>
		<button class="manager-tab" data-tab-target="orchestration" type="button"><span class="codicon codicon-graph" aria-hidden="true"></span>Orchestration</button>
	</nav>

	<section id="agentsPanel" class="panel-section active">
		<div class="agents-toolbar">
			<input id="searchInput" class="toolbar-input" type="text" placeholder="${escapeHtml(messages.agentManagerSearchPlaceholder)}" />
			<button id="clearSearch" class="icon-button" type="button" title="${escapeHtml(messages.historyClear)}" aria-label="${escapeHtml(messages.historyClear)}"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
			<button id="refreshList" class="icon-button" type="button" title="${escapeHtml(messages.commandRefresh)}" aria-label="${escapeHtml(messages.commandRefresh)}"><span class="codicon codicon-refresh" aria-hidden="true"></span></button>
		</div>
		<div id="agentsList" class="agents-body"></div>
	</section>

	<section id="orchestrationPanel" class="panel-section">
		<div id="statusBanner" class="status-banner"></div>
		<div class="orch-layout">
			<div class="orch-toolbar">
				<button id="newWorkflowButton" class="secondary-button" type="button"><span class="codicon codicon-file-add" aria-hidden="true"></span>New</button>
				<select id="savedWorkflowSelect" class="toolbar-select"></select>
				<button id="loadWorkflowButton" class="secondary-button" type="button"><span class="codicon codicon-folder-opened" aria-hidden="true"></span>Load</button>
				<button id="saveWorkflowButton" class="secondary-button" type="button"><span class="codicon codicon-save" aria-hidden="true"></span>Save</button>
				<button id="deleteWorkflowButton" class="secondary-button" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete</button>
				<button id="toggleInspectorButton" class="secondary-button" type="button"><span class="codicon codicon-layout-sidebar-right" aria-hidden="true"></span>Hide Inspector</button>
				<button id="generatePromptButton" class="primary-button" type="button"><span class="codicon codicon-play" aria-hidden="true"></span>Generate Prompt</button>
				<button id="copyPromptButton" class="secondary-button" type="button"><span class="codicon codicon-copy" aria-hidden="true"></span>Copy</button>
			</div>
			<div class="orch-main">
				<div class="canvas-column">
					<div class="card-toolbar">
						<button class="secondary-button" data-add-card="start" type="button">Add Start</button>
						<button class="secondary-button" data-add-card="agentTask" type="button">Add Agent Task</button>
						<button class="secondary-button" data-add-card="output" type="button">Add Output</button>
					</div>
					<div id="canvasShell" class="canvas-shell">
						<div class="canvas-hint"><span class="codicon codicon-debug-alt-small" aria-hidden="true"></span>Drag cards. Connect from the right port to the left port.</div>
						<svg id="edgeLayer"></svg>
						<div id="canvas"></div>
					</div>
				</div>
				<div id="inspectorShell" class="inspector-shell">
					<aside id="inspector" class="inspector"></aside>
				</div>
			</div>
			<div class="preview-layout single">
				<div class="preview-panel">
					<h3>Prompt Preview</h3>
					<div id="promptPreview" class="markdown-content preview-content"></div>
				</div>
			</div>
		</div>
	</section>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const initialPayload = ${payload};
		const cardWidth = 220;
		const cardHeight = 112;
		const appState = {
			activeTab: 'agents',
			agentSearch: '',
			workflow: initialPayload.workflow,
			selectedWorkflowId: '',
			selection: { kind: 'workflow' },
			validation: { errors: [], warnings: [] },
			prompt: '',
			statusMessage: '',
			agents: initialPayload.agents,
			agentRowsHtml: initialPayload.agentRowsHtml,
			savedWorkflows: initialPayload.savedWorkflows,
			orchestrationDirectory: initialPayload.orchestrationDirectory,
			inspectorCollapsed: false,
			connectDraft: null,
			dragState: null,
		};

		const tabs = document.querySelectorAll('[data-tab-target]');
		const searchInput = document.getElementById('searchInput');
		const agentsList = document.getElementById('agentsList');
		const savedWorkflowSelect = document.getElementById('savedWorkflowSelect');
		const canvas = document.getElementById('canvas');
		const edgeLayer = document.getElementById('edgeLayer');
		const canvasShell = document.getElementById('canvasShell');
		const inspectorShell = document.getElementById('inspectorShell');
		const inspector = document.getElementById('inspector');
		const promptPreview = document.getElementById('promptPreview');
		const statusBanner = document.getElementById('statusBanner');
		const copyPromptButton = document.getElementById('copyPromptButton');
		const toggleInspectorButton = document.getElementById('toggleInspectorButton');

		function escapeHtmlClient(value) {
			return String(value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');
		}

		function persistState() {}

		function makeId(prefix) {
			return prefix + '-' + Math.random().toString(16).slice(2, 10);
		}

		function getAgentNames() {
			return appState.agents.map((agent) => agent.name);
		}

		function createNode(cardType) {
			const base = {
				nodeId: makeId(cardType),
				cardType,
				x: 120 + (appState.workflow.nodes.length % 4) * 220,
				y: 80 + Math.floor(appState.workflow.nodes.length / 4) * 150,
			};
			if (cardType === 'start') {
				return { ...base, cardType: 'start', title: 'Start', goal: '' };
			}
			if (cardType === 'output') {
				return { ...base, cardType: 'output', title: 'Output', outputFormat: '' };
			}
			if (cardType === 'review') {
				return {
					...base,
					cardType: 'review',
					agentName: getAgentNames()[0] || '',
					role: 'Review',
					summary: '成果物のレビュー',
					instruction: '',
					outputContract: '',
				};
			}
			return {
				...base,
				cardType: 'agentTask',
				agentName: getAgentNames()[0] || '',
				agentSource: '',
				role: '',
				summary: '',
				instruction: '',
				outputContract: '',
				handoffMessage: '',
				doneCriteria: '',
				model: '',
				sandboxMode: '',
				reasoningEffort: '',
			};
		}

		function getNodeById(nodeId) {
			return appState.workflow.nodes.find((node) => node.nodeId === nodeId);
		}

		function getSelectedNode() {
			return appState.selection.kind === 'node'
				? getNodeById(appState.selection.nodeId)
				: undefined;
		}

		function getSelectedEdge() {
			return appState.selection.kind === 'edge'
				? appState.workflow.edges.find((edge) => edge.edgeId === appState.selection.edgeId)
				: undefined;
		}

		function setStatus(message) {
			appState.statusMessage = message;
			renderStatus();
			persistState();
		}

		function renderStatus() {
			statusBanner.textContent = appState.statusMessage || '';
		}

		function switchTab(target) {
			appState.activeTab = target;
			document.querySelectorAll('.panel-section').forEach((panel) => {
				panel.classList.toggle('active', panel.id === (target === 'agents' ? 'agentsPanel' : 'orchestrationPanel'));
			});
			tabs.forEach((button) => {
				button.classList.toggle('active', button.dataset.tabTarget === target);
			});
			persistState();
		}

		function filterAgents() {
			const normalized = appState.agentSearch.trim().toLocaleLowerCase();
			if (!normalized) {
				return appState.agents;
			}
			return appState.agents.filter((agent) =>
				[
					agent.name,
					agent.description,
					agent.model,
					agent.reasoningEffort,
					agent.sandboxMode,
					agent.agentPath,
				].some((value) => String(value || '').toLocaleLowerCase().includes(normalized)),
			);
		}

		function buildAgentRow(agent) {
			const disabledClass = agent.enabled ? '' : ' disabled';
			return '<article class="agent-row' + disabledClass + '" data-filter-text="' + escapeHtmlClient((agent.name + ' ' + agent.description + ' ' + agent.model + ' ' + agent.reasoningEffort + ' ' + agent.sandboxMode + ' ' + agent.agentPath).toLocaleLowerCase()) + '">' +
				'<span class="codicon codicon-hubot row-icon" aria-hidden="true"></span>' +
				'<div class="agent-main">' +
					'<div class="agent-title">' + escapeHtmlClient(agent.name) + '</div>' +
					'<div class="agent-description">' + escapeHtmlClient(agent.description) + '</div>' +
					'<div class="agent-meta">' +
						'<span>' + escapeHtmlClient(agent.model) + '</span>' +
						'<span>' + escapeHtmlClient(agent.reasoningEffort) + '</span>' +
						'<span>' + escapeHtmlClient(agent.sandboxMode) + '</span>' +
					'</div>' +
					'<div class="agent-path" title="' + escapeHtmlClient(agent.locationLabel + ': ' + agent.agentPath) + '">' + escapeHtmlClient(agent.agentPath) + '</div>' +
				'</div>' +
				'<div class="agent-actions">' +
					'<span class="location">' + escapeHtmlClient(agent.locationLabel) + '</span>' +
					'<label class="switch">' +
						'<input type="checkbox" data-agent-name="' + escapeHtmlClient(agent.name) + '" ' + (agent.enabled ? 'checked' : '') + ' />' +
						'<span></span>' +
					'</label>' +
					'<button class="icon-button" type="button" data-open-path="' + escapeHtmlClient(agent.agentPath) + '" title="${escapeHtml(messages.agentManagerOpen)}" aria-label="${escapeHtml(messages.agentManagerOpen)}"><span class="codicon codicon-file-text" aria-hidden="true"></span></button>' +
				'</div>' +
			'</article>';
		}

		function renderAgentsList() {
			const filtered = filterAgents();
			agentsList.innerHTML = filtered.length > 0
				? filtered.map(buildAgentRow).join('')
				: '<p class="empty">${escapeHtml(messages.agentManagerNoResult)}</p>';
		}

		function renderWorkflowSelectors() {
			if (appState.savedWorkflows.length === 0) {
				appState.selectedWorkflowId = '';
				savedWorkflowSelect.innerHTML = '<option value="">No saved workflows</option>';
				savedWorkflowSelect.disabled = true;
				return;
			}
			savedWorkflowSelect.disabled = false;
			savedWorkflowSelect.innerHTML = appState.savedWorkflows
				.map((workflow) => {
					const selected = workflow.workflowId === appState.selectedWorkflowId ? 'selected' : '';
					return '<option value="' + escapeHtmlClient(workflow.workflowId) + '" ' + selected + '>' + escapeHtmlClient(workflow.name) + '</option>';
				})
				.join('');
			if (!appState.selectedWorkflowId) {
				appState.selectedWorkflowId = appState.savedWorkflows[0].workflowId;
			}
			savedWorkflowSelect.value = appState.selectedWorkflowId;
		}

		function renderInlineMarkdown(markdown) {
			const tick = String.fromCharCode(96);
			return escapeHtmlClient(String(markdown || ''))
				.replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>')
				.replace(new RegExp('\\\\*\\\\*([^*]+)\\\\*\\\\*', 'g'), '<strong>$1</strong>')
				.replace(new RegExp('\\\\*([^*]+)\\\\*', 'g'), '<em>$1</em>');
		}

		function renderMarkdown(markdown) {
			const newline = String.fromCharCode(10);
			const source = String(markdown || '').replace(new RegExp('\\\\r\\\\n', 'g'), newline);
			const codeBlocks = [];
			const fence = String.fromCharCode(96).repeat(3);
			const withPlaceholders = source.replace(new RegExp(fence + '([^\\n]*)\\n([\\s\\S]*?)' + fence, 'g'), (_, language, code) => {
				const className = String(language || '').trim();
				const rendered =
					'<pre><code' +
					(className ? ' class="language-' + escapeHtmlClient(className) + '"' : '') +
					'>' +
					escapeHtmlClient(String(code).replace(new RegExp(newline + '$'), '')) +
					'</code></pre>';
				const token = '__CODE_BLOCK_' + codeBlocks.length + '__';
				codeBlocks.push({ token, rendered });
				return token;
			});
			const blocks = withPlaceholders
				.split(new RegExp('\\\\n{2,}'))
				.map((block) => block.trim())
				.filter(Boolean);
			const renderedBlocks = blocks.map((block) => {
				if (new RegExp('^__CODE_BLOCK_\\\\d+__$').test(block)) {
					return block;
				}
				if (new RegExp('^#{1,6}\\\\s+').test(block)) {
					const headingMatch = block.match(new RegExp('^(#{1,6})\\\\s+([\\\\s\\\\S]+)$'));
					if (headingMatch) {
						const level = Math.min(headingMatch[1].length, 6);
						return '<h' + level + '>' + renderInlineMarkdown(headingMatch[2].trim()) + '</h' + level + '>';
					}
				}
				if (new RegExp('^(?:[-*]\\\\s+.+\\\\n?)+$').test(block)) {
					const items = block
						.split(newline)
						.map((line) => line.replace(new RegExp('^[-*]\\\\s+'), '').trim())
						.filter(Boolean)
						.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>')
						.join('');
					return '<ul>' + items + '</ul>';
				}
				return '<p>' + renderInlineMarkdown(block).replaceAll(newline, '<br />') + '</p>';
			});
			return codeBlocks.reduce(
				(html, block) => html.replace(block.token, block.rendered),
				renderedBlocks.join(''),
			);
		}

		function getNodeIcon(node) {
			if (node.cardType === 'start') {
				return 'codicon-debug-start';
			}
			if (node.cardType === 'review') {
				return 'codicon-eye';
			}
			if (node.cardType === 'output') {
				return 'codicon-inbox';
			}
			return 'codicon-hubot';
		}

		function getNodeTitle(node) {
			if (node.cardType === 'start') {
				return node.title;
			}
			if (node.cardType === 'output') {
				return node.title;
			}
			return node.agentName || (node.cardType === 'review' ? 'Review' : 'Agent Task');
		}

		function getNodeRole(node) {
			if (node.cardType === 'start') {
				return 'Workflow goal';
			}
			if (node.cardType === 'output') {
				return 'Final output';
			}
			return node.cardType === 'review' ? 'Review' : 'Task';
		}

		function getNodeSummary(node) {
			if (node.cardType === 'start') {
				return node.goal || 'Set the workflow goal in the inspector.';
			}
			if (node.cardType === 'output') {
				return node.outputFormat || 'Describe the final response format.';
			}
			return node.instruction || 'Describe the task in the inspector.';
		}

		function getNodeStatus(node) {
			if (node.cardType === 'start') {
				return node.goal.trim() ? 'valid' : 'warning';
			}
			if (node.cardType === 'output') {
				return node.outputFormat.trim() ? 'valid' : 'warning';
			}
			return node.agentName.trim() && node.instruction.trim() && node.outputContract.trim()
				? 'valid'
				: 'warning';
		}

		function portPosition(node, side) {
			return {
				x: node.x + (side === 'output' ? cardWidth : 0),
				y: node.y + cardHeight / 2,
			};
		}

		function edgePath(edge) {
			const source = getNodeById(edge.sourceNodeId);
			const target = getNodeById(edge.targetNodeId);
			if (!source || !target) {
				return '';
			}
			const from = portPosition(source, 'output');
			const to = portPosition(target, 'input');
			const delta = Math.max(80, Math.abs(to.x - from.x) / 2);
			return 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + delta) + ' ' + from.y + ', ' + (to.x - delta) + ' ' + to.y + ', ' + to.x + ' ' + to.y;
		}

		function inferEdgeKind(edge) {
			const target = getNodeById(edge.targetNodeId);
			if (target && target.cardType === 'review') {
				return 'review';
			}
			const sourceBranchCount = appState.workflow.edges.filter((item) => item.sourceNodeId === edge.sourceNodeId).length;
			return sourceBranchCount > 1 ? 'parallel' : 'sequential';
		}

		function renderCanvas() {
			canvas.innerHTML = appState.workflow.nodes
				.map((node) => {
					const selected = appState.selection.kind === 'node' && appState.selection.nodeId === node.nodeId ? ' selected' : '';
					const validationLevel = getValidationLevelForNode(node.nodeId);
					const validationClass = validationLevel ? ' has-' + validationLevel : '';
					const summary = getNodeSummary(node);
					return '<article class="flow-card ' + escapeHtmlClient(node.cardType) + selected + validationClass + '" data-node-id="' + escapeHtmlClient(node.nodeId) + '" style="left:' + node.x + 'px;top:' + node.y + 'px;">' +
						'<button class="port" data-port="input" data-node-id="' + escapeHtmlClient(node.nodeId) + '" ' + (node.cardType === 'start' ? 'hidden' : '') + '></button>' +
						'<div class="card-head" data-drag-handle="' + escapeHtmlClient(node.nodeId) + '">' +
							'<span class="card-icon codicon ' + getNodeIcon(node) + '" aria-hidden="true"></span>' +
							'<div class="card-title">' + escapeHtmlClient(getNodeTitle(node)) + '</div>' +
							'<span class="card-dot ' + getNodeStatus(node) + '" aria-hidden="true"></span>' +
						'</div>' +
						'<div class="card-role">' + escapeHtmlClient(getNodeRole(node)) + '</div>' +
						'<div class="card-summary">' + escapeHtmlClient(summary) + '</div>' +
						'<button class="port" data-port="output" data-node-id="' + escapeHtmlClient(node.nodeId) + '" ' + (node.cardType === 'output' ? 'hidden' : '') + '></button>' +
					'</article>';
				})
				.join('');
			const edges = appState.workflow.edges
				.map((edge) => {
					const path = edgePath(edge);
					if (!path) {
						return '';
					}
					const selected = appState.selection.kind === 'edge' && appState.selection.edgeId === edge.edgeId;
					const validationLevel = getValidationLevelForEdge(edge.edgeId);
					const stroke = validationLevel === 'error'
						? 'var(--vscode-testing-iconFailed)'
						: validationLevel === 'warning'
							? 'var(--vscode-testing-iconQueued)'
							: selected
								? 'var(--vscode-focusBorder)'
								: 'var(--vscode-descriptionForeground)';
					return '<g data-edge-id="' + escapeHtmlClient(edge.edgeId) + '">' +
						'<path d="' + path + '" stroke="' + stroke + '" stroke-width="' + (selected ? '3' : '2') + '" fill="none" opacity="' + (selected || validationLevel ? '1' : '0.75') + '"></path>' +
						'<path class="edge-hit" data-edge-id="' + escapeHtmlClient(edge.edgeId) + '" d="' + path + '" stroke="transparent" stroke-width="14" fill="none"></path>' +
					'</g>';
				})
				.join('');
			const draft = appState.connectDraft
				? (() => {
					const source = getNodeById(appState.connectDraft.sourceNodeId);
					if (!source) {
						return '';
					}
					const from = portPosition(source, 'output');
					const to = appState.connectDraft.pointer;
					const delta = Math.max(80, Math.abs(to.x - from.x) / 2);
					const path = 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + delta) + ' ' + from.y + ', ' + (to.x - delta) + ' ' + to.y + ', ' + to.x + ' ' + to.y;
					return '<path d="' + path + '" stroke="var(--vscode-focusBorder)" stroke-width="2" stroke-dasharray="6 6" fill="none"></path>';
				})()
				: '';
			edgeLayer.setAttribute('width', '1600');
			edgeLayer.setAttribute('height', '960');
			edgeLayer.innerHTML = edges + draft;
		}

		function currentValidationItems() {
			return [
				...appState.validation.errors.map((item) => ({ ...item, level: 'error' })),
				...appState.validation.warnings.map((item) => ({ ...item, level: 'warning' })),
			];
		}

		function getValidationItemsForSelection(selection) {
			const items = currentValidationItems();
			if (!selection || selection.kind === 'workflow') {
				return items;
			}
			if (selection.kind === 'node') {
				return items.filter((item) => item.nodeId === selection.nodeId);
			}
			if (selection.kind === 'edge') {
				return items.filter((item) => item.edgeId === selection.edgeId);
			}
			return [];
		}

		function getValidationLevelForNode(nodeId) {
			if (appState.validation.errors.some((item) => item.nodeId === nodeId)) {
				return 'error';
			}
			if (appState.validation.warnings.some((item) => item.nodeId === nodeId)) {
				return 'warning';
			}
			return null;
		}

		function getValidationLevelForEdge(edgeId) {
			if (appState.validation.errors.some((item) => item.edgeId === edgeId)) {
				return 'error';
			}
			if (appState.validation.warnings.some((item) => item.edgeId === edgeId)) {
				return 'warning';
			}
			return null;
		}

		function buildInspectorValidation(items) {
			if (items.length === 0) {
				return '';
			}
			return '<div class="inspector-card">' +
				'<h3>Validation</h3>' +
				items
					.map((item) =>
						'<div class="validation-item ' + item.level + '">' + escapeHtmlClient(item.message) + '</div>')
					.join('') +
			'</div>';
		}

		function requestValidation() {
			vscode.postMessage({ type: 'validateWorkflow', workflow: appState.workflow });
		}

		function renderPreview() {
			promptPreview.innerHTML = appState.prompt
				? renderMarkdown(appState.prompt)
				: '<p>Generated prompt will appear here.</p>';
			copyPromptButton.disabled = !appState.prompt;
		}

		function captureInspectorFocusState() {
			const activeElement = document.activeElement;
			if (!activeElement || !inspector.contains(activeElement)) {
				return null;
			}
			const isTextInput = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;
			const isSelect = activeElement instanceof HTMLSelectElement;
			if (!isTextInput && !isSelect) {
				return null;
			}
			return {
				id: activeElement.id || '',
				nodeId: activeElement.dataset ? activeElement.dataset.nodeId || '' : '',
				nodeField: activeElement.dataset ? activeElement.dataset.nodeField || '' : '',
				workflowField: activeElement.dataset ? activeElement.dataset.workflowField || '' : '',
				selectionStart: isTextInput && typeof activeElement.selectionStart === 'number' ? activeElement.selectionStart : null,
				selectionEnd: isTextInput && typeof activeElement.selectionEnd === 'number' ? activeElement.selectionEnd : null,
				scrollTop: typeof activeElement.scrollTop === 'number' ? activeElement.scrollTop : 0,
				scrollLeft: typeof activeElement.scrollLeft === 'number' ? activeElement.scrollLeft : 0,
				inspectorScrollTop: inspector.scrollTop,
			};
		}

		function findInspectorField(focusState) {
			if (!focusState) {
				return null;
			}
			if (focusState.id) {
				const byId = document.getElementById(focusState.id);
				if (byId && inspector.contains(byId)) {
					return byId;
				}
			}
			if (focusState.workflowField) {
				return inspector.querySelector('[data-workflow-field="' + focusState.workflowField + '"]');
			}
			if (focusState.nodeId && focusState.nodeField) {
				return inspector.querySelector(
					'[data-node-id="' + focusState.nodeId + '"][data-node-field="' + focusState.nodeField + '"]',
				);
			}
			return null;
		}

		function restoreInspectorFocusState(focusState) {
			const field = findInspectorField(focusState);
			if (!field || !(field instanceof HTMLElement)) {
				return;
			}
			field.focus();
			const canRestoreSelection =
				(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
				typeof focusState.selectionStart === 'number' &&
				typeof focusState.selectionEnd === 'number';
			if (canRestoreSelection) {
				field.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
			}
			if (typeof focusState.inspectorScrollTop === 'number') {
				inspector.scrollTop = focusState.inspectorScrollTop;
			}
			if ('scrollTop' in field && typeof focusState.scrollTop === 'number') {
				field.scrollTop = focusState.scrollTop;
			}
			if ('scrollLeft' in field && typeof focusState.scrollLeft === 'number') {
				field.scrollLeft = focusState.scrollLeft;
			}
			requestAnimationFrame(() => {
				if (!document.body.contains(field)) {
					return;
				}
				if (typeof focusState.inspectorScrollTop === 'number') {
					inspector.scrollTop = focusState.inspectorScrollTop;
				}
				if ('scrollTop' in field && typeof focusState.scrollTop === 'number') {
					field.scrollTop = focusState.scrollTop;
				}
				if ('scrollLeft' in field && typeof focusState.scrollLeft === 'number') {
					field.scrollLeft = focusState.scrollLeft;
				}
			});
		}

		function renderInspector() {
			const focusState = captureInspectorFocusState();
			const selectedNode = getSelectedNode();
			const selectedEdge = getSelectedEdge();
			if (selectedNode) {
				inspector.innerHTML = buildNodeInspector(selectedNode);
				restoreInspectorFocusState(focusState);
				return;
			}
			if (selectedEdge) {
				inspector.innerHTML = buildEdgeInspector(selectedEdge);
				restoreInspectorFocusState(focusState);
				return;
			}
			inspector.innerHTML = buildWorkflowInspector();
			restoreInspectorFocusState(focusState);
		}

		function renderInspectorShell() {
			inspectorShell.classList.toggle('collapsed', appState.inspectorCollapsed);
			toggleInspectorButton.innerHTML = appState.inspectorCollapsed
				? '<span class="codicon codicon-layout-sidebar-right" aria-hidden="true"></span>Show Inspector'
				: '<span class="codicon codicon-layout-sidebar-right" aria-hidden="true"></span>Hide Inspector';
		}

		function buildWorkflowInspector() {
			const validation = appState.validation;
			const deleteButton = appState.selectedWorkflowId
				? '<button class="secondary-button" data-delete-workflow="' + escapeHtmlClient(appState.selectedWorkflowId) + '" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete saved workflow</button>'
				: '';
			return '<div class="inspector-card">' +
				'<h3>Workflow</h3>' +
				'<div class="field-group">' +
					'<label class="field-label" for="workflowName">Name</label>' +
					'<input id="workflowName" data-workflow-field="name" value="' + escapeHtmlClient(appState.workflow.name || '') + '" />' +
				'</div>' +
				'<div class="field-help">Cards: ' + appState.workflow.nodes.length + ' / Connectors: ' + appState.workflow.edges.length + '</div>' +
				'<div class="field-help">Errors: ' + validation.errors.length + ' / Warnings: ' + validation.warnings.length + '</div>' +
				'<div class="field-help">Saved in: ' + escapeHtmlClient(appState.orchestrationDirectory) + '</div>' +
				deleteButton +
			'</div>' +
			buildInspectorValidation(getValidationItemsForSelection({ kind: 'workflow' }));
		}

		function buildEdgeInspector(edge) {
			const source = getNodeById(edge.sourceNodeId);
			const target = getNodeById(edge.targetNodeId);
			const kind = inferEdgeKind(edge);
			const kindDescription = kind === 'parallel'
				? '同じカードから複数カードへ分岐するため、プロンプト生成時は並列実行として扱います。'
				: kind === 'review'
					? 'レビューカードへ渡す接続です。入力元カードの成果物をレビュー対象として扱います。'
					: '前段の結果を次のカードへ順次渡す接続です。';
			return '<div class="inspector-card">' +
				'<h3>Connector</h3>' +
				'<div class="field-group"><div class="field-label">Source</div><div>' + escapeHtmlClient(source ? getNodeTitle(source) : edge.sourceNodeId) + '</div></div>' +
				'<div class="field-group"><div class="field-label">Target</div><div>' + escapeHtmlClient(target ? getNodeTitle(target) : edge.targetNodeId) + '</div></div>' +
				'<div class="field-group"><div class="field-label">Kind</div><div>' + escapeHtmlClient(kind) + '</div></div>' +
				'<div class="field-group"><div class="field-label">Description</div><div>' + escapeHtmlClient(kindDescription) + '</div></div>' +
				'<button class="secondary-button" data-delete-edge="' + escapeHtmlClient(edge.edgeId) + '" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete connector</button>' +
			'</div>' +
			buildInspectorValidation(getValidationItemsForSelection({ kind: 'edge', edgeId: edge.edgeId }));
		}

		function buildAgentOptions(selectedValue) {
			const options = ['<option value="">Select an agent</option>'];
			for (const agent of appState.agents) {
				const selected = agent.name === selectedValue ? 'selected' : '';
				options.push('<option value="' + escapeHtmlClient(agent.name) + '" ' + selected + '>' + escapeHtmlClient(agent.name) + '</option>');
			}
			return options.join('');
		}

		function buildNodeInspector(node) {
			if (node.cardType === 'start') {
				return '<div class="inspector-card">' +
					'<h3>Start</h3>' +
					'<div class="field-group">' +
						'<label class="field-label" for="startGoal">Goal</label>' +
						'<textarea id="startGoal" data-node-field="goal" data-node-id="' + escapeHtmlClient(node.nodeId) + '">' + escapeHtmlClient(node.goal) + '</textarea>' +
					'</div>' +
					'<button class="secondary-button" data-delete-node="' + escapeHtmlClient(node.nodeId) + '" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete card</button>' +
				'</div>';
			}
			if (node.cardType === 'output') {
				return '<div class="inspector-card">' +
					'<h3>Output</h3>' +
					'<div class="field-group">' +
						'<label class="field-label" for="outputFormat">Final output</label>' +
						'<textarea id="outputFormat" data-node-field="outputFormat" data-node-id="' + escapeHtmlClient(node.nodeId) + '">' + escapeHtmlClient(node.outputFormat) + '</textarea>' +
					'</div>' +
					'<button class="secondary-button" data-delete-node="' + escapeHtmlClient(node.nodeId) + '" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete card</button>' +
				'</div>';
			}
			return '<div class="inspector-card">' +
				'<h3>' + escapeHtmlClient(node.cardType === 'review' ? 'Review' : 'Agent Task') + '</h3>' +
				'<div class="field-group"><label class="field-label">Agent</label><select data-node-field="agentName" data-node-id="' + escapeHtmlClient(node.nodeId) + '">' + buildAgentOptions(node.agentName) + '</select></div>' +
				'<div class="field-group"><label class="field-label">Instruction</label><textarea data-node-field="instruction" data-node-id="' + escapeHtmlClient(node.nodeId) + '">' + escapeHtmlClient(node.instruction) + '</textarea></div>' +
				'<div class="field-group"><label class="field-label">Expected output</label><textarea data-node-field="outputContract" data-node-id="' + escapeHtmlClient(node.nodeId) + '">' + escapeHtmlClient(node.outputContract) + '</textarea></div>' +
				'<button class="secondary-button" data-delete-node="' + escapeHtmlClient(node.nodeId) + '" type="button"><span class="codicon codicon-trash" aria-hidden="true"></span>Delete card</button>' +
			'</div>' +
			buildInspectorValidation(getValidationItemsForSelection({ kind: 'node', nodeId: node.nodeId }));
		}

		function renderAll() {
			searchInput.value = appState.agentSearch;
			switchTab(appState.activeTab);
			renderAgentsList();
			renderWorkflowSelectors();
			renderCanvas();
			renderInspector();
			renderInspectorShell();
			renderPreview();
			renderStatus();
			persistState();
		}

		function selectNode(nodeId) {
			appState.selection = { kind: 'node', nodeId };
			renderCanvas();
			renderInspector();
			persistState();
		}

		function selectEdge(edgeId) {
			appState.selection = { kind: 'edge', edgeId };
			renderCanvas();
			renderInspector();
			persistState();
		}

		function selectWorkflow() {
			appState.selection = { kind: 'workflow' };
			renderCanvas();
			renderInspector();
			persistState();
		}

		function removeSelectedNode(nodeId) {
			appState.workflow.nodes = appState.workflow.nodes.filter((node) => node.nodeId !== nodeId);
			appState.workflow.edges = appState.workflow.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId);
			appState.prompt = '';
			selectWorkflow();
			setStatus('Card deleted.');
			renderAll();
			requestValidation();
		}

		function removeSelectedEdge(edgeId) {
			appState.workflow.edges = appState.workflow.edges.filter((edge) => edge.edgeId !== edgeId);
			appState.prompt = '';
			selectWorkflow();
			setStatus('Connector deleted.');
			renderAll();
			requestValidation();
		}

		function updateWorkflowField(field, value) {
			appState.workflow[field] = value;
			appState.prompt = '';
			persistState();
			requestValidation();
		}

		function updateNodeField(nodeId, field, value) {
			const node = getNodeById(nodeId);
			if (!node) {
				return;
			}
			node[field] = value;
			appState.prompt = '';
			renderCanvas();
			persistState();
			requestValidation();
		}

		function addNode(cardType) {
			if (cardType === 'start' && appState.workflow.nodes.some((node) => node.cardType === 'start')) {
				setStatus('Start card already exists.');
				return;
			}
			const node = createNode(cardType);
			appState.workflow.nodes.push(node);
			appState.selection = { kind: 'node', nodeId: node.nodeId };
			appState.prompt = '';
			renderAll();
			setStatus('Card added.');
			requestValidation();
		}

		function beginDrag(nodeId, event) {
			const node = getNodeById(nodeId);
			if (!node) {
				return;
			}
			appState.dragState = {
				nodeId,
				offsetX: event.clientX - node.x + canvasShell.scrollLeft,
				offsetY: event.clientY - node.y + canvasShell.scrollTop,
			};
		}

		function beginConnection(sourceNodeId) {
			const node = getNodeById(sourceNodeId);
			if (!node) {
				return;
			}
			const from = portPosition(node, 'output');
			appState.connectDraft = {
				sourceNodeId,
				pointer: from,
			};
			renderCanvas();
		}

		function finishConnection(targetNodeId) {
			if (!appState.connectDraft) {
				return;
			}
			const sourceNodeId = appState.connectDraft.sourceNodeId;
			appState.connectDraft = null;
			if (sourceNodeId === targetNodeId) {
				renderCanvas();
				return;
			}
			if (appState.workflow.edges.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId)) {
				renderCanvas();
				return;
			}
			appState.workflow.edges.push({
				edgeId: makeId('edge'),
				sourceNodeId,
				targetNodeId,
			});
			appState.prompt = '';
			renderCanvas();
			persistState();
			setStatus('Connector added.');
			requestValidation();
		}

		function handlePointerMove(event) {
			if (appState.dragState) {
				const node = getNodeById(appState.dragState.nodeId);
				if (!node) {
					return;
				}
				node.x = Math.max(24, event.clientX + canvasShell.scrollLeft - appState.dragState.offsetX);
				node.y = Math.max(24, event.clientY + canvasShell.scrollTop - appState.dragState.offsetY);
				renderCanvas();
				persistState();
			}
			if (appState.connectDraft) {
				const rect = canvasShell.getBoundingClientRect();
				appState.connectDraft.pointer = {
					x: event.clientX - rect.left + canvasShell.scrollLeft,
					y: event.clientY - rect.top + canvasShell.scrollTop,
				};
				renderCanvas();
			}
		}

		function clearPointerState() {
			appState.dragState = null;
			if (appState.connectDraft) {
				appState.connectDraft = null;
				renderCanvas();
			}
		}

		function handleBackendMessage(message) {
			if (message.type === 'workflowLoaded') {
				appState.workflow = message.workflow;
				appState.savedWorkflows = message.savedWorkflows;
				appState.selectedWorkflowId = message.workflow.workflowId;
				appState.selection = { kind: 'workflow' };
				appState.prompt = '';
				appState.validation = message.validation || { errors: [], warnings: [] };
				setStatus(message.status || 'Workflow loaded.');
				renderAll();
				return;
			}
			if (message.type === 'workflowSaved') {
				appState.workflow = message.workflow;
				appState.savedWorkflows = message.savedWorkflows;
				appState.selectedWorkflowId = message.workflow.workflowId;
				appState.validation = message.validation || appState.validation;
				setStatus(message.status || 'Workflow saved.');
				renderAll();
				return;
			}
			if (message.type === 'workflowDeleted') {
				appState.workflow = message.workflow;
				appState.savedWorkflows = message.savedWorkflows;
				appState.selectedWorkflowId = '';
				appState.selection = { kind: 'workflow' };
				appState.prompt = '';
				appState.validation = message.validation || { errors: [], warnings: [] };
				setStatus(message.status || 'Workflow deleted.');
				renderAll();
				return;
			}
			if (message.type === 'workflowValidation') {
				appState.validation = message.validation;
				setStatus(message.status || 'Validation updated.');
				renderCanvas();
				renderInspector();
				persistState();
				return;
			}
			if (message.type === 'workflowPrompt') {
				appState.validation = message.validation;
				appState.prompt = message.prompt;
				setStatus(message.status || 'Prompt generated.');
				renderInspector();
				renderPreview();
				renderCanvas();
				persistState();
				return;
			}
			if (message.type === 'clipboardCopied') {
				setStatus(message.status || 'Prompt copied.');
			}
			if (message.type === 'error') {
				setStatus(message.status || 'Action failed.');
			}
		}

		tabs.forEach((button) => {
			button.addEventListener('click', () => switchTab(button.dataset.tabTarget));
		});

		searchInput.addEventListener('input', () => {
			appState.agentSearch = searchInput.value;
			renderAgentsList();
			persistState();
		});

		document.getElementById('clearSearch').addEventListener('click', () => {
			appState.agentSearch = '';
			searchInput.value = '';
			renderAgentsList();
			searchInput.focus();
			persistState();
		});

		document.getElementById('refreshList').addEventListener('click', () => {
			vscode.postMessage({ type: 'refresh' });
		});

		agentsList.addEventListener('change', (event) => {
			const target = event.target;
			if (target && target.dataset && target.dataset.agentName) {
				vscode.postMessage({
					type: 'toggleAgent',
					name: target.dataset.agentName,
					enabled: Boolean(target.checked),
				});
			}
		});

		agentsList.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const openButton = target ? target.closest('[data-open-path]') : null;
			if (openButton && openButton.dataset && openButton.dataset.openPath) {
				vscode.postMessage({ type: 'openAgent', agentPath: openButton.dataset.openPath });
			}
		});

		document.getElementById('newWorkflowButton').addEventListener('click', () => {
			vscode.postMessage({ type: 'createWorkflow' });
		});

		document.getElementById('loadWorkflowButton').addEventListener('click', () => {
			if (!savedWorkflowSelect.value) {
				setStatus('No saved workflow selected.');
				return;
			}
			vscode.postMessage({ type: 'loadWorkflow', workflowId: savedWorkflowSelect.value });
		});

		document.getElementById('saveWorkflowButton').addEventListener('click', () => {
			vscode.postMessage({ type: 'saveWorkflow', workflow: appState.workflow });
		});

		document.getElementById('deleteWorkflowButton').addEventListener('click', () => {
			if (!savedWorkflowSelect.value) {
				setStatus('No saved workflow selected.');
				return;
			}
			vscode.postMessage({ type: 'deleteWorkflow', workflowId: savedWorkflowSelect.value });
		});

		document.getElementById('generatePromptButton').addEventListener('click', () => {
			vscode.postMessage({ type: 'generatePrompt', workflow: appState.workflow });
		});

		toggleInspectorButton.addEventListener('click', () => {
			appState.inspectorCollapsed = !appState.inspectorCollapsed;
			renderInspectorShell();
		});

		copyPromptButton.addEventListener('click', () => {
			if (!appState.prompt) {
				setStatus('No prompt to copy.');
				return;
			}
			vscode.postMessage({ type: 'copyPrompt', prompt: appState.prompt });
		});

		savedWorkflowSelect.addEventListener('change', () => {
			appState.selectedWorkflowId = savedWorkflowSelect.value;
			persistState();
		});

		document.querySelectorAll('[data-add-card]').forEach((button) => {
			button.addEventListener('click', () => addNode(button.dataset.addCard));
		});

		canvas.addEventListener('mousedown', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			const outputPort = target.closest('[data-port="output"]');
			if (outputPort && outputPort.dataset && outputPort.dataset.nodeId) {
				beginConnection(outputPort.dataset.nodeId);
				return;
			}
			const dragHandle = target.closest('[data-drag-handle]');
			if (dragHandle && dragHandle.dataset && dragHandle.dataset.dragHandle) {
				selectNode(dragHandle.dataset.dragHandle);
				beginDrag(dragHandle.dataset.dragHandle, event);
				return;
			}
			const nodeRoot = target.closest('[data-node-id]');
			if (nodeRoot && nodeRoot.dataset && nodeRoot.dataset.nodeId) {
				selectNode(nodeRoot.dataset.nodeId);
				return;
			}
			selectWorkflow();
		});

		canvas.addEventListener('mouseup', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const inputPort = target ? target.closest('[data-port="input"]') : null;
			if (inputPort && inputPort.dataset && inputPort.dataset.nodeId) {
				finishConnection(inputPort.dataset.nodeId);
			}
		});

		edgeLayer.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			const edgeTarget = target.closest('[data-edge-id]');
			if (edgeTarget && edgeTarget.dataset && edgeTarget.dataset.edgeId) {
				selectEdge(edgeTarget.dataset.edgeId);
			}
		});

		inspector.addEventListener('input', (event) => {
			const target = event.target;
			if (target && target.dataset && target.dataset.workflowField) {
				updateWorkflowField(target.dataset.workflowField, target.value);
				return;
			}
			if (target && target.dataset && target.dataset.nodeField && target.dataset.nodeId) {
				updateNodeField(target.dataset.nodeId, target.dataset.nodeField, target.value);
			}
		});

		inspector.addEventListener('change', (event) => {
			const target = event.target;
			if (target && target.dataset && target.dataset.nodeField && target.dataset.nodeId) {
				updateNodeField(target.dataset.nodeId, target.dataset.nodeField, target.value);
			}
		});

		inspector.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			const deleteNodeButton = target.closest('[data-delete-node]');
			if (deleteNodeButton && deleteNodeButton.dataset && deleteNodeButton.dataset.deleteNode) {
				removeSelectedNode(deleteNodeButton.dataset.deleteNode);
				return;
			}
			const deleteEdgeButton = target.closest('[data-delete-edge]');
			if (deleteEdgeButton && deleteEdgeButton.dataset && deleteEdgeButton.dataset.deleteEdge) {
				removeSelectedEdge(deleteEdgeButton.dataset.deleteEdge);
				return;
			}
			const deleteWorkflowButton = target.closest('[data-delete-workflow]');
			if (deleteWorkflowButton && deleteWorkflowButton.dataset && deleteWorkflowButton.dataset.deleteWorkflow) {
				vscode.postMessage({ type: 'deleteWorkflow', workflowId: deleteWorkflowButton.dataset.deleteWorkflow });
			}
		});

		document.addEventListener('mousemove', handlePointerMove);
		document.addEventListener('mouseup', clearPointerState);
		window.addEventListener('message', (event) => handleBackendMessage(event.data));

		renderAll();
		requestValidation();
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}

export class AgentManagerPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly onDidChangeAgents: () => void) {}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			this.refresh();
			return;
		}
		this.panel = vscode.window.createWebviewPanel(
			AGENT_MANAGER_VIEW_TYPE,
			messages.agentManagerTitle,
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: false,
				...(CODICON_RESOURCE_ROOTS.length > 0
					? { localResourceRoots: CODICON_RESOURCE_ROOTS }
					: {}),
			},
		);
		this.panel.iconPath = getCodiconIconPath('hubot');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage((message: InboundMessage) =>
			this.handleMessage(message),
		);
		this.render();
	}

	refresh(): void {
		if (!this.panel) {
			return;
		}
		this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private handleMessage(message: InboundMessage): void {
		if (message.type === 'ready') {
			return;
		}
		if (message.type === 'refresh') {
			this.refresh();
			return;
		}
		if (message.type === 'openAgent') {
			void vscode.commands.executeCommand(
				'vscode.open',
				vscode.Uri.file(message.agentPath),
			);
			return;
		}
		if (message.type === 'toggleAgent') {
			const { codexDir, configPath } = resolveAgentManagerPaths();
			if (message.enabled) {
				const result = enableAgentByName(codexDir, configPath, message.name);
				if (result.overwritten) {
					vscode.window.showInformationMessage(
						messages.agentManagerOverwritten(message.name),
					);
				}
			} else {
				disableAgentByName(codexDir, configPath, message.name);
			}
			vscode.window.showInformationMessage(messages.agent.toggleUpdated);
			this.onDidChangeAgents();
			this.refresh();
			return;
		}
		if (message.type === 'createWorkflow') {
			const workflow = createEmptyWorkflow();
			this.postToWebview({
				type: 'workflowLoaded',
				workflow,
				savedWorkflows: listSavedWorkflowSummaries(),
				validation: validateWorkflowDefinition(workflow),
				status: 'New workflow created.',
			});
			return;
		}
		if (message.type === 'saveWorkflow') {
			try {
				const workflow = saveWorkflowDefinition(message.workflow);
				this.postToWebview({
					type: 'workflowSaved',
					workflow,
					savedWorkflows: listSavedWorkflowSummaries(),
					validation: validateWorkflowDefinition(workflow),
					status: 'Workflow saved to .codex/orchestrations.',
				});
			} catch (error) {
				this.postToWebview({
					type: 'error',
					status: `Failed to save workflow: ${String(error)}`,
				});
			}
			return;
		}
		if (message.type === 'loadWorkflow') {
			try {
				const workflow = loadWorkflowDefinition(message.workflowId);
				this.postToWebview({
					type: 'workflowLoaded',
					workflow,
					savedWorkflows: listSavedWorkflowSummaries(),
					validation: validateWorkflowDefinition(workflow),
					status: 'Workflow loaded.',
				});
			} catch (error) {
				this.postToWebview({
					type: 'error',
					status: `Failed to load workflow: ${String(error)}`,
				});
			}
			return;
		}
		if (message.type === 'deleteWorkflow') {
			try {
				deleteWorkflowDefinition(message.workflowId);
				const workflow = createEmptyWorkflow();
				this.postToWebview({
					type: 'workflowDeleted',
					workflow,
					savedWorkflows: listSavedWorkflowSummaries(),
					validation: validateWorkflowDefinition(workflow),
					status: 'Workflow deleted.',
				});
			} catch (error) {
				this.postToWebview({
					type: 'error',
					status: `Failed to delete workflow: ${String(error)}`,
				});
			}
			return;
		}
		if (message.type === 'validateWorkflow') {
			const validation = validateWorkflowDefinition(message.workflow);
			this.postToWebview({
				type: 'workflowValidation',
				validation,
				status:
					validation.errors.length > 0
						? 'Validation found blocking errors.'
						: validation.warnings.length > 0
							? 'Validation found warnings.'
							: 'Validation passed.',
			});
			return;
		}
		if (message.type === 'generatePrompt') {
			const result = generateWorkflowPrompt(message.workflow);
			this.postToWebview({
				type: 'workflowPrompt',
				prompt: result.prompt,
				validation: result.validation,
				status:
					result.validation.errors.length > 0
						? 'Prompt generation blocked by validation errors.'
						: 'Prompt generated.',
			});
			return;
		}
		if (message.type === 'copyPrompt') {
			void vscode.env.clipboard.writeText(message.prompt).then(
				() =>
					this.postToWebview({
						type: 'clipboardCopied',
						status: 'Prompt copied to clipboard.',
					}),
				(error) =>
					this.postToWebview({
						type: 'error',
						status: `Failed to copy prompt: ${String(error)}`,
					}),
			);
		}
	}

	private render(): void {
		if (!this.panel) {
			return;
		}
		this.panel.webview.html = buildHtml(
			this.panel.webview,
			this.readRecords(),
			createEmptyWorkflow(),
		);
	}

	private readRecords(): AgentManagerRecord[] {
		const { configPath } = resolveAgentManagerPaths();
		return listAgentManagerRecords(configPath);
	}

	private postToWebview(message: Record<string, unknown>): void {
		if (!this.panel) {
			return;
		}
		void this.panel.webview.postMessage(message);
	}
}
