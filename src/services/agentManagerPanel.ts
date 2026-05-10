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
	CODICON_RESOURCE_ROOTS,
	getCodiconCssHref,
	getCodiconIconPath,
	getWebviewFontFamily,
} from './webviewAssets';

const AGENT_MANAGER_VIEW_TYPE = 'codex-workspace.agentManager';

type InboundMessage =
	| { type: 'ready' }
	| { type: 'search'; query: string }
	| { type: 'refresh' }
	| { type: 'openAgent'; agentPath: string }
	| { type: 'toggleAgent'; name: string; enabled: boolean };

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

function filterRecords(records: AgentManagerRecord[], query: string): AgentManagerRecord[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) {
		return records;
	}
	return records.filter((record) =>
		[
			record.name,
			record.description,
			record.model,
			record.reasoningEffort,
			record.sandboxMode,
			record.agentPath,
		].some((value) => value.toLocaleLowerCase().includes(normalized)),
	);
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

function buildHtml(webview: vscode.Webview, records: AgentManagerRecord[], query: string): string {
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
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	${codiconLink}
	<title>${escapeHtml(messages.agentManagerTitle)}</title>
	<style>
		body { margin: 0; font-family: ${webviewFontFamily}; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		button, input { font: inherit; }
		.toolbar { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; }
		.toolbar input { flex: 1; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 8px; padding: 6px 8px; }
		.toolbar input:focus { outline: none; border-color: var(--vscode-focusBorder, #0e639c); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0e639c); }
		.body { padding: 10px 8px; display: grid; gap: 6px; }
		.agent-row { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); }
		.agent-row.disabled { opacity: 0.55; }
		.agent-title { font-weight: 600; }
		.agent-description, .agent-path, .location, .agent-meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.agent-meta { display: flex; gap: 8px; flex-wrap: wrap; }
		.agent-path { word-break: break-all; }
		.agent-actions { display: flex; align-items: center; gap: 10px; }
		.switch input { display: none; }
		.switch span { display: inline-block; width: 34px; height: 18px; border-radius: 999px; background: #d85b74; position: relative; vertical-align: middle; }
		.switch span::after { content: ""; position: absolute; width: 14px; height: 14px; top: 2px; left: 2px; border-radius: 50%; background: #6e6e6e; transition: left 0.12s ease; }
		.switch input:checked + span { background: var(--vscode-testing-iconPassed); }
		.switch input:checked + span::after { left: 18px; }
		@media (prefers-color-scheme: dark) {
			.switch span::after { background: #ffffff; }
		}
		.icon-button { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
		.row-icon { font-size: 22px; color: var(--vscode-descriptionForeground); }
		.empty { color: var(--vscode-descriptionForeground); }
	</style>
</head>
<body>
	<section class="toolbar">
		<input id="searchInput" type="text" value="${escapeHtml(query)}" placeholder="${escapeHtml(messages.agentManagerSearchPlaceholder)}" />
		<button id="clearSearch" class="icon-button" type="button" title="${escapeHtml(messages.historyClear)}" aria-label="${escapeHtml(messages.historyClear)}"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
		<button id="refreshList" class="icon-button" type="button" title="${escapeHtml(messages.commandRefresh)}" aria-label="${escapeHtml(messages.commandRefresh)}"><span class="codicon codicon-refresh" aria-hidden="true"></span></button>
	</section>
	<section class="body">${buildRows(records)}</section>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const searchInput = document.getElementById('searchInput');
		const applyFilter = () => {
			const query = searchInput.value.trim().toLocaleLowerCase();
			document.querySelectorAll('.agent-row').forEach((row) => {
				const text = row.dataset?.filterText || '';
				row.style.display = query.length > 0 && !text.includes(query) ? 'none' : '';
			});
		};
		searchInput.addEventListener('input', applyFilter);
		document.getElementById('clearSearch')?.addEventListener('click', () => {
			searchInput.value = '';
			applyFilter();
			searchInput.focus();
		});
		document.getElementById('refreshList')?.addEventListener('click', () => {
			vscode.postMessage({ type: 'refresh' });
		});
		applyFilter();
		document.addEventListener('change', (event) => {
			const target = event.target;
			if (target?.dataset?.agentName) {
				vscode.postMessage({ type: 'toggleAgent', name: target.dataset.agentName, enabled: target.checked });
			}
		});
		document.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const openButton = target?.closest('[data-open-path]');
			if (openButton?.dataset?.openPath) {
				vscode.postMessage({ type: 'openAgent', agentPath: openButton.dataset.openPath });
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}

export class AgentManagerPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private records: AgentManagerRecord[] = [];
	private query = '';

	constructor(private readonly onDidChangeAgents: () => void) {}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			this.refresh();
			return;
		}
		this.records = this.readRecords();
		this.panel = vscode.window.createWebviewPanel(
			AGENT_MANAGER_VIEW_TYPE,
			messages.agentManagerTitle,
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
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
		this.records = this.readRecords();
		this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private handleMessage(message: InboundMessage): void {
		if (message.type === 'search') {
			this.query = message.query;
			this.render();
			return;
		}
		if (message.type === 'refresh') {
			this.refresh();
			return;
		}
		if (message.type === 'openAgent') {
			void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.agentPath));
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
		}
	}

	private render(): void {
		if (!this.panel) {
			return;
		}
		this.panel.webview.html = buildHtml(
			this.panel.webview,
			filterRecords(this.records, this.query),
			this.query,
		);
	}

	private readRecords(): AgentManagerRecord[] {
		const { configPath } = resolveAgentManagerPaths();
		return listAgentManagerRecords(configPath);
	}
}
