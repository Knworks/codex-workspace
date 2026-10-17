import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { HistoryPanelManager } from '../services/historyPanel';
import { HistoryIndex } from '../services/historyService';

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	getRevealCount: () => number;
	sendMessage: (message: unknown) => void;
	getPostedMessages: () => unknown[];
	waitForPostedMessage: (index: number) => Promise<unknown>;
};

function createFakePanel(): FakePanelHandle {
	let revealCount = 0;
	let disposeListener: (() => void) | undefined;
	let receiveListener: ((message: unknown) => void) | undefined;
	const postedMessages: unknown[] = [];
	const messageWaiters = new Map<number, (message: unknown) => void>();
	const webview = {
		html: '',
		cspSource: 'vscode-webview://test',
		asWebviewUri: (uri: vscode.Uri) => uri,
		postMessage: async (message: unknown) => {
			postedMessages.push(message);
			messageWaiters.get(postedMessages.length - 1)?.(message);
			return true;
		},
		onDidReceiveMessage: (listener: (message: unknown) => void) => {
			receiveListener = listener;
			return { dispose: () => undefined };
		},
	} as unknown as vscode.Webview;

	const panel = {
		webview,
		reveal: () => {
			revealCount += 1;
		},
		onDidDispose: (listener: () => void) => {
			disposeListener = listener;
			return { dispose: () => undefined };
		},
		dispose: () => {
			disposeListener?.();
		},
	} as unknown as vscode.WebviewPanel;

	return {
		panel,
		getRevealCount: () => revealCount,
		sendMessage: (message: unknown) => receiveListener?.(message),
		getPostedMessages: () => postedMessages,
		waitForPostedMessage: (index) => index < postedMessages.length
			? Promise.resolve(postedMessages[index])
			: new Promise((resolve) => messageWaiters.set(index, resolve)),
	};
}

suite('History panel manager', () => {
	test('hooks panels display known handlers and read-only unknown definitions safely', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-panel-'));
		const originalHome = process.env.CODEX_HOME;
		const fakePanel = createFakePanel();
		const manager = new HistoryPanelManager(() => fakePanel.panel);
		try {
			process.env.CODEX_HOME = root;
			const events = ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];
			const hooks = Object.fromEntries(events.map((event) => [event, [{ hooks: [
				{ type: 'command', command: 'echo existing' },
				{ type: 'mcp_tool', server_name: 'local', tool_name: 'check' },
				{ type: 'prompt', prompt: '<script>unsafe()</script>' },
				{ type: 'agent', prompt: 'Review changes' },
			] }]]));
			hooks['Future<Event>'] = [{ hooks: [{ type: 'future_handler', prompt: '<future>' }] }];
			fs.writeFileSync(path.join(root, 'hooks.json'), JSON.stringify({ hooks }));
			manager.show();
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'hooks' });
			const content = fakePanel.getPostedMessages().find((message) =>
				(message as { tab?: string }).tab === 'hooks',
			) as { html: string } | undefined;
			assert.ok(content);
			const html = content.html;
			for (const event of events) {
				assert.ok(html.includes(`<h3 class="setting-card-title">${event}</h3>`));
			}
			for (const type of ['command', 'mcp_tool', 'prompt', 'agent', 'future_handler']) {
				assert.ok(html.includes(`Type: ${type}</span>`));
			}
			assert.ok(html.includes('Unknown (read-only)'));
			assert.ok(html.includes('Future&lt;Event&gt;'));
			assert.ok(html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
			assert.ok(!html.includes('<script>unsafe()</script>'));
			assert.ok(html.includes('echo existing'));
			assert.ok(html.includes(`data-open-path="${path.join(root, 'hooks.json')}"`));
			assert.ok(!html.includes('Only command hook handlers'));
		} finally {
			manager.dispose();
			if (originalHome === undefined) {
				delete process.env.CODEX_HOME;
			} else {
				process.env.CODEX_HOME = originalHome;
			}
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
	test('feature flag toggles preserve layout and scrolling while awaiting CLI state', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'historyPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes('data-feature-effective='));
		assert.ok(source.includes('data-feature-source='));
		assert.ok(source.includes('labels.featureFlagEffectiveLabel'));
		assert.ok(source.includes('target.disabled = true;'));
		assert.ok(source.includes("target.closest('.setting-card')"));
		assert.ok(source.includes("querySelector('[data-feature-effective]')"));
		assert.ok(source.includes('await setFeatureFlag('));
		assert.ok(source.includes('Failed to update feature flag row inline'));
		assert.match(source, /\.setting-toggle\s*\{\s*position: relative;/);
		assert.match(
			source,
			/\.setting-toggle input\s*\{\s*position: absolute;\s*inset: 0;/,
		);
		assert.match(source, /\.chain-toggle\s*\{\s*position: relative;/);
		assert.match(
			source,
			/\.chain-toggle input\s*\{\s*position: absolute;\s*inset: 0;/,
		);
		assert.ok(source.includes('html {'));
		assert.ok(source.includes('height: 100%;'));
		assert.ok(source.includes('grid-template-rows: auto minmax(0, 1fr);'));
		assert.ok(source.includes('grid-template-rows: minmax(0, 1fr);'));
		assert.ok(source.includes('class="tab-panels"'));
		assert.ok(source.includes('#featuresContent'));
		assert.ok(source.includes('const previousScrollTop = featuresContent.scrollTop;'));
		assert.ok(source.includes('featuresContent.scrollTop = previousScrollTop;'));
		assert.ok(source.includes("this.refreshTab('features');"));
		assert.ok(!source.includes("document.querySelector('[data-feature-effective=\"' + featureKey + '\"]')"));
		assert.doesNotMatch(
			source,
			/vscode\.window\.showInformationMessage\(messages\.mcpToggleUpdated\);\s*if \(featureKey ===/,
		);
	});

	test('feature messages render CLI stages and reload after a toggle', async () => {
		const fakePanel = createFakePanel();
		let enabled = false;
		const calls: string[][] = [];
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			undefined, undefined, undefined, undefined, undefined, undefined, undefined,
			async (args) => {
				calls.push(args);
				if (args[1] === 'enable') {
					enabled = true;
					return '';
				}
				return `cli_only stable ${enabled}\nold_cli deprecated false\nremoved_cli removed false\nnew_cli under development true`;
			},
		);
		try {
			manager.show();
			// Validate the generated embedded script as JavaScript, not just source fragments.
			const script = fakePanel.panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
			assert.ok(script);
			assert.doesNotThrow(() => new Function(script));
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'features' });
			const initial = await fakePanel.waitForPostedMessage(0) as { html: string };
			for (const key of ['cli_only', 'old_cli', 'removed_cli', 'new_cli']) {
				assert.ok(initial.html.includes(`data-feature-toggle="${key}"`));
			}
			assert.ok(!initial.html.includes('data-feature-toggle="memories"'));
			assert.match(initial.html, /data-feature-toggle="removed_cli"\s+disabled/);
			assert.match(initial.html, /data-feature-toggle="cli_only"\s+\/>/);
			fakePanel.sendMessage({ type: 'setFeatureFlag', featureKey: 'cli_only', enabled: true });
			const updated = await fakePanel.waitForPostedMessage(1) as { html: string };
			assert.match(updated.html, /data-feature-toggle="cli_only" checked/);
			assert.deepStrictEqual(calls, [
				['features', 'list'], ['features', 'list'],
				['features', 'enable', 'cli_only'], ['features', 'list'],
			]);
		} finally {
			manager.dispose();
		}
	});

	test('feature refresh ignores older CLI results that finish last', async () => {
		const fakePanel = createFakePanel();
		let finishFirst: ((output: string) => void) | undefined;
		let calls = 0;
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			undefined, undefined, undefined, undefined, undefined, undefined, undefined,
			async () => {
				calls += 1;
				return calls === 1
					? new Promise<string>((resolve) => { finishFirst = resolve; })
					: 'current stable true';
			},
		);
		try {
			manager.show();
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'features' });
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'features' });
			const current = await fakePanel.waitForPostedMessage(0) as { html: string };
			assert.ok(current.html.includes('data-feature-toggle="current" checked'));
			finishFirst?.('stale stable false');
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.strictEqual(fakePanel.getPostedMessages().length, 1);
		} finally {
			manager.dispose();
		}
	});

	test('feature CLI failures render escaped errors with a retry action', async () => {
		const fakePanel = createFakePanel();
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			undefined, undefined, undefined, undefined, undefined, undefined, undefined,
			async () => { throw new Error('CLI unavailable <script>'); },
		);
		try {
			manager.show();
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'features' });
			const message = await fakePanel.waitForPostedMessage(0) as { html: string };
			assert.ok(message.html.includes('role="alert"'));
			assert.ok(message.html.includes('CLI unavailable &lt;script&gt;'));
			assert.ok(message.html.includes('data-refresh-tab="features"'));
			assert.ok(!message.html.includes('data-feature-toggle='));
		} finally {
			manager.dispose();
		}
	});

	for (const approved of [false, true]) {
		test(`obsolete feature cleanup ${approved ? 'deletes approved keys' : 'preserves the file on cancel'}`, async () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-cleanup-panel-'));
			const previousHome = process.env.CODEX_HOME;
			const configPath = path.join(root, 'config.toml');
			const contents = '[features]\nactive = true\nlegacy = true\nremoved_flag = true\nunknown_flag = false\n';
			const fakePanel = createFakePanel();
			let confirmations = 0;
			const calls: string[][] = [];
			const manager = new HistoryPanelManager(
				() => fakePanel.panel,
				undefined, undefined, undefined, undefined, undefined, undefined, undefined,
				async (args) => {
					calls.push(args);
					return 'active stable true\nlegacy deprecated true\nremoved_flag removed false';
				},
				async (plan) => {
					confirmations += 1;
					assert.strictEqual(plan.configPath, configPath);
					assert.deepStrictEqual(plan.settings.map((setting) => setting.key), ['removed_flag', 'unknown_flag']);
					assert.strictEqual(fs.readFileSync(configPath, 'utf8'), contents);
					return approved;
				},
			);
			try {
				process.env.CODEX_HOME = root;
				fs.writeFileSync(configPath, contents);
				manager.show();
				assert.ok(fakePanel.panel.webview.html.includes("vscode.postMessage({ type: 'cleanupFeatureFlags' })"));
				fakePanel.sendMessage({ type: 'cleanupFeatureFlags' });
				const refreshed = await fakePanel.waitForPostedMessage(0) as { html: string };
				assert.strictEqual(confirmations, 1);
				assert.strictEqual(fs.readFileSync(configPath, 'utf8'), approved
					? '[features]\nactive = true\nlegacy = true\n'
					: contents);
				assert.ok(refreshed.html.includes('data-cleanup-features="true"'));
				if (approved) {
					assert.match(refreshed.html, /data-cleanup-features="true"[^>]*\sdisabled(?:\s|>)/);
				} else {
					assert.ok(refreshed.html.includes('Obsolete settings: 2'));
				}
				assert.ok(!refreshed.html.includes('class="warning-card"'));
				assert.match(refreshed.html, /class="icon-button"[^>]+data-cleanup-features="true"[^>]+aria-label=/);
				assert.deepStrictEqual(calls, Array.from({ length: approved ? 3 : 2 }, () => ['features', 'list']));
			} finally {
				manager.dispose();
				if (previousHome === undefined) {
					delete process.env.CODEX_HOME;
				} else {
					process.env.CODEX_HOME = previousHome;
				}
				fs.rmSync(root, { recursive: true, force: true });
			}
		});
	}

	test('show reuses a single panel instance and reveals it', () => {
		const fakePanel = createFakePanel();
		let createCount = 0;
		const manager = new HistoryPanelManager(() => {
			createCount += 1;
			return fakePanel.panel;
		});

		manager.show();
		manager.show();

		assert.strictEqual(createCount, 1);
		assert.strictEqual(fakePanel.getRevealCount(), 1);
		assert.ok(fakePanel.panel.webview.html.includes('grid-template-columns: 30% 70%'));
		assert.ok(
			fakePanel.panel.webview.html.includes(
				'<button id="clearButton" class="copy-button" type="button"></button>',
			),
		);
		assert.ok(fakePanel.panel.webview.html.includes('codicon codicon-clear-all'));
		assert.ok(fakePanel.panel.webview.html.includes('class="copy-button"'));
		assert.ok(fakePanel.panel.webview.html.includes('id="copyUserButton"'));
		assert.ok(fakePanel.panel.webview.html.includes('copyAssistantButton-'));
		assert.ok(fakePanel.panel.webview.html.includes('codicon codicon-copy'));
		assert.ok(fakePanel.panel.webview.html.includes('codicon codicon-hubot'));
		assert.ok(fakePanel.panel.webview.html.includes('id="chainContext"'));
		assert.ok(fakePanel.panel.webview.html.includes('id="featuresContent"'));
		assert.ok(fakePanel.panel.webview.html.includes('id="hooksContent"'));
		assert.ok(fakePanel.panel.webview.html.includes('reasoning-frame'));
		assert.ok(fakePanel.panel.webview.html.includes('class="message-frame"'));
		assert.ok(
			fakePanel.panel.webview.html.includes(
				'background: var(--vscode-editor-findMatchHighlightBackground);',
			),
		);
		assert.ok(fakePanel.panel.webview.html.includes('mark.search-highlight'));
		manager.dispose();
	});

	test('show clears the active panel when the injected dispose callback fires', () => {
		const firstPanel = createFakePanel();
		const disposeListeners = new Map<vscode.WebviewPanel, () => void>();
		const manager = new HistoryPanelManager(
			() => firstPanel.panel,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			(panel, listener) => {
				disposeListeners.set(panel, listener);
				return { dispose: () => undefined };
			},
		);

		manager.show();
		assert.strictEqual(
			(
				manager as unknown as {
					panel?: vscode.WebviewPanel;
				}
			).panel,
			firstPanel.panel,
		);
		disposeListeners.get(firstPanel.panel)?.();

		assert.strictEqual(
			(
				manager as unknown as {
					panel?: vscode.WebviewPanel;
					state?: unknown;
				}
			).panel,
			undefined,
		);
		assert.strictEqual(
			(
				manager as unknown as {
					panel?: vscode.WebviewPanel;
					state?: unknown;
				}
			).state,
			undefined,
		);
		manager.dispose();
	});

	test('webview messaging updates state for ready, search, clear, and turn selection', () => {
		const fakePanel = createFakePanel();
		const longMessage = `${'x'.repeat(105)}TAIL_TOKEN`;
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 't2',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[11:00:00]',
					sortTimestampMs: 2,
					userMessage: 'Beta session',
					agentMessages: ['beta answer'],
					reasoningMessages: [],
				},
				{
					turnId: 't1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 1,
					userMessage: longMessage,
					agentMessages: [],
					reasoningMessages: [],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 't2',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[11:00:00]',
							sortTimestampMs: 2,
							userMessage: 'Beta session',
							agentMessages: ['beta answer'],
							reasoningMessages: [],
						},
						{
							turnId: 't1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 1,
							userMessage: longMessage,
							agentMessages: [],
							reasoningMessages: [],
						},
					],
				},
			],
		};
		const manager = new HistoryPanelManager(() => fakePanel.panel, () => index);
		manager.show();

		fakePanel.sendMessage({ type: 'ready' });
		const firstState = fakePanel.getPostedMessages()[0] as {
			type: string;
			payload: {
				days: Array<{ dateKey: string; turns: Array<{ turnId: string; displayMessage: string }> }>;
				selectedTurn?: { turnId: string; userMessage: string };
			};
		};
		assert.strictEqual(firstState.type, 'state');
		assert.deepStrictEqual(firstState.payload.days.map((day) => day.dateKey), [
			'2026/02/15',
		]);
		assert.deepStrictEqual(
			firstState.payload.days[0].turns.map((turn) => turn.turnId),
			['t2', 't1'],
		);
		assert.ok(firstState.payload.days[0].turns[1].displayMessage.endsWith('...'));
		assert.strictEqual(firstState.payload.selectedTurn?.turnId, 't2');
		assert.strictEqual(firstState.payload.selectedTurn?.userMessage, 'Beta session');

		fakePanel.sendMessage({ type: 'search', query: 'TAIL_TOKEN' });
		const filteredState = fakePanel.getPostedMessages()[1] as {
			payload: {
				appliedQuery: string;
				days: Array<{ turns: Array<{ turnId: string }> }>;
				selectedTurn?: { turnId: string };
			};
		};
		assert.strictEqual(filteredState.payload.appliedQuery, 'TAIL_TOKEN');
		assert.deepStrictEqual(
			filteredState.payload.days[0].turns.map((turn) => turn.turnId),
			['t1'],
		);
		assert.strictEqual(filteredState.payload.selectedTurn?.turnId, 't1');

		fakePanel.sendMessage({ type: 'selectTurn', turnId: 't2' });
		const selectedState = fakePanel.getPostedMessages()[2] as {
			payload: { selectedTurn?: { turnId: string } };
		};
		assert.strictEqual(selectedState.payload.selectedTurn?.turnId, 't1');

		fakePanel.sendMessage({ type: 'clearSearch' });
		const clearedState = fakePanel.getPostedMessages()[3] as {
			payload: {
				appliedQuery: string;
				days: Array<{ turns: Array<{ turnId: string }> }>;
				selectedTurn?: { turnId: string };
			};
		};
		assert.strictEqual(clearedState.payload.appliedQuery, '');
		assert.deepStrictEqual(
			clearedState.payload.days[0].turns.map((turn) => turn.turnId),
			['t2', 't1'],
		);
		assert.strictEqual(clearedState.payload.selectedTurn?.turnId, 't2');
		manager.dispose();
	});

	test('refreshTab refreshes only the requested core view tab', async () => {
		const fakePanel = createFakePanel();
		let loadCount = 0;
		const index: HistoryIndex = { turns: [], days: [] };
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => {
				loadCount += 1;
				return index;
			},
			undefined, undefined, undefined, undefined, undefined, undefined,
			async () => 'new_cli_feature stable true',
		);
		manager.show();

		fakePanel.sendMessage({ type: 'refreshTab', tab: 'chain' });
		const chainMessage = fakePanel.getPostedMessages()[0] as {
			type: string;
			tab: string;
			payload: { entries: unknown[]; emptyStateMessage?: string; workspaceRoot?: string };
		};
		assert.strictEqual(chainMessage.type, 'tabContent');
		assert.strictEqual(chainMessage.tab, 'chain');
		assert.ok(Array.isArray(chainMessage.payload.entries));
		assert.strictEqual(chainMessage.payload.workspaceRoot, undefined);
		assert.strictEqual(
			chainMessage.payload.emptyStateMessage,
			'Open a workspace folder to view the AGENTS loading chain.',
		);
		assert.strictEqual(loadCount, 0);

		fakePanel.sendMessage({ type: 'refreshTab', tab: 'history' });
		const historyMessage = fakePanel.getPostedMessages()[1] as { type: string };
		assert.strictEqual(historyMessage.type, 'state');
		assert.strictEqual(loadCount, 1);

		fakePanel.sendMessage({ type: 'refreshTab', tab: 'features' });
		const featuresMessage = await fakePanel.waitForPostedMessage(2) as {
			type: string;
			tab: string;
			html: string;
		};
		assert.strictEqual(featuresMessage.type, 'tabContent');
		assert.strictEqual(featuresMessage.tab, 'features');
		assert.ok(featuresMessage.html.includes('data-feature-toggle='));
		manager.dispose();
	});

	test('limits history list to newest maxHistoryCount entries when configured', () => {
		const fakePanel = createFakePanel();
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 'd1-t3',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[12:00:00]',
					sortTimestampMs: 6,
					userMessage: 'D1 Newest',
					agentMessages: ['a3'],
					reasoningMessages: [],
				},
				{
					turnId: 'd2-t3',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '14',
					dateKey: '2026/02/14',
					localTime: '[11:00:00]',
					sortTimestampMs: 5,
					userMessage: 'D2 Newest',
					agentMessages: ['b3'],
					reasoningMessages: [],
				},
				{
					turnId: 'd1-t2',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 4,
					userMessage: 'D1 Middle',
					agentMessages: ['a2'],
					reasoningMessages: [],
				},
				{
					turnId: 'd2-t2',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '14',
					dateKey: '2026/02/14',
					localTime: '[9:00:00]',
					sortTimestampMs: 3,
					userMessage: 'D2 Middle',
					agentMessages: ['b2'],
					reasoningMessages: [],
				},
				{
					turnId: 'd1-t1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[8:00:00]',
					sortTimestampMs: 2,
					userMessage: 'D1 Oldest',
					agentMessages: ['a1'],
					reasoningMessages: [],
				},
				{
					turnId: 'd2-t1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '14',
					dateKey: '2026/02/14',
					localTime: '[7:00:00]',
					sortTimestampMs: 1,
					userMessage: 'D2 Oldest',
					agentMessages: ['b1'],
					reasoningMessages: [],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 'd1-t3',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[12:00:00]',
							sortTimestampMs: 6,
							userMessage: 'D1 Newest',
							agentMessages: ['a3'],
							reasoningMessages: [],
						},
						{
							turnId: 'd1-t2',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 4,
							userMessage: 'D1 Middle',
							agentMessages: ['a2'],
							reasoningMessages: [],
						},
						{
							turnId: 'd1-t1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[8:00:00]',
							sortTimestampMs: 2,
							userMessage: 'D1 Oldest',
							agentMessages: ['a1'],
							reasoningMessages: [],
						},
					],
				},
				{
					dateKey: '2026/02/14',
					year: '2026',
					month: '02',
					day: '14',
					turns: [
						{
							turnId: 'd2-t3',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '14',
							dateKey: '2026/02/14',
							localTime: '[11:00:00]',
							sortTimestampMs: 5,
							userMessage: 'D2 Newest',
							agentMessages: ['b3'],
							reasoningMessages: [],
						},
						{
							turnId: 'd2-t2',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '14',
							dateKey: '2026/02/14',
							localTime: '[9:00:00]',
							sortTimestampMs: 3,
							userMessage: 'D2 Middle',
							agentMessages: ['b2'],
							reasoningMessages: [],
						},
						{
							turnId: 'd2-t1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '14',
							dateKey: '2026/02/14',
							localTime: '[7:00:00]',
							sortTimestampMs: 1,
							userMessage: 'D2 Oldest',
							agentMessages: ['b1'],
							reasoningMessages: [],
						},
					],
				},
			],
		};
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => index,
			async () => undefined,
			async () => undefined,
			() => 2,
		);
		manager.show();

		fakePanel.sendMessage({ type: 'ready' });
		const state = fakePanel.getPostedMessages()[0] as {
			payload: {
				days: Array<{ turns: Array<{ turnId: string }> }>;
				selectedTurn?: { turnId: string };
			};
		};

		assert.strictEqual(state.payload.days.length, 2);
		assert.deepStrictEqual(
			state.payload.days[0].turns.map((turn) => turn.turnId),
			['d1-t3'],
		);
		assert.deepStrictEqual(
			state.payload.days[1].turns.map((turn) => turn.turnId),
			['d2-t3'],
		);
		assert.strictEqual(state.payload.selectedTurn?.turnId, 'd1-t3');
		manager.dispose();
	});

	test('includes reasoning message only when incrudeReasoningMessage is enabled', () => {
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 't1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 1,
					userMessage: 'user',
					agentMessages: ['assistant'],
					reasoningMessages: ['reason-1', 'reason-2'],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 't1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 1,
							userMessage: 'user',
							agentMessages: ['assistant'],
							reasoningMessages: ['reason-1', 'reason-2'],
						},
					],
				},
			],
		};

		const disabledPanel = createFakePanel();
		const disabledManager = new HistoryPanelManager(() => disabledPanel.panel, () => index);
		disabledManager.show();
		disabledPanel.sendMessage({ type: 'ready' });
		const disabledState = disabledPanel.getPostedMessages()[0] as {
			payload: { selectedTurn?: { reasoningMessages?: string[]; assistantMessages?: string[] } };
		};
		assert.deepStrictEqual(disabledState.payload.selectedTurn?.assistantMessages, ['assistant']);
		assert.deepStrictEqual(disabledState.payload.selectedTurn?.reasoningMessages, []);

		const enabledPanel = createFakePanel();
		const enabledManager = new HistoryPanelManager(
			() => enabledPanel.panel,
			() => index,
			async () => undefined,
			async () => undefined,
			() => undefined,
			() => true,
		);
		enabledManager.show();
		enabledPanel.sendMessage({ type: 'ready' });
		const enabledState = enabledPanel.getPostedMessages()[0] as {
			payload: { selectedTurn?: { reasoningMessages?: string[]; assistantMessages?: string[] } };
		};
		assert.deepStrictEqual(enabledState.payload.selectedTurn?.assistantMessages, ['assistant']);
		assert.deepStrictEqual(enabledState.payload.selectedTurn?.reasoningMessages, [
			'reason-1',
			'reason-2',
		]);
		disabledManager.dispose();
		enabledManager.dispose();
	});

	test('selected turn keeps local times for user/assistant/reasoning messages', () => {
		const fakePanel = createFakePanel();
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 't1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 1,
					userMessage: 'user',
					userMessageLocalTime: '[10:00:01]',
					agentMessages: ['assistant-1', 'assistant-2'],
					agentMessageLocalTimes: ['[10:00:02]', '[10:00:03]'],
					reasoningMessages: ['reason-1'],
					reasoningMessageLocalTimes: ['[10:00:04]'],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 't1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 1,
							userMessage: 'user',
							userMessageLocalTime: '[10:00:01]',
							agentMessages: ['assistant-1', 'assistant-2'],
							agentMessageLocalTimes: ['[10:00:02]', '[10:00:03]'],
							reasoningMessages: ['reason-1'],
							reasoningMessageLocalTimes: ['[10:00:04]'],
						},
					],
				},
			],
		};
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => index,
			async () => undefined,
			async () => undefined,
			() => undefined,
			() => true,
		);

		manager.show();
		fakePanel.sendMessage({ type: 'ready' });
		const state = fakePanel.getPostedMessages()[0] as {
			payload: {
				selectedTurn?: {
					userMessageLocalTime?: string;
					assistantMessageLocalTimes?: string[];
					reasoningMessageLocalTimes?: string[];
				};
			};
		};

		assert.strictEqual(state.payload.selectedTurn?.userMessageLocalTime, '[10:00:01]');
		assert.deepStrictEqual(state.payload.selectedTurn?.assistantMessageLocalTimes, [
			'[10:00:02]',
			'[10:00:03]',
		]);
		assert.deepStrictEqual(state.payload.selectedTurn?.reasoningMessageLocalTimes, [
			'[10:00:04]',
		]);
		manager.dispose();
	});

	test('selected turn builds chronological ai timeline', () => {
		const fakePanel = createFakePanel();
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 't1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 1,
					userMessage: 'user',
					agentMessages: ['assistant-1', 'assistant-2'],
					agentMessageLocalTimes: ['[10:00:03]', '[10:00:05]'],
					agentMessageTimestampMs: [3000, 5000],
					reasoningMessages: ['reason-1', 'reason-2'],
					reasoningMessageLocalTimes: ['[10:00:02]', '[10:00:04]'],
					reasoningMessageTimestampMs: [2000, 4000],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 't1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 1,
							userMessage: 'user',
							agentMessages: ['assistant-1', 'assistant-2'],
							agentMessageLocalTimes: ['[10:00:03]', '[10:00:05]'],
							agentMessageTimestampMs: [3000, 5000],
							reasoningMessages: ['reason-1', 'reason-2'],
							reasoningMessageLocalTimes: ['[10:00:02]', '[10:00:04]'],
							reasoningMessageTimestampMs: [2000, 4000],
						},
					],
				},
			],
		};
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => index,
			async () => undefined,
			async () => undefined,
			() => undefined,
			() => true,
		);
		manager.show();
		fakePanel.sendMessage({ type: 'ready' });
		const state = fakePanel.getPostedMessages()[0] as {
			payload: {
				selectedTurn?: {
					aiTimeline?: Array<{ kind: string; message: string }>;
				};
			};
		};
		assert.deepStrictEqual(
			state.payload.selectedTurn?.aiTimeline?.map((item) => `${item.kind}:${item.message}`),
			[
				'reasoning:reason-1',
				'assistant:assistant-1',
				'reasoning:reason-2',
				'assistant:assistant-2',
			],
		);
		manager.dispose();
	});

	test('copyText message writes text to clipboard and shows confirmation', async () => {
		const fakePanel = createFakePanel();
		const index: HistoryIndex = {
			turns: [
				{
					turnId: 't1',
					sessionId: 's1',
					filePath: '/tmp/s1',
					year: '2026',
					month: '02',
					day: '15',
					dateKey: '2026/02/15',
					localTime: '[10:00:00]',
					sortTimestampMs: 1,
					userMessage: 'user',
					agentMessages: ['assistant'],
					reasoningMessages: [],
				},
			],
			days: [
				{
					dateKey: '2026/02/15',
					year: '2026',
					month: '02',
					day: '15',
					turns: [
						{
							turnId: 't1',
							sessionId: 's1',
							filePath: '/tmp/s1',
							year: '2026',
							month: '02',
							day: '15',
							dateKey: '2026/02/15',
							localTime: '[10:00:00]',
							sortTimestampMs: 1,
							userMessage: 'user',
							agentMessages: ['assistant'],
							reasoningMessages: [],
						},
					],
				},
			],
		};
		let copiedText = '';
		let notified = false;
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => index,
			async (value: string) => {
				copiedText = value;
			},
			async () => {
				notified = true;
				return undefined;
			},
		);
		manager.show();
		fakePanel.sendMessage({ type: 'copyText', text: 'copy-target' });
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.strictEqual(copiedText, 'copy-target');
		assert.strictEqual(notified, true);
		manager.dispose();
	});
});
