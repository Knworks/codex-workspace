import * as vscode from 'vscode';

const selectionRequiredMessage = '操作する対象を選択してください。';

export function ensureSelection<T>(item: T | undefined): item is T {
	if (item) {
		return true;
	}

	vscode.window.showInformationMessage(selectionRequiredMessage);
	return false;
}
