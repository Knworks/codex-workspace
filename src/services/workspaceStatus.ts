import fs from 'fs';
import { parse } from 'toml';
import { messages } from '../i18n';
import { resolveCodexPaths } from './codexPaths';

export { resolveCodexPaths, type WorkspacePaths } from './codexPaths';

export type WorkspaceStatus = {
	isAvailable: boolean;
	reason?: string;
	isConfigInvalid?: boolean;
};

// NOTE: Use a distinct folder name to avoid VS Code language heuristics (e.g., Django templates) in user template files.
export const TEMPLATE_FOLDER_NAME = 'codex-templates';

export const UNAVAILABLE_REASONS = {
	codexMissing: messages.reasonCodexMissing,
	configMissing: messages.reasonConfigMissing,
	configUnreadable: messages.reasonConfigUnreadable,
	configInvalid: messages.reasonConfigInvalid,
} as const;

export const UNAVAILABLE_PREFIX = messages.unavailablePrefix;

export function getUnavailableLabel(reason: string): string {
	return `${UNAVAILABLE_PREFIX}${reason}`;
}

export function getWorkspaceStatus(homeDir?: string): WorkspaceStatus {
	const paths = resolveCodexPaths(homeDir);

	if (!fs.existsSync(paths.codexDir)) {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.codexMissing };
	}

	if (!fs.existsSync(paths.configPath)) {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.configMissing };
	}

	let configContents = '';
	try {
		configContents = fs.readFileSync(paths.configPath, 'utf8');
	} catch {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.configUnreadable };
	}

	try {
		parse(configContents);
	} catch {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.configInvalid };
	}

	return { isAvailable: true };
}

/**
 * Returns availability for Codex Core repair-oriented operations.
 *
 * Core files must remain openable when `config.toml` exists but is invalid TOML,
 * because the editor is the recovery path for fixing that file.
 */
export function getCoreWorkspaceStatus(homeDir?: string): WorkspaceStatus {
	const paths = resolveCodexPaths(homeDir);

	if (!fs.existsSync(paths.codexDir)) {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.codexMissing };
	}

	if (!fs.existsSync(paths.configPath)) {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.configMissing };
	}

	let configContents = '';
	try {
		configContents = fs.readFileSync(paths.configPath, 'utf8');
	} catch {
		return { isAvailable: false, reason: UNAVAILABLE_REASONS.configUnreadable };
	}

	try {
		parse(configContents);
	} catch {
		return {
			isAvailable: true,
			reason: UNAVAILABLE_REASONS.configInvalid,
			isConfigInvalid: true,
		};
	}

	return { isAvailable: true };
}
