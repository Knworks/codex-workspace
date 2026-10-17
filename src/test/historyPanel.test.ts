import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as vscode from 'vscode';
import { HistoryPanelManager } from '../services/historyPanel';
import { HistoryIndex, createHistoryIndex } from '../services/historyService';
import { readThreadHistoryIndex } from '../services/threadHistoryService';

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	getRevealCount: () => number;
	sendMessage: (message: unknown) => void;
	getPostedMessages: () => unknown[];
	getProgressMessages: () => Array<{ loading: boolean; failed: boolean; count: number }>;
};

function createFakePanel(): FakePanelHandle {
	let revealCount = 0;
	let disposeListener: (() => void) | undefined;
	let receiveListener: ((message: unknown) => void) | undefined;
	const postedMessages: unknown[] = [];
	const progressMessages: Array<{ loading: boolean; failed: boolean; count: number }> = [];
	const webview = {
		html: '',
		cspSource: 'vscode-webview://test',
		asWebviewUri: (uri: vscode.Uri) => uri,
		postMessage: async (message: unknown) => {
			if ((message as { type: string }).type === 'historyProgress') {
				progressMessages.push(message as { loading: boolean; failed: boolean; count: number });
			} else { postedMessages.push(message); }
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
		getProgressMessages: () => progressMessages,
	};
}

suite('History panel manager', () => {
	test('incremental history keeps selection, search and copy usable and reports loading and failure', async () => {
		const panel = createFakePanel();
		const makeTurn = (id: string, timestamp: number) => ({
			turnId: id, sessionId: id, filePath: '', year: '2026', month: '10', day: '13', dateKey: '2026/10/13',
			localTime: '[10:00:00]', sortTimestampMs: timestamp, userMessage: id, agentMessages: ['answer'], reasoningMessages: [],
		});
		let publish!: (index: HistoryIndex) => void;
		let reject!: (error: Error) => void;
		const copied: string[] = [];
		const errors: string[] = [];
		const manager = new HistoryPanelManager(() => panel.panel, (_signal, onProgress) => {
			publish = onProgress!;
			return new Promise<HistoryIndex>((_resolve, fail) => { reject = fail; });
		}, async (text) => { copied.push(text); }, async () => undefined, () => undefined,
			() => false, undefined, undefined, (error) => { errors.push(error); });
		try {
			manager.show(); panel.sendMessage({ type: 'ready' });
			publish(createHistoryIndex([makeTurn('older', 1)]));
			assert.strictEqual(panel.getProgressMessages().at(-1)?.loading, true);
			panel.sendMessage({ type: 'selectTurn', turnId: 'older' });
			panel.sendMessage({ type: 'search', query: 'older' });
			panel.sendMessage({ type: 'copyText', text: 'answer' });
			await new Promise<void>((resolve) => setTimeout(resolve, 110));
			publish(createHistoryIndex([makeTurn('older', 1), makeTurn('newer', 2)]));
			const last = panel.getPostedMessages().at(-1) as { payload: { appliedQuery: string; selectedTurn: { turnId: string }; days: Array<{ turns: unknown[] }> } };
			assert.strictEqual(last.payload.appliedQuery, 'older');
			assert.strictEqual(last.payload.selectedTurn.turnId, 'older');
			assert.strictEqual(last.payload.days[0].turns.length, 1);
			assert.deepStrictEqual(copied, ['answer']);
			panel.sendMessage({ type: 'clearSearch' });
			panel.sendMessage({ type: 'selectTurn', turnId: 'older' });
			await new Promise<void>((resolve) => setTimeout(resolve, 110));
			publish(createHistoryIndex([makeTurn('older', 1), makeTurn('newer', 2), makeTurn('newest', 3)]));
			assert.strictEqual((panel.getPostedMessages().at(-1) as typeof last).payload.selectedTurn.turnId, 'older');
			reject(new Error('later page failed'));
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.deepStrictEqual(errors, ['later page failed']);
			assert.strictEqual(panel.getProgressMessages().at(-1)?.failed, true);
			assert.strictEqual(panel.getProgressMessages().at(-1)?.count, 3);
		} finally { manager.dispose(); }
	});

	test('flushes the last incremental result on error and ignores callbacks from cancelled loads', async () => {
		const panel = createFakePanel();
		const requests: Array<{ publish: (index: HistoryIndex) => void; reject: (error: Error) => void }> = [];
		const manager = new HistoryPanelManager(() => panel.panel, (_signal, publish) =>
			new Promise<HistoryIndex>((_resolve, reject) => { requests.push({ publish: publish!, reject }); }),
			undefined, undefined, undefined, undefined, undefined, undefined, () => undefined);
		try {
			manager.show(); panel.sendMessage({ type: 'ready' });
			requests[0].publish({ days: [], turns: [] });
			requests[0].publish(createHistoryIndex([{
				turnId: 'last', sessionId: 'last', filePath: '', year: '2026', month: '10', day: '13', dateKey: '2026/10/13',
				localTime: '[10:00:00]', sortTimestampMs: 1, userMessage: 'last', agentMessages: [], reasoningMessages: [],
			}]));
			requests[0].reject(new Error('failed'));
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.strictEqual(panel.getProgressMessages().at(-1)?.count, 1);
			panel.sendMessage({ type: 'refreshTab', tab: 'history' });
			const count = panel.getPostedMessages().length;
			requests[0].publish({ days: [], turns: [] });
			assert.strictEqual(panel.getPostedMessages().length, count);
			manager.dispose();
			requests[1].publish({ days: [], turns: [] });
			requests[1].reject(new Error('cancelled'));
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.strictEqual(panel.getPostedMessages().length, count);
		} finally { manager.dispose(); }
	});

	test('API history reaches list selection, search, Markdown preview and copy buttons', async () => {
		const fakePanel = createFakePanel();
		const copied: string[] = [];
		const errors: string[] = [];
		let fail = false;
		const manager = new HistoryPanelManager(() => fakePanel.panel, () => readThreadHistoryIndex({
			async request(method, params) {
				if (fail) { throw new Error('API unavailable'); }
				if (method === 'thread/list') {
					return { data: [{ id: params.archived ? 'archive' : 'active', createdAt: 1791800000 }] };
				}
				if (method === 'thread/turns/list') {
					return { data: [{ id: 'turn', startedAt: params.threadId === 'archive' ? 1791790000 : 1791800000, items: [] }] };
				}
				assert.strictEqual(method, 'thread/items/list');
				return { data: [
					{ turnId: 'turn', item: { type: 'userMessage', content: [{ type: 'text', text: `${params.threadId} **question**` }] } },
					{ turnId: 'turn', item: { type: 'agentMessage', text: '# Answer\n\n`result` <script>unsafe</script>' } },
				] };
			},
			dispose() {},
		}), async (text) => { copied.push(text); }, async () => undefined,
		() => undefined, () => false, undefined, undefined, (error) => { errors.push(error); });

		// Execute the generated webview script with DOM event/markup doubles.
		// This exercises rendering and messaging without claiming browser layout coverage.
		class ElementDouble {
			private markup = '';
			get innerHTML(): string { return this.markup; }
			set innerHTML(value: string) { this.markup = value; this.children = []; this.scrollTop = 0; }
			textContent = '';
			value = '';
			dataset: Record<string, string> = {};
			open = false;
			scrollTop = 0;
			children: ElementDouble[] = [];
			listeners = new Map<string, () => void>();
			addEventListener(event: string, listener: () => void): void { this.listeners.set(event, listener); }
			appendChild(child: ElementDouble): void { this.children.push(child); }
			setAttribute(): void {}
			querySelectorAll(): ElementDouble[] { return []; }
			click(): void { this.listeners.get('click')?.(); }
		}
		const elements = new Map<string, ElementDouble>();
		const element = (id: string): ElementDouble => {
			if (!elements.has(id)) { elements.set(id, new ElementDouble()); }
			return elements.get(id)!;
		};
		let receive: ((event: { data: unknown }) => void) | undefined;
		let posted = 0;
		const deliver = (): void => {
			const messages = fakePanel.getPostedMessages();
			while (posted < messages.length) { receive?.({ data: messages[posted++] }); }
		};
		const settle = async (): Promise<void> => {
			await new Promise<void>((resolve) => setImmediate(resolve));
			deliver();
		};
		try {
			manager.show();
			const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(fakePanel.panel.webview.html)?.[1];
			assert.ok(script);
			vm.runInNewContext(script, {
				acquireVsCodeApi: () => ({ postMessage: (message: unknown) => fakePanel.sendMessage(message) }),
				document: {
					getElementById: element, querySelectorAll: () => [], addEventListener: () => undefined,
					createElement: () => new ElementDouble(),
				},
				window: { addEventListener: (_event: string, listener: typeof receive) => { receive = listener; } },
			});
			await settle();
			const cards = element('treeArea').children[0].children[1].children;
			assert.strictEqual(cards.length, 2);
			assert.ok(cards[0].children[0].innerHTML.includes('active **question**'));
			cards[1].click();
			deliver();
			assert.ok(element('previewArea').innerHTML.includes('archive <strong>question</strong>'));
			assert.ok(element('previewArea').innerHTML.includes('<h1>Answer</h1>'));
			assert.ok(element('previewArea').innerHTML.includes('<code>result</code>'));
			assert.ok(element('previewArea').innerHTML.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
			element('previewArea').scrollTop = 240;
			element('treeArea').scrollTop = 100;
			fakePanel.sendMessage({ type: 'selectTurn', turnId: 'archive:turn' });
			deliver();
			assert.strictEqual(element('previewArea').scrollTop, 240);
			assert.strictEqual(element('treeArea').scrollTop, 100);
			element('copyUserButton').click();
			element('copyAssistantButton-0').click();
			await settle();
			assert.deepStrictEqual(copied, ['archive **question**', '# Answer\n\n`result` <script>unsafe</script>']);
			element('searchInput').value = 'archive';
			element('searchInput').listeners.get('input')?.();
			deliver();
			const filtered = fakePanel.getPostedMessages().at(-1) as { payload: { days: Array<{ turns: Array<{ turnId: string }> }> } };
			assert.deepStrictEqual(filtered.payload.days.flatMap((day) => day.turns.map((turn) => turn.turnId)), ['archive:turn']);
			element('clearButton').click();
			deliver();
			const beforeFailure = element('previewArea').innerHTML;
			fail = true;
			fakePanel.sendMessage({ type: 'refreshTab', tab: 'history' });
			await settle();
			assert.deepStrictEqual(errors, ['API unavailable']);
			assert.strictEqual(element('previewArea').innerHTML, beforeFailure);
		} finally {
			manager.dispose();
		}
	});

	test('loads API history asynchronously and reports errors while retaining the previous result', async () => {
		const fakePanel = createFakePanel();
		const errors: string[] = [];
		let fail = false;
		const manager = new HistoryPanelManager(() => fakePanel.panel, async () => {
			if (fail) {
				throw new Error('Storage read failed');
			}
			return { days: [], turns: [] };
		}, undefined, undefined, undefined, undefined, undefined, undefined, (message) => { errors.push(message); });
		manager.show();
		fakePanel.sendMessage({ type: 'ready' });
		assert.strictEqual(fakePanel.getPostedMessages().length, 0);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.strictEqual((fakePanel.getPostedMessages()[0] as { type: string }).type, 'state');
		fail = true;
		fakePanel.sendMessage({ type: 'refreshTab', tab: 'history' });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.deepStrictEqual(errors, ['Storage read failed']);
		assert.strictEqual(fakePanel.getPostedMessages().length, 1);
		manager.dispose();
	});

	test('ignores stale asynchronous refreshes and cancels requests on refresh and disposal', async () => {
		const fakePanel = createFakePanel();
		const requests: Array<{ resolve: (index: HistoryIndex) => void; signal?: AbortSignal }> = [];
		const manager = new HistoryPanelManager(() => fakePanel.panel, (signal) =>
			new Promise<HistoryIndex>((resolve) => { requests.push({ resolve, signal }); }),
		);
		manager.show();
		fakePanel.sendMessage({ type: 'ready' });
		fakePanel.sendMessage({ type: 'refreshTab', tab: 'history' });
		assert.strictEqual(requests[0].signal?.aborted, true);
		requests[1].resolve({ days: [], turns: [] });
		await new Promise<void>((resolve) => setImmediate(resolve));
		requests[0].resolve({ days: [], turns: [] });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.strictEqual(fakePanel.getPostedMessages().length, 1);
		fakePanel.sendMessage({ type: 'refreshTab', tab: 'history' });
		manager.dispose();
		assert.strictEqual(requests[2].signal?.aborted, true);
		requests[2].resolve({ days: [], turns: [] });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.strictEqual(fakePanel.getPostedMessages().length, 1);
	});

	test('feature flag toggles update inline without refreshing the feature list', () => {
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
		assert.ok(source.includes('labels.featureFlagSourceConfig'));
		assert.ok(source.includes("target.closest('.setting-card')"));
		assert.ok(source.includes("querySelector('[data-feature-effective]')"));
		assert.ok(source.includes("querySelector('[data-feature-source]')"));
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
		assert.ok(!source.includes("this.refreshTab('features');"));
		assert.ok(!source.includes("document.querySelector('[data-feature-effective=\"' + featureKey + '\"]')"));
		assert.doesNotMatch(
			source,
			/vscode\.window\.showInformationMessage\(messages\.mcpToggleUpdated\);\s*if \(featureKey ===/,
		);
	});

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
		assert.ok(fakePanel.panel.webview.html.includes('grid-template-columns: minmax(0, 3fr) minmax(0, 7fr)'));
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

	test('refreshTab refreshes only the requested core view tab', () => {
		const fakePanel = createFakePanel();
		let loadCount = 0;
		const index: HistoryIndex = { turns: [], days: [] };
		const manager = new HistoryPanelManager(
			() => fakePanel.panel,
			() => {
				loadCount += 1;
				return index;
			},
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
		const featuresMessage = fakePanel.getPostedMessages()[2] as {
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
