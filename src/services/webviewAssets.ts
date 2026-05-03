import * as vscode from 'vscode';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

function resolveCodiconCssFsPath(): string | undefined {
	const distCandidates = [
		path.join(__dirname, 'webview', 'codicons', 'codicon.css'),
		path.join(__dirname, '..', 'dist', 'webview', 'codicons', 'codicon.css'),
		path.join(__dirname, '..', '..', 'dist', 'webview', 'codicons', 'codicon.css'),
	];
	for (const candidate of distCandidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	try {
		const nodeRequire = createRequire(__filename);
		return nodeRequire.resolve('@vscode/codicons/dist/codicon.css');
	} catch {
		return undefined;
	}
}

const CODICON_CSS_FS_PATH = resolveCodiconCssFsPath();

export const CODICON_RESOURCE_ROOTS = CODICON_CSS_FS_PATH
	? [vscode.Uri.joinPath(vscode.Uri.file(CODICON_CSS_FS_PATH), '..')]
	: [];

export function getCodiconCssHref(webview: vscode.Webview): string | undefined {
	return CODICON_CSS_FS_PATH && typeof webview.asWebviewUri === 'function'
		? webview.asWebviewUri(vscode.Uri.file(CODICON_CSS_FS_PATH)).toString()
		: undefined;
}

export function getCodiconIconPath(
	iconName: string,
): vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | undefined {
	const lightIconPath = resolveCodiconIconFsPath(iconName, 'light');
	const darkIconPath = resolveCodiconIconFsPath(iconName, 'dark');
	if (lightIconPath && darkIconPath) {
		return {
			light: vscode.Uri.file(lightIconPath),
			dark: vscode.Uri.file(darkIconPath),
		};
	}
	const iconFsPath = resolveCodiconIconFsPath(iconName);
	return iconFsPath ? vscode.Uri.file(iconFsPath) : undefined;
}

function resolveCodiconIconFsPath(iconName: string, theme?: 'light' | 'dark'): string | undefined {
	const safeIconName = iconName.replace(/[^a-z0-9-]/gi, '');
	const themeSegment = theme ? `${theme}${path.sep}` : '';
	const distCandidates = [
		path.join(__dirname, 'webview', 'codicons', 'icons', themeSegment, `${safeIconName}.svg`),
		path.join(__dirname, '..', 'dist', 'webview', 'codicons', 'icons', themeSegment, `${safeIconName}.svg`),
		path.join(__dirname, '..', '..', 'dist', 'webview', 'codicons', 'icons', themeSegment, `${safeIconName}.svg`),
	];
	for (const candidate of distCandidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	try {
		const nodeRequire = createRequire(__filename);
		return nodeRequire.resolve(`@vscode/codicons/src/icons/${safeIconName}.svg`);
	} catch {
		return undefined;
	}
}
