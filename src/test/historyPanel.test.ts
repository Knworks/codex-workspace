import * as assert from 'assert';
import * as vscode from 'vscode';
import { HistoryPanelManager } from '../services/historyPanel';

type FakePanelHandle = {
	panel: vscode.WebviewPanel;
	getRevealCount: () => number;
	triggerDispose: () => void;
};

function createFakePanel(): FakePanelHandle {
	let revealCount = 0;
	let disposeListener: (() => void) | undefined;
	const webview = { html: '' } as vscode.Webview;

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
		assert.ok(fakePanel.panel.webview.html.length > 0);
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
});
