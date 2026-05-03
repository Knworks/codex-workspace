import * as vscode from 'vscode';
import { messages } from '../i18n';
import {
	deleteMcpServer,
	listMcpFormModels,
	McpFormModel,
	saveMcpServer,
} from './mcpManagerService';
import { toggleMcpServer } from './mcpService';
import { resolveCodexPaths } from './workspaceStatus';

const MCP_MANAGER_VIEW_TYPE = 'codex-workspace.mcpManager';

type InboundMessage =
	| { type: 'ready' }
	| { type: 'search'; query: string }
	| { type: 'select'; id: string }
	| { type: 'toggle'; id: string }
	| { type: 'delete'; id: string }
	| { type: 'save'; model: McpFormModel; previousId?: string }
	| { type: 'add' }
	| { type: 'cancel' };

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function createNonce(): string {
	return Array.from({ length: 24 }, () =>
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
			Math.floor(Math.random() * 62),
		),
	).join('');
}

function emptyModel(): McpFormModel {
	return {
		id: '',
		transport: 'stdio',
		command: '',
		args: [],
		url: '',
		enabledTools: [],
		disabledTools: [],
		enabled: true,
	};
}

function buildList(models: McpFormModel[], selectedId: string | undefined, query: string): string {
	const normalized = query.trim().toLocaleLowerCase();
	const visible = normalized
		? models.filter((model) => model.id.toLocaleLowerCase().includes(normalized))
		: models;
	return visible.map((model) => `<button type="button" class="server ${model.id === selectedId ? 'active' : ''}" data-select="${escapeHtml(model.id)}">
		<span>${escapeHtml(model.id)}</span>
		<input type="checkbox" data-toggle="${escapeHtml(model.id)}" ${model.enabled ? 'checked' : ''} />
	</button>`).join('');
}

function buildForm(model: McpFormModel | undefined, previousId?: string): string {
	const current = model ?? emptyModel();
	return `<form id="form" data-previous-id="${escapeHtml(previousId ?? current.id)}">
		<label>${escapeHtml(messages.mcpManagerServerName)}<input name="id" value="${escapeHtml(current.id)}" /></label>
		<label>Transport<select name="transport">
			<option value="stdio" ${current.transport === 'stdio' ? 'selected' : ''}>stdio</option>
			<option value="http" ${current.transport === 'http' ? 'selected' : ''}>http</option>
		</select></label>
		<label>Command<input name="command" value="${escapeHtml(current.command)}" /></label>
		<label>Args<textarea name="args">${escapeHtml(current.args.join('\n'))}</textarea></label>
		<label>URL<input name="url" value="${escapeHtml(current.url)}" /></label>
		<label>Required<input name="required" type="checkbox" ${current.required ? 'checked' : ''} /></label>
		<label>Startup Timeout<input name="startupTimeoutSec" value="${current.startupTimeoutSec ?? ''}" /></label>
		<label>Tool Timeout<input name="toolTimeoutSec" value="${current.toolTimeoutSec ?? ''}" /></label>
		<label>Enabled Tools<textarea name="enabledTools">${escapeHtml(current.enabledTools.join('\n'))}</textarea></label>
		<label>Disabled Tools<textarea name="disabledTools">${escapeHtml(current.disabledTools.join('\n'))}</textarea></label>
		<div class="actions">
			<button type="submit">${escapeHtml(messages.mcpManagerSave)}</button>
			<button id="cancel" type="button">${escapeHtml(messages.mcpManagerCancel)}</button>
		</div>
	</form>`;
}

function buildHtml(
	webview: vscode.Webview,
	models: McpFormModel[],
	selectedId: string | undefined,
	query: string,
): string {
	const nonce = createNonce();
	const selected = models.find((model) => model.id === selectedId) ?? models[0];
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
	<title>${escapeHtml(messages.mcpManagerTitle)}</title>
	<style>
		body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		.root { display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
		.left { border-right: 1px solid var(--vscode-panel-border); padding: 10px; display: grid; grid-template-rows: auto auto 1fr; gap: 8px; }
		.right { padding: 10px; overflow: auto; }
		.server { display: flex; width: 100%; justify-content: space-between; margin-bottom: 4px; padding: 6px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); }
		.server.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
		form { display: grid; gap: 8px; max-width: 720px; }
		label { display: grid; gap: 4px; }
		textarea { min-height: 70px; }
		.actions { display: flex; gap: 8px; }
	</style>
</head>
<body>
	<div class="root">
		<section class="left">
			<input id="search" value="${escapeHtml(query)}" placeholder="${escapeHtml(messages.mcpManagerSearchPlaceholder)}" />
			<div class="actions">
				<button id="add" type="button">${escapeHtml(messages.mcpManagerAdd)}</button>
				<button id="delete" type="button">${escapeHtml(messages.mcpManagerDelete)}</button>
			</div>
			<div>${buildList(models, selected?.id, query)}</div>
		</section>
		<section class="right">${buildForm(selected)}</section>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let dirty = false;
		const form = document.getElementById('form');
		document.getElementById('search').addEventListener('input', (event) => vscode.postMessage({ type: 'search', query: event.target.value }));
		document.getElementById('add').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
		document.getElementById('delete').addEventListener('click', () => {
			const previousId = form?.dataset?.previousId;
			if (previousId) vscode.postMessage({ type: 'delete', id: previousId });
		});
		document.getElementById('cancel')?.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
		document.addEventListener('click', (event) => {
			const target = event.target;
			if (target?.dataset?.select && target.tagName !== 'INPUT') vscode.postMessage({ type: 'select', id: target.dataset.select });
		});
		document.addEventListener('change', (event) => {
			const target = event.target;
			if (target?.dataset?.toggle) {
				event.stopPropagation();
				vscode.postMessage({ type: 'toggle', id: target.dataset.toggle });
				return;
			}
			dirty = true;
		});
		form?.addEventListener('input', () => { dirty = true; });
		form?.addEventListener('submit', (event) => {
			event.preventDefault();
			const data = new FormData(form);
			const lines = (name) => String(data.get(name) ?? '').split(/\\r?\\n/).map((item) => item.trim()).filter(Boolean);
			const numberValue = (name) => {
				const value = String(data.get(name) ?? '').trim();
				return value ? Number(value) : undefined;
			};
			vscode.postMessage({
				type: 'save',
				previousId: form.dataset.previousId || undefined,
				model: {
					id: String(data.get('id') ?? '').trim(),
					transport: data.get('transport'),
					command: String(data.get('command') ?? ''),
					args: lines('args'),
					url: String(data.get('url') ?? ''),
					required: data.get('required') === 'on',
					startupTimeoutSec: numberValue('startupTimeoutSec'),
					toolTimeoutSec: numberValue('toolTimeoutSec'),
					enabledTools: lines('enabledTools'),
					disabledTools: lines('disabledTools'),
					enabled: true,
				},
			});
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}

export class McpManagerPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private models: McpFormModel[] = [];
	private selectedId: string | undefined;
	private query = '';

	constructor(private readonly onDidChangeMcp: () => void) {}

	show(): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			this.refresh();
			return;
		}
		this.models = this.readModels();
		this.selectedId = this.models[0]?.id;
		this.panel = vscode.window.createWebviewPanel(
			MCP_MANAGER_VIEW_TYPE,
			messages.mcpManagerTitle,
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
		this.models = this.readModels();
		this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private async handleMessage(message: InboundMessage): Promise<void> {
		const { configPath } = resolveCodexPaths();
		if (message.type === 'search') {
			this.query = message.query;
		} else if (message.type === 'select') {
			this.selectedId = message.id;
		} else if (message.type === 'add') {
			this.selectedId = undefined;
			this.models = [emptyModelForPanel(), ...this.models];
		} else if (message.type === 'cancel') {
			this.refresh();
			return;
		} else if (message.type === 'toggle') {
			toggleMcpServer(configPath, message.id);
			this.onDidChangeMcp();
			this.refresh();
			return;
		} else if (message.type === 'delete') {
			const choice = await vscode.window.showWarningMessage(
				messages.mcpManagerDeleteConfirm(message.id),
				{ modal: true },
				'OK',
			);
			if (choice === 'OK') {
				deleteMcpServer(configPath, message.id);
				this.onDidChangeMcp();
				this.refresh();
			}
			return;
		} else if (message.type === 'save') {
			const result = saveMcpServer(configPath, message.model, message.previousId);
			if (!result.ok) {
				vscode.window.showErrorMessage(result.errors.join(', '));
			} else {
				vscode.window.showInformationMessage(messages.mcpToggleUpdated);
				this.selectedId = message.model.id;
				this.onDidChangeMcp();
				this.refresh();
			}
			return;
		}
		this.render();
	}

	private render(): void {
		if (!this.panel) {
			return;
		}
		this.panel.webview.html = buildHtml(
			this.panel.webview,
			this.models,
			this.selectedId,
			this.query,
		);
	}

	private readModels(): McpFormModel[] {
		return listMcpFormModels(resolveCodexPaths().configPath);
	}
}

function emptyModelForPanel(): McpFormModel {
	return {
		id: '',
		transport: 'stdio',
		command: '',
		args: [],
		url: '',
		enabledTools: [],
		disabledTools: [],
		enabled: true,
	};
}
