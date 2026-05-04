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
import { CODICON_RESOURCE_ROOTS, getCodiconCssHref, getCodiconIconPath } from './webviewAssets';

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
		env: [],
		enabledTools: [],
		disabledTools: [],
		enabled: true,
	};
}

function buildList(models: McpFormModel[], selectedId: string | undefined, query: string): string {
	return models.map((model) => `<button type="button" class="server ${model.id === selectedId ? 'active' : ''}${model.enabled ? '' : ' disabled'}" data-select="${escapeHtml(model.id)}" data-filter-text="${escapeHtml(model.id.toLocaleLowerCase())}">
		<span class="codicon codicon-mcp server-icon" aria-hidden="true"></span>
		<span class="server-name">${escapeHtml(model.id)}</span>
		<label class="switch" title="Toggle">
			<input type="checkbox" data-toggle="${escapeHtml(model.id)}" ${model.enabled ? 'checked' : ''} />
			<span></span>
		</label>
	</button>`).join('');
}

function buildFieldLabel(label: string, description: string): string {
	return `<span class="field-label">${escapeHtml(label)}<span class="codicon codicon-info info-icon" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}"></span></span>`;
}

function localizeValidationErrors(errors: string[]): string[] {
	return errors.map((error) => {
		switch (error) {
			case 'serverNameRequired':
				return messages.mcpValidationServerNameRequired;
			case 'serverNameDuplicate':
				return messages.mcpValidationServerNameDuplicate;
			case 'transportRequired':
				return messages.mcpValidationTransportRequired;
			case 'commandRequired':
				return messages.mcpValidationCommandRequired;
			case 'urlRequired':
				return messages.mcpValidationUrlRequired;
			case 'timeoutInvalid':
				return messages.mcpValidationTimeoutInvalid;
			case 'toolsMutuallyExclusive':
				return messages.mcpValidationToolsMutuallyExclusive;
			case 'envKeyRequired':
				return messages.mcpValidationEnvKeyRequired;
			case 'envKeyInvalid':
				return messages.mcpValidationEnvKeyInvalid;
			case 'envKeyDuplicate':
				return messages.mcpValidationEnvKeyDuplicate;
			default:
				return error;
		}
	});
}

function getMcpFieldDescriptions(language: string): Record<string, string> {
	const isJapanese = language.toLocaleLowerCase().startsWith('ja');
	if (isJapanese) {
		return {
			id: '[mcp_servers.<name>] の一意なサーバー名です。',
			transport: '接続方式です。コマンド起動は stdio、URL 接続は http を選択してください。',
			command: 'stdio MCP サーバーを起動するコマンドです。http の場合は空にしてください。',
			args: 'stdio サーバーに渡す引数です。1項目を1行で記載してください。',
			url: 'http MCP サーバーの URL です。stdio の場合は空にしてください。',
			env: 'MCP サーバーへ渡す環境変数です。キーと値をペアで指定してください。',
			required: 'Codex がこの MCP サーバーを必須として扱うかを指定します。',
			startupTimeoutSec: '起動タイムアウト秒数です。0以上の数値を指定してください。',
			toolTimeoutSec: 'ツール実行タイムアウト秒数です。0以上の数値を指定してください。',
			enabledTools: '許可するツール名です。1項目を1行で記載してください。Disabled Tools とは同時指定できません。',
			disabledTools: '無効化するツール名です。1項目を1行で記載してください。Enabled Tools とは同時指定できません。',
		};
	}
	return {
		id: 'Unique server name under [mcp_servers.<name>].',
		transport: 'Connection type. Use stdio for command based servers, http for URL based servers.',
		command: 'Command to launch a stdio MCP server. Leave empty for http servers.',
		args: 'Command arguments for stdio servers. Enter one item per line.',
		url: 'HTTP MCP server URL. Leave empty for stdio servers.',
		env: 'Environment variables passed to the MCP server. Enter key and value pairs.',
		required: 'Whether Codex should treat this MCP server as required.',
		startupTimeoutSec: 'Startup timeout in seconds. Use a non-negative number.',
		toolTimeoutSec: 'Tool execution timeout in seconds. Use a non-negative number.',
		enabledTools: 'Allow only these tools. Enter one tool name per line. Do not combine with Disabled Tools.',
		disabledTools: 'Disable these tools. Enter one tool name per line. Do not combine with Enabled Tools.',
	};
}

function buildForm(model: McpFormModel | undefined, previousId?: string): string {
	const current = model ?? emptyModel();
	const descriptions = getMcpFieldDescriptions(vscode.env.language ?? 'en');
	return `<div class="detail-form-shell"><form id="form" data-previous-id="${escapeHtml(previousId ?? current.id)}" data-enabled="${current.enabled ? 'true' : 'false'}">
		<label>${buildFieldLabel(messages.mcpManagerServerName, descriptions.id)}<input name="id" value="${escapeHtml(current.id)}" /></label>
		<label>${buildFieldLabel('Transport', descriptions.transport)}<select name="transport">
			<option value="stdio" ${current.transport === 'stdio' ? 'selected' : ''}>stdio</option>
			<option value="http" ${current.transport === 'http' ? 'selected' : ''}>http</option>
		</select></label>
		<label>${buildFieldLabel('Command', descriptions.command)}<input name="command" value="${escapeHtml(current.command)}" /></label>
		<label>${buildFieldLabel('Args', descriptions.args)}<textarea class="textarea-args" name="args">${escapeHtml(current.args.join('\n'))}</textarea></label>
		<label>${buildFieldLabel('URL', descriptions.url)}<input name="url" value="${escapeHtml(current.url)}" /></label>
		<div class="env-field">
			<span class="field-label-row">
				${buildFieldLabel('Env', descriptions.env)}
				<button id="addEnvRow" class="icon-button" type="button" title="Add env" aria-label="Add env"><span class="codicon codicon-add" aria-hidden="true"></span></button>
			</span>
			<div id="envRows" class="env-rows">${buildEnvRows(current.env)}</div>
		</div>
		<label class="required-field">${buildFieldLabel('Required', descriptions.required)}<span class="required-switch"><input name="required" type="checkbox" ${current.required ? 'checked' : ''} /><span></span></span></label>
		<label>${buildFieldLabel('Startup Timeout', descriptions.startupTimeoutSec)}<input name="startupTimeoutSec" value="${current.startupTimeoutSec ?? ''}" /></label>
		<label>${buildFieldLabel('Tool Timeout', descriptions.toolTimeoutSec)}<input name="toolTimeoutSec" value="${current.toolTimeoutSec ?? ''}" /></label>
		<label>${buildFieldLabel('Enabled Tools', descriptions.enabledTools)}<textarea name="enabledTools">${escapeHtml(current.enabledTools.join('\n'))}</textarea></label>
		<label>${buildFieldLabel('Disabled Tools', descriptions.disabledTools)}<textarea name="disabledTools">${escapeHtml(current.disabledTools.join('\n'))}</textarea></label>
	</form></div>`;
}

function buildEnvRows(entries: McpFormModel['env']): string {
	const resolvedEntries = entries.length > 0 ? entries : [{ key: '', value: '' }];
	return resolvedEntries
		.map(
			(entry) => `<div class="env-row">
				<input name="envKey" value="${escapeHtml(entry.key)}" placeholder="KEY" />
				<input name="envValue" value="${escapeHtml(entry.value)}" placeholder="value" />
				<button class="icon-button env-remove" type="button" title="Remove env" aria-label="Remove env"><span class="codicon codicon-close" aria-hidden="true"></span></button>
			</div>`,
		)
		.join('');
}

function buildHtml(
	webview: vscode.Webview,
	models: McpFormModel[],
	selectedId: string | undefined,
	query: string,
): string {
	const nonce = createNonce();
	const selected = models.find((model) => model.id === selectedId) ?? models[0] ?? emptyModel();
	const selectedModelId = selected.id;
	const codiconCssHref = getCodiconCssHref(webview);
	const serializedModels = JSON.stringify(models);
	const fieldDescriptions = JSON.stringify(
		getMcpFieldDescriptions(vscode.env.language ?? 'en'),
	);
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
	<title>${escapeHtml(messages.mcpManagerTitle)}</title>
	<style>
		body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
		.root { display: grid; grid-template-rows: auto 1fr; height: 100vh; min-width: 0; }
		.panes { display: grid; grid-template-columns: 40% 60%; min-height: 0; }
		.left { border-right: 1px solid var(--vscode-panel-border); display: grid; grid-template-rows: auto 1fr; min-width: 0; min-height: 0; }
		.right { padding: 10px 0; overflow: auto; min-width: 0; box-sizing: border-box; }
		.search-area { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; }
		.search-area input { flex: 1; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 8px; padding: 6px 8px; }
		.search-area input:focus, input:focus, textarea:focus, select:focus { outline: none; border-color: var(--vscode-focusBorder, #0e639c); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #0e639c); }
		.actions { display: flex; gap: 8px; align-items: center; }
		.list-actions { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; gap: 12px; align-items: center; }
		.list-actions-left, .list-actions-right { display: flex; gap: 8px; align-items: center; }
		.server-list { padding: 10px 12px; overflow: auto; }
		.server { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; width: 100%; margin-bottom: 6px; padding: 8px; background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 6px; text-align: left; cursor: pointer; }
		.server.disabled { opacity: 0.55; }
		.server.active { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
		.server-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.server-icon { color: var(--vscode-descriptionForeground); }
		.detail-form-shell { width: 100%; padding: 0 0 0 12px; box-sizing: border-box; }
		form { display: grid; gap: 10px; width: 100%; max-width: none; box-sizing: border-box; }
		label { display: grid; gap: 4px; width: 100%; box-sizing: border-box; }
		.field-label { display: inline-flex; align-items: center; gap: 6px; }
		.field-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
		.info-icon { color: var(--vscode-descriptionForeground); }
		.required-field { justify-items: start; }
		.env-field { display: grid; gap: 6px; }
		.env-rows { display: grid; gap: 8px; }
		.env-row { display: grid; grid-template-columns: minmax(120px, 0.9fr) minmax(0, 1.1fr) auto; gap: 8px; align-items: center; }
		input, textarea, select { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; padding: 6px 8px; }
		textarea { min-height: 70px; }
		.textarea-args { min-height: 120px; }
		.icon-button { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
		.switch input { display: none; }
		.switch span { display: inline-block; width: 34px; height: 18px; border-radius: 999px; background: #d85b74; position: relative; vertical-align: middle; }
		.switch span::after { content: ""; position: absolute; width: 14px; height: 14px; top: 2px; left: 2px; border-radius: 50%; background: #6e6e6e; transition: left 0.12s ease; }
		.switch input:checked + span { background: var(--vscode-testing-iconPassed); }
		.switch input:checked + span::after { left: 18px; }
		@media (prefers-color-scheme: dark) {
			.switch span::after { background: #ffffff; }
		}
		.required-switch { display: inline-flex; align-items: center; cursor: pointer; user-select: none; }
		.required-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
		.required-switch span { display: inline-block; width: 34px; height: 18px; border-radius: 999px; background: var(--vscode-checkbox-background, var(--vscode-input-background)); border: 1px solid var(--vscode-checkbox-border, var(--vscode-panel-border)); position: relative; vertical-align: middle; box-sizing: border-box; transition: background 0.15s ease, border-color 0.15s ease; }
		.required-switch span::after { content: ""; position: absolute; top: 50%; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: var(--vscode-button-secondaryForeground); transform: translateY(-50%); transition: transform 0.15s ease; }
		.required-switch input:checked + span { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
		.required-switch input:checked + span::after { transform: translate(16px, -50%); background: var(--vscode-button-foreground); }
		.required-switch input:focus-visible + span { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
	</style>
</head>
<body>
	<div class="root">
		<div class="search-area">
			<input id="search" value="${escapeHtml(query)}" placeholder="${escapeHtml(messages.mcpManagerSearchPlaceholder)}" />
			<button id="clearSearch" class="icon-button" type="button" title="${escapeHtml(messages.historyClear)}" aria-label="${escapeHtml(messages.historyClear)}"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
		</div>
		<div class="panes">
			<section class="left">
				<div class="actions list-actions">
					<div class="list-actions-left">
						<button id="add" class="icon-button" type="button" title="${escapeHtml(messages.mcpManagerAdd)}" aria-label="${escapeHtml(messages.mcpManagerAdd)}"><span class="codicon codicon-add" aria-hidden="true"></span></button>
						<button id="delete" class="icon-button" type="button" title="${escapeHtml(messages.mcpManagerDelete)}" aria-label="${escapeHtml(messages.mcpManagerDelete)}"><span class="codicon codicon-trash" aria-hidden="true"></span></button>
					</div>
					<div class="list-actions-right">
						<button id="save" class="icon-button" type="button" title="${escapeHtml(messages.mcpManagerSave)}" aria-label="${escapeHtml(messages.mcpManagerSave)}"><span class="codicon codicon-save" aria-hidden="true"></span></button>
						<button id="cancel" class="icon-button" type="button" title="${escapeHtml(messages.mcpManagerCancel)}" aria-label="${escapeHtml(messages.mcpManagerCancel)}"><span class="codicon codicon-discard" aria-hidden="true"></span></button>
					</div>
				</div>
				<div class="server-list">${buildList(models, selectedModelId, query)}</div>
			</section>
			<section id="detailPane" class="right">${buildForm(selected)}</section>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const models = ${serializedModels};
		const descriptions = ${fieldDescriptions};
		let selectedId = ${JSON.stringify(selectedModelId)};
		let dirty = false;
		const searchInput = document.getElementById('search');
		const detailPane = document.getElementById('detailPane');
		const escapeHtml = (value) =>
			String(value ?? '')
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;');
		const fieldLabel = (label, description) =>
			'<span class="field-label">' + escapeHtml(label) + '<span class="codicon codicon-info info-icon" title="' + escapeHtml(description) + '" aria-label="' + escapeHtml(description) + '"></span></span>';
		const buildEnvRowsHtml = (entries) => {
			const resolvedEntries = entries && entries.length > 0 ? entries : [{ key: '', value: '' }];
			return resolvedEntries.map((entry) =>
				'<div class="env-row">' +
				'<input name="envKey" value="' + escapeHtml(entry.key || '') + '" placeholder="KEY" />' +
				'<input name="envValue" value="' + escapeHtml(entry.value || '') + '" placeholder="value" />' +
				'<button class="icon-button env-remove" type="button" title="Remove env" aria-label="Remove env"><span class="codicon codicon-close" aria-hidden="true"></span></button>' +
				'</div>'
			).join('');
		};
		const renderForm = (model) => {
			const current = model || {
				id: '',
				transport: 'stdio',
				command: '',
				args: [],
				url: '',
				env: [],
				enabledTools: [],
				disabledTools: [],
				enabled: true,
			};
			detailPane.innerHTML =
				'<div class="detail-form-shell"><form id="form" data-previous-id="' + escapeHtml(current.id) + '" data-enabled="' + (current.enabled === false ? 'false' : 'true') + '">' +
				'<label>' + fieldLabel(${JSON.stringify(messages.mcpManagerServerName)}, descriptions.id) + '<input name="id" value="' + escapeHtml(current.id) + '" /></label>' +
				'<label>' + fieldLabel('Transport', descriptions.transport) + '<select name="transport">' +
				'<option value="stdio" ' + (current.transport === 'stdio' ? 'selected' : '') + '>stdio</option>' +
				'<option value="http" ' + (current.transport === 'http' ? 'selected' : '') + '>http</option>' +
				'</select></label>' +
				'<label>' + fieldLabel('Command', descriptions.command) + '<input name="command" value="' + escapeHtml(current.command) + '" /></label>' +
				'<label>' + fieldLabel('Args', descriptions.args) + '<textarea class="textarea-args" name="args">' + escapeHtml((current.args || []).join('\\n')) + '</textarea></label>' +
				'<label>' + fieldLabel('URL', descriptions.url) + '<input name="url" value="' + escapeHtml(current.url) + '" /></label>' +
				'<div class="env-field">' +
				'<span class="field-label-row">' +
				fieldLabel('Env', descriptions.env) +
				'<button id="addEnvRow" class="icon-button" type="button" title="Add env" aria-label="Add env"><span class="codicon codicon-add" aria-hidden="true"></span></button>' +
				'</span>' +
				'<div id="envRows" class="env-rows">' + buildEnvRowsHtml(current.env || []) + '</div>' +
				'</div>' +
				'<label class="required-field">' + fieldLabel('Required', descriptions.required) + '<span class="required-switch"><input name="required" type="checkbox" ' + (current.required ? 'checked' : '') + ' /><span></span></span></label>' +
				'<label>' + fieldLabel('Startup Timeout', descriptions.startupTimeoutSec) + '<input name="startupTimeoutSec" value="' + escapeHtml(current.startupTimeoutSec ?? '') + '" /></label>' +
				'<label>' + fieldLabel('Tool Timeout', descriptions.toolTimeoutSec) + '<input name="toolTimeoutSec" value="' + escapeHtml(current.toolTimeoutSec ?? '') + '" /></label>' +
				'<label>' + fieldLabel('Enabled Tools', descriptions.enabledTools) + '<textarea name="enabledTools">' + escapeHtml((current.enabledTools || []).join('\\n')) + '</textarea></label>' +
				'<label>' + fieldLabel('Disabled Tools', descriptions.disabledTools) + '<textarea name="disabledTools">' + escapeHtml((current.disabledTools || []).join('\\n')) + '</textarea></label>' +
				'</form></div>';
			bindForm();
		};
		const getForm = () => document.getElementById('form');
		const createEnvRow = (key = '', value = '') => {
			const row = document.createElement('div');
			row.className = 'env-row';
			row.innerHTML =
				'<input name="envKey" value="' + escapeHtml(key) + '" placeholder="KEY" />' +
				'<input name="envValue" value="' + escapeHtml(value) + '" placeholder="value" />' +
				'<button class="icon-button env-remove" type="button" title="Remove env" aria-label="Remove env"><span class="codicon codicon-close" aria-hidden="true"></span></button>';
			return row;
		};
		const collectEnvEntries = () => {
			const keys = Array.from(document.querySelectorAll('input[name="envKey"]'));
			const values = Array.from(document.querySelectorAll('input[name="envValue"]'));
			return keys.map((keyInput, index) => ({
				key: String(keyInput.value || '').trim(),
				value: String(values[index]?.value || '').trim(),
			})).filter((entry) => entry.key.length > 0 || entry.value.length > 0);
		};
		const bindForm = () => {
			const form = getForm();
			const envRows = document.getElementById('envRows');
			document.getElementById('addEnvRow')?.addEventListener('click', () => {
				envRows?.appendChild(createEnvRow());
				dirty = true;
			});
			envRows?.addEventListener('click', (event) => {
				const target = event.target instanceof Element ? event.target : null;
				const removeButton = target?.closest?.('.env-remove');
				if (!removeButton) {
					return;
				}
				const rows = envRows.querySelectorAll('.env-row');
				if (rows.length === 1) {
					const row = rows[0];
					row.querySelectorAll('input').forEach((input) => {
						input.value = '';
					});
				} else {
					removeButton.closest('.env-row')?.remove();
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
						env: collectEnvEntries(),
						required: data.get('required') === 'on',
						startupTimeoutSec: numberValue('startupTimeoutSec'),
						toolTimeoutSec: numberValue('toolTimeoutSec'),
						enabledTools: lines('enabledTools'),
						disabledTools: lines('disabledTools'),
						enabled: form.dataset.enabled !== 'false',
					},
				});
			});
		};
		const selectServer = (id) => {
			selectedId = id;
			document.querySelectorAll('.server').forEach((server) => {
				server.classList.toggle('active', server.dataset?.select === id);
			});
			renderForm(models.find((model) => model.id === id));
		};
		document.querySelectorAll('.server').forEach((server) => {
			const model = models.find((item) => item.id === server.dataset?.select);
			server.classList.toggle('disabled', model?.enabled === false);
		});
		const applyFilter = () => {
			const query = searchInput.value.trim().toLocaleLowerCase();
			document.querySelectorAll('.server').forEach((server) => {
				const text = server.dataset?.filterText || '';
				server.style.display = query.length > 0 && !text.includes(query) ? 'none' : '';
			});
		};
		searchInput.addEventListener('input', applyFilter);
		document.getElementById('clearSearch')?.addEventListener('click', () => {
			searchInput.value = '';
			applyFilter();
			searchInput.focus();
		});
		applyFilter();
		document.getElementById('add').addEventListener('click', () => {
			selectedId = '';
			document.querySelectorAll('.server').forEach((server) => server.classList.remove('active'));
			renderForm(undefined);
			vscode.postMessage({ type: 'add' });
		});
		document.getElementById('delete').addEventListener('click', () => {
			const previousId = getForm()?.dataset?.previousId;
			if (previousId) vscode.postMessage({ type: 'delete', id: previousId });
		});
		document.getElementById('save')?.addEventListener('click', () => {
			getForm()?.requestSubmit();
		});
		document.getElementById('cancel')?.addEventListener('click', () => {
			vscode.postMessage({ type: 'cancel' });
		});
		document.querySelector('.server-list')?.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			const toggle = target?.closest?.('[data-toggle]');
			if (toggle) return;
			const server = target?.closest?.('[data-select]');
			if (server?.dataset?.select !== undefined) {
				selectServer(server.dataset.select);
				vscode.postMessage({ type: 'select', id: server.dataset.select });
			}
		});
		document.addEventListener('change', (event) => {
			const target = event.target;
			if (target?.dataset?.toggle) {
				event.stopPropagation();
				const model = models.find((item) => item.id === target.dataset.toggle);
				if (model) {
					model.enabled = Boolean(target.checked);
				}
				const server = target.closest('.server');
				server?.classList.toggle('disabled', !target.checked);
				vscode.postMessage({ type: 'toggle', id: target.dataset.toggle });
				return;
			}
			dirty = true;
		});
		bindForm();
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
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				...(CODICON_RESOURCE_ROOTS.length > 0
					? { localResourceRoots: CODICON_RESOURCE_ROOTS }
				: {}),
			},
		);
		this.panel.iconPath = getCodiconIconPath('mcp');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage((message: InboundMessage) =>
			this.handleMessage(message),
		);
		this.refresh();
	}

	refresh(): void {
		this.models = this.readModels();
		if (!this.selectedId || !this.models.some((model) => model.id === this.selectedId)) {
			this.selectedId = this.models[0]?.id;
		}
		this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private async handleMessage(message: InboundMessage): Promise<void> {
		const { configPath } = resolveCodexPaths();
		if (message.type === 'ready') {
			return;
		}
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
				vscode.window.showErrorMessage(localizeValidationErrors(result.errors).join('\n'));
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
		env: [],
		enabledTools: [],
		disabledTools: [],
		enabled: true,
	};
}
