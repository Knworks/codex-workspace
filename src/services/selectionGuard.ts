import * as vscode from 'vscode';
import { messages } from '../i18n';

export function ensureSelection<T>(item: T | undefined): item is T {
	if (item) {
		return true;
	}

	vscode.window.showInformationMessage(messages.selectionRequired);
	return false;
}
