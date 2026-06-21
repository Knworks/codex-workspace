import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { CODICON_RESOURCE_ROOTS } from '../services/webviewAssets';
import {
	getNoPetFoundDetail,
	getNoPetFoundWarningMessage,
	getPetResourceRootPaths,
	PetExploreProvider,
} from '../views/petExploreProvider';

suite('Pet Explore provider', () => {
	function normalizeFsPath(value: string): string {
		return path.normalize(value).toLowerCase();
	}

	test('uses both pet root candidates as local resource roots', () => {
		const provider = new PetExploreProvider({
			subscriptions: [],
		} as unknown as vscode.ExtensionContext);
		const webview = {
			options: undefined as vscode.WebviewOptions | undefined,
			html: '',
			cspSource: 'vscode-webview://test',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: () => ({ dispose() {} }),
		} as unknown as vscode.Webview;
		const view = { webview } as vscode.WebviewView;

		provider.resolveWebviewView(view);

		const roots = (webview.options?.localResourceRoots ?? []).map((uri) =>
			normalizeFsPath(uri.fsPath),
		);
		const expectedPetRoots = getPetResourceRootPaths().map(normalizeFsPath);
		for (const expectedRoot of expectedPetRoots) {
			assert.ok(
				roots.includes(expectedRoot),
				`Missing pet resource root ${expectedRoot}`,
			);
		}
		for (const codiconRoot of CODICON_RESOURCE_ROOTS) {
			assert.ok(
				roots.includes(normalizeFsPath(codiconRoot.fsPath)),
				`Missing codicon resource root ${codiconRoot.fsPath}`,
			);
		}
	});

	test('empty state html includes codicon font CSP and both pet paths', () => {
		const provider = new PetExploreProvider({
			subscriptions: [],
		} as unknown as vscode.ExtensionContext);
		(provider as unknown as { view?: vscode.WebviewView }).view = {
			webview: {
				cspSource: 'vscode-webview://test',
				asWebviewUri: (uri: vscode.Uri) => uri,
			},
		} as vscode.WebviewView;

		const html = (provider as unknown as {
			buildHtml: (pet: undefined, scale: number) => string;
		}).buildHtml(undefined, 1);

		assert.ok(html.includes('font-src vscode-webview://test data:'));
		assert.ok(html.includes('codicon codicon-error'));
		assert.ok(html.includes(getNoPetFoundDetail()));
	});

	test('warning message mentions both supported pet paths', () => {
		const message = getNoPetFoundWarningMessage();
		for (const petRoot of getPetResourceRootPaths()) {
			assert.ok(message.includes(petRoot));
		}
	});
});
