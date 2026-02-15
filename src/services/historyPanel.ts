import * as vscode from 'vscode';
import { messages } from '../i18n';

const HISTORY_VIEW_TYPE = 'codex-workspace.history';

function buildHistoryPlaceholderHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${messages.historyPanelTitle}</title>
</head>
<body>
	<h1>${messages.historyPanelTitle}</h1>
	<p>${messages.historyPanelPlaceholder}</p>
</body>
</html>`;
}

export function createHistoryWebviewPanel(): vscode.WebviewPanel {
	return vscode.window.createWebviewPanel(
		HISTORY_VIEW_TYPE,
		messages.historyPanelTitle,
		{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
		{
			enableScripts: false,
			retainContextWhenHidden: true,
		},
	);
}

export class HistoryPanelManager implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;

	constructor(
		private readonly panelFactory: () => vscode.WebviewPanel = createHistoryWebviewPanel,
	) {}

	show(): vscode.WebviewPanel {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active, true);
			return this.panel;
		}

		const panel = this.panelFactory();
		panel.webview.html = buildHistoryPlaceholderHtml();
		panel.onDidDispose(() => {
			if (this.panel === panel) {
				this.panel = undefined;
			}
		});
		this.panel = panel;
		return panel;
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}
}
