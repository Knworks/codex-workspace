import * as vscode from 'vscode';
import { messages } from '../i18n';
import { listSkillRecords, setSkillEnabled, SkillRecord } from './skillConfigService';
import { resolveCodexPaths } from './workspaceStatus';

const SKILL_MANAGER_VIEW_TYPE = 'codex-workspace.skillManager';

type InboundMessage =
	| { type: 'ready' }
	| { type: 'openSkill'; skillPath: string }
	| { type: 'toggleSkill'; skillPath: string; enabled: boolean }
	| { type: 'search'; query: string };

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

function filterRecords(records: SkillRecord[], query: string): SkillRecord[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) {
		return records;
	}
	return records.filter((record) =>
		[
			record.name,
			record.description,
			record.skillPath,
		].some((value) => value.toLocaleLowerCase().includes(normalized)),
	);
}

function buildRows(records: SkillRecord[]): string {
	if (records.length === 0) {
		return `<p class="empty">${escapeHtml(messages.skillManagerNoResult)}</p>`;
	}
	return records.map((record) => {
		const disabledClass = record.enabled ? '' : ' disabled';
		return `<article class="skill-row${disabledClass}">
			<div class="skill-main">
				<div class="skill-title">${escapeHtml(record.name)}</div>
				<div class="skill-description">${escapeHtml(record.description)}</div>
				<div class="skill-path" title="${escapeHtml(record.location.label)}: ${escapeHtml(record.skillPath)}">${escapeHtml(record.skillPath)}</div>
			</div>
			<div class="skill-actions">
				<span class="location">${escapeHtml(record.location.label)}</span>
				<label class="switch">
					<input type="checkbox" data-skill-path="${escapeHtml(record.skillPath)}" ${record.enabled ? 'checked' : ''} />
					<span></span>
				</label>
				<button type="button" data-open-path="${escapeHtml(record.skillPath)}">${escapeHtml(messages.skillManagerOpen)}</button>
			</div>
		</article>`;
	}).join('');
}

function buildHtml(webview: vscode.Webview, records: SkillRecord[], query: string): string {
	const nonce = createNonce();
	const rows = buildRows(records);
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
	<title>${escapeHtml(messages.skillManagerTitle)}</title>
	<style>
		body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		.toolbar { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
		.toolbar input { width: 100%; box-sizing: border-box; }
		.body { padding: 10px 12px; display: grid; gap: 8px; }
		.skill-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
		.skill-row.disabled { opacity: 0.55; }
		.skill-title { font-weight: 600; }
		.skill-description, .skill-path, .location { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.skill-path { word-break: break-all; }
		.skill-actions { display: flex; align-items: center; gap: 10px; }
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
		<input id="searchInput" type="text" value="${escapeHtml(query)}" placeholder="${escapeHtml(messages.skillManagerSearchPlaceholder)}" />
	</section>
	<section id="body" class="body">${rows}</section>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const searchInput = document.getElementById('searchInput');
		searchInput.addEventListener('input', () => {
			vscode.postMessage({ type: 'search', query: searchInput.value });
		});
		document.addEventListener('change', (event) => {
			const target = event.target;
			if (target?.dataset?.skillPath) {
				vscode.postMessage({ type: 'toggleSkill', skillPath: target.dataset.skillPath, enabled: target.checked });
			}
		});
		document.addEventListener('click', (event) => {
			const target = event.target;
			if (target?.dataset?.openPath) {
				vscode.postMessage({ type: 'openSkill', skillPath: target.dataset.openPath });
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}

export class SkillManagerPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private records: SkillRecord[] = [];
	private query = '';

	constructor(private readonly onDidChangeSkills: () => void) {}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			this.refresh();
			return;
		}
		this.records = this.readRecords();
		this.panel = vscode.window.createWebviewPanel(
			SKILL_MANAGER_VIEW_TYPE,
			messages.skillManagerTitle,
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
		if (message.type === 'openSkill') {
			void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.skillPath));
			return;
		}
		if (message.type === 'toggleSkill') {
			const { configPath } = resolveCodexPaths();
			setSkillEnabled(configPath, message.skillPath, message.enabled);
			vscode.window.showInformationMessage(messages.mcpToggleUpdated);
			this.onDidChangeSkills();
			this.refresh();
			return;
		}
		if (message.type === 'search') {
			this.query = message.query;
			this.render();
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

	private readRecords(): SkillRecord[] {
		const { configPath } = resolveCodexPaths();
		return listSkillRecords(configPath);
	}
}
