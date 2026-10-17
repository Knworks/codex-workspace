import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import vm from 'vm';
import * as vscode from 'vscode';
import { McpManagerPanelManager } from '../services/mcpManagerPanel';
import { listMcpFormModels } from '../services/mcpManagerService';
import { messages } from '../i18n';

suite('MCP manager panel', () => {
	test('generated tool editors save writes and output limits without losing unknown settings', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-panel-'));
		const originalHome = process.env.CODEX_HOME;
		const originalCreate = vscode.window.createWebviewPanel;
		const originalInformation = vscode.window.showInformationMessage;
		const originalWarning = vscode.window.showWarningMessage;
		let receive: ((message: unknown) => Promise<void>) | undefined;
		const webview = {
			html: '', cspSource: 'vscode-webview://test',
			onDidReceiveMessage: (listener: typeof receive) => {
				receive = listener;
				return { dispose: () => undefined };
			},
		} as unknown as vscode.Webview;
		const panel = {
			webview, onDidDispose: () => ({ dispose: () => undefined }),
			dispose: () => undefined,
		} as unknown as vscode.WebviewPanel;
		let changes = 0;
		const manager = new McpManagerPanelManager(() => { changes += 1; });
		try {
			process.env.CODEX_HOME = root;
			vscode.window.createWebviewPanel = () => panel;
			vscode.window.showInformationMessage = (() => Promise.resolve(undefined)) as typeof originalInformation;
			vscode.window.showWarningMessage = (() => Promise.resolve(messages.dialogOk)) as typeof originalWarning;
			const configPath = path.join(root, 'config.toml');
			fs.writeFileSync(configPath, '[mcp_servers.example]\ncommand = "example-mcp"\n[mcp_servers.example.tools.read]\napproval_mode = "writes"\noutput_token_limit = 4096\nfuture_flag = true\n');
			manager.show();
			assert.match(webview.html, /value="writes" selected/);
			assert.match(webview.html, /name="toolOutputTokenLimit"[^>]*value="4096"/);
			const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
			new vm.Script(script);
			const collectSource = script.slice(script.indexOf('const collectToolEntries ='), script.indexOf('const collectListEntries ='));
			const row = (name: string, limit: string) => ({
				querySelector: (selector: string) => ({ value: selector.includes('toolName') ? name : selector.includes('toolApprovalMode') ? 'writes' : selector.includes('toolOutputTokenLimit') ? limit : '' }),
			});
			const tools = JSON.parse(JSON.stringify(vm.runInNewContext(`${collectSource}\ncollectToolEntries()`, {
				document: { querySelectorAll: () => [row('read', '0')] },
			})));
			assert.deepStrictEqual(tools, [{ name: 'read', approvalMode: 'writes', outputTokenLimit: 0 }]);
			const renderSource = script.slice(script.indexOf('const buildToolRowsHtml ='), script.indexOf('const buildListRowsHtml ='));
			const rendered = vm.runInNewContext(`${renderSource}\nbuildToolRowsHtml(tools)`, { tools, escapeHtml: String });
			assert.match(rendered, /value="writes" selected/);
			assert.match(rendered, /name="toolOutputTokenLimit"[^>]*value="0"/);
			const createSource = script.slice(script.indexOf('const createToolRow ='), script.indexOf('const createListRow ='));
			const created = vm.runInNewContext(`${createSource}\ncreateToolRow(tools[0])`, {
				tools, escapeHtml: String, document: { createElement: () => ({}) },
			});
			assert.match(created.innerHTML, /value="writes" selected/);
			assert.match(created.innerHTML, /name="toolOutputTokenLimit"[^>]*value="0"/);
			const model = listMcpFormModels(configPath)[0];
			await receive!({ type: 'save', previousId: 'example', model: { ...model, enabledTools: ['read'], disabledTools: ['write'], tools } });
			assert.strictEqual(listMcpFormModels(configPath)[0].tools?.[0].outputTokenLimit, 0);
			assert.match(fs.readFileSync(configPath, 'utf8'), /future_flag = true/);
			await receive!({ type: 'toggle', id: 'example' });
			assert.strictEqual(listMcpFormModels(configPath)[0].enabled, false);
			assert.match(fs.readFileSync(configPath, 'utf8'), /future_flag = true/);
			await receive!({ type: 'toggle', id: 'example' });
			assert.strictEqual(listMcpFormModels(configPath)[0].enabled, true);
			await receive!({ type: 'add' });
			await receive!({ type: 'save', model: { ...model, id: 'added', tools } });
			assert.strictEqual(listMcpFormModels(configPath).length, 2);
			await receive!({ type: 'delete', id: 'added' });
			assert.deepStrictEqual(listMcpFormModels(configPath).map((item) => item.id), ['example']);
			assert.strictEqual(changes, 5);
		} finally {
			manager.dispose();
			vscode.window.createWebviewPanel = originalCreate;
			vscode.window.showInformationMessage = originalInformation;
			vscode.window.showWarningMessage = originalWarning;
			if (originalHome === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = originalHome; }
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	test('uses row-based editors for args and tool lists', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'mcpManagerPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes("data-list-rows=\"args\""));
		assert.ok(source.includes("data-list-rows=\"enabledTools\""));
		assert.ok(source.includes("data-list-rows=\"disabledTools\""));
		assert.ok(source.includes("data-key-value-rows=\"httpHeaders\""));
		assert.ok(source.includes("data-key-value-rows=\"envHttpHeaders\""));
		assert.ok(source.includes("data-tool-rows=\"tools\""));
		assert.ok(source.includes("collectListEntries('args')"));
		assert.ok(source.includes("collectListEntries('enabledTools')"));
		assert.ok(source.includes("collectListEntries('disabledTools')"));
		assert.ok(source.includes("collectKeyValueEntries('httpHeaders')"));
		assert.ok(source.includes("collectKeyValueEntries('envHttpHeaders')"));
		assert.ok(source.includes('collectToolEntries()'));
		assert.ok(!source.includes('<textarea class="textarea-args" name="args">'));
	});
});
