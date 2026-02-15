import * as vscode from 'vscode';

/**
 * Settings section name for Codex Workspace extension.
 */
export const SETTINGS_SECTION = 'codex-workspace';

/**
 * Sync destination folders configured by the user.
 */
export type SyncSettings = {
	codexFolder: string;
	promptsFolder: string;
	skillsFolder: string;
	templatesFolder: string;
};

type ConfigurationReader = Pick<vscode.WorkspaceConfiguration, 'get' | 'inspect'>;

const readStringSetting = (value: unknown): string =>
	typeof value === 'string' ? value : '';

const readBooleanSetting = (value: unknown): boolean =>
	typeof value === 'boolean' ? value : false;

const readPositiveIntegerSetting = (value: unknown): number | undefined => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return undefined;
	}
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : undefined;
};

/**
 * Reads sync folder settings from VS Code configuration.
 *
 * @param configuration - Configuration source (defaults to VS Code settings).
 * @returns Sync folder paths with empty strings for unset values.
 */
export function getSyncSettings(
	configuration: ConfigurationReader = vscode.workspace.getConfiguration(
		SETTINGS_SECTION,
	),
): SyncSettings {
	return {
		codexFolder: readStringSetting(configuration.get('codexFolder')),
		promptsFolder: readStringSetting(configuration.get('promptsFolder')),
		skillsFolder: readStringSetting(configuration.get('skillsFolder')),
		templatesFolder: readStringSetting(configuration.get('templatesFolder')),
	};
}

/**
 * Reads history list limit from VS Code configuration.
 *
 * Note:
 * - Returns a positive integer only when the user explicitly set maxHistoryCount.
 * - Returns undefined when not configured, so callers can treat it as "show all".
 */
export function getConfiguredMaxHistoryCount(
	configuration: ConfigurationReader = vscode.workspace.getConfiguration(
		SETTINGS_SECTION,
	),
): number | undefined {
	const inspected = configuration.inspect<number>('maxHistoryCount');
	if (!inspected) {
		return undefined;
	}
	const explicitValue =
		inspected.workspaceFolderValue ?? inspected.workspaceValue ?? inspected.globalValue;
	return readPositiveIntegerSetting(explicitValue);
}

/**
 * Reads whether reasoning messages should be included in history preview.
 */
export function getIncludeReasoningMessage(
	configuration: ConfigurationReader = vscode.workspace.getConfiguration(
		SETTINGS_SECTION,
	),
): boolean {
	return readBooleanSetting(configuration.get('incrudeReasoningMessage'));
}
