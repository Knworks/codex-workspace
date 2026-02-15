import * as assert from 'assert';
import * as vscode from 'vscode';
import { HistoryPanelManager } from '../services/historyPanel';
import { HistoryIndex } from '../services/historyService';

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	getRevealCount: () => number;
	triggerDispose: () => void;
	sendMessage: (message: unknown) => void;
	getPostedMessages: () => unknown[];
};

function createFakePanel(): FakePanelHandle {
	let revealCount = 0;
	let disposeListener: (() => void) | undefined;
	let receiveListener: ((message: unknown) => void) | undefined;
	const postedMessages: unknown[] = [];
	const webview = {
		html: '',
		cspSource: 'vscode-webview://test',
		asWebviewUri: (uri: vscode.Uri) => uri,
		postMessage: async (message: unknown) => {
			postedMessages.push(message);
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
		triggerDispose: () => disposeListener?.(),
		sendMessage: (message: unknown) => receiveListener?.(message),
		getPostedMessages: () => postedMessages,
	};
}

suite('History panel manager', () => {
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
		assert.ok(fakePanel.panel.webview.html.includes('reasoning-frame'));
		assert.ok(fakePanel.panel.webview.html.includes('class="message-frame"'));
		assert.ok(
			fakePanel.panel.webview.html.includes(
				'background: var(--vscode-editor-findMatchHighlightBackground);',
			),
		);
		assert.ok(fakePanel.panel.webview.html.includes('mark.search-highlight'));
	});

	test('show creates a new panel after the current panel is disposed', () => {
		const firstPanel = createFakePanel();
		const secondPanel = createFakePanel();
		const panels = [firstPanel.panel, secondPanel.panel];
		let createCount = 0;
		const manager = new HistoryPanelManager(() => {
			const panel = panels[createCount];
			createCount += 1;
			return panel;
		});

		manager.show();
		firstPanel.triggerDispose();
		manager.show();

		assert.strictEqual(createCount, 2);
		assert.strictEqual(secondPanel.getRevealCount(), 0);
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
	});
});
