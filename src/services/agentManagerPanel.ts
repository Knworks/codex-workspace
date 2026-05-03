import * as vscode from 'vscode';
import { messages } from '../i18n';
import {
	AgentManagerRecord,
	disableAgentByName,
	enableAgentByName,
	listAgentManagerRecords,
	resolveAgentManagerPaths,
} from './agentManagerService';

const AGENT_MANAGER_VIEW_TYPE = 'codex-workspace.agentManager';

type InboundMessage =
	| { type: 'ready' }
	| { type: 'search'; query: string }
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
		return `<article class="agent-row${disabledClass}">
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
				<button type="button" data-open-path="${escapeHtml(record.agentPath)}">${escapeHtml(messages.agentManagerOpen)}</button>
			</div>
		</article>`;
	}).join('');
}

function buildHtml(webview: vscode.Webview, records: AgentManagerRecord[], query: string): string {
	const nonce = createNonce();
	const csp = [
		"default-src 'none'",
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>${escapeHtml(messages.agentManagerTitle)}</title>
	<style>
		body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		.toolbar { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
		.toolbar input { width: 100%; box-sizing: border-box; }
		.body { padding: 10px 12px; display: grid; gap: 8px; }
		.agent-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
		.agent-row.disabled { opacity: 0.55; }
		.agent-title { font-weight: 600; }
		.agent-description, .agent-path, .location, .agent-meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.agent-meta { display: flex; gap: 8px; flex-wrap: wrap; }
		.agent-path { word-break: break-all; }
		.agent-actions { display: flex; align-items: center; gap: 10px; }
		.switch input { display: none; }
		.switch span { display: inline-block; width: 34px; height: 18px; border-radius: 999px; background: var(--vscode-inputValidation-errorBorder); position: relative; vertical-align: middle; }
		.switch span::after { content: ""; position: absolute; width: 14px; height: 14px; top: 2px; left: 2px; border-radius: 50%; background: var(--vscode-editor-background); transition: left 0.12s ease; }
		.switch input:checked + span { background: var(--vscode-testing-iconPassed); }
		.switch input:checked + span::after { left: 18px; }
		.empty { color: var(--vscode-descriptionForeground); }
	</style>
</head>
<body>
	<section class="toolbar">
		<input id="searchInput" type="text" value="${escapeHtml(query)}" placeholder="${escapeHtml(messages.agentManagerSearchPlaceholder)}" />
	</section>
	<section class="body">${buildRows(records)}</section>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.getElementById('searchInput').addEventListener('input', (event) => {
			vscode.postMessage({ type: 'search', query: event.target.value });
		});
		document.addEventListener('change', (event) => {
			const target = event.target;
			if (target?.dataset?.agentName) {
				vscode.postMessage({ type: 'toggleAgent', name: target.dataset.agentName, enabled: target.checked });
			}
		});
		document.addEventListener('click', (event) => {
			const target = event.target;
			if (target?.dataset?.openPath) {
				vscode.postMessage({ type: 'openAgent', agentPath: target.dataset.openPath });
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
			{ enableScripts: true, retainContextWhenHidden: true },
		);
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
