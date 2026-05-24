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
	agentFolder: string;
};

export type PetSettings = {
	enabled: boolean;
	appServerEnabled: boolean;
	rateLimitRefreshMinutes: number;
	scale: number;
	selectedPetId: string;
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

const readNumberSetting = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const clampNumber = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

function readLegacyPetConfiguration<T>(
	key: string,
): T | undefined {
	return vscode.workspace.getConfiguration('codexWorkspace').get<T>(key);
}

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
		agentFolder: readStringSetting(configuration.get('agentFolder')),
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

export function getPetSettings(
	configuration: ConfigurationReader = vscode.workspace.getConfiguration(
		SETTINGS_SECTION,
	),
): PetSettings {
	const enabled =
		configuration.get<boolean>('pet.enabled')
		?? readLegacyPetConfiguration<boolean>('pet.enabled')
		?? true;
	const appServerEnabled =
		configuration.get<boolean>('pet.appServer.enabled')
		?? readLegacyPetConfiguration<boolean>('pet.appServer.enabled')
		?? false;
	const refreshMinutes = readNumberSetting(
		configuration.get('pet.rateLimitRefreshMinutes')
			?? readLegacyPetConfiguration<number>('pet.rateLimitRefreshMinutes'),
	);
	const scale = readNumberSetting(
		configuration.get('pet.scale')
			?? readLegacyPetConfiguration<number>('pet.scale'),
	);
	const inspectedScale = configuration.inspect<number>('pet.scale');
	const explicitScale =
		inspectedScale?.workspaceFolderValue
		?? inspectedScale?.workspaceValue
		?? inspectedScale?.globalValue;
	const normalizedScale =
		scale === undefined
			? 1
			: explicitScale === 0.5
				? 1
				: clampNumber(Number(scale.toFixed(1)), 0.5, 2);
	return {
		enabled: readBooleanSetting(enabled),
		appServerEnabled: readBooleanSetting(appServerEnabled),
			rateLimitRefreshMinutes:
				refreshMinutes === undefined
					? 5
					: clampNumber(Number(refreshMinutes.toFixed(1)), 0, 60),
			scale: normalizedScale,
		selectedPetId: readStringSetting(
			configuration.get('pet.selectedPetId')
				?? readLegacyPetConfiguration<string>('pet.selectedPetId'),
		),
	};
}

export async function updatePetScale(scale: number): Promise<void> {
	const normalized = clampNumber(Number(scale.toFixed(1)), 0.5, 2);
	await vscode.workspace
		.getConfiguration(SETTINGS_SECTION)
		.update('pet.scale', normalized, vscode.ConfigurationTarget.Global);
}

export async function updatePetSelectedPetId(petId: string): Promise<void> {
	await vscode.workspace
		.getConfiguration(SETTINGS_SECTION)
		.update('pet.selectedPetId', petId, vscode.ConfigurationTarget.Global);
}
