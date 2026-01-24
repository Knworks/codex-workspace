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

type ConfigurationReader = Pick<vscode.WorkspaceConfiguration, 'get'>;

const readStringSetting = (value: unknown): string =>
	typeof value === 'string' ? value : '';

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
