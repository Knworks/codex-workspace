import * as vscode from 'vscode';
import { messages } from '../i18n';

export async function runSafely<T>(action: () => Promise<T> | T): Promise<T | undefined> {
	try {
		return await action();
	} catch (error) {
		console.error(error);
		vscode.window.showErrorMessage(messages.unexpectedError);
		return undefined;
	}
}
