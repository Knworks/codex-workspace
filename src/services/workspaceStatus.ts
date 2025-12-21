import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'toml';
import { messages } from '../i18n';

export type WorkspaceStatus = {
	isAvailable: boolean;
	reason?: string;
};

export type WorkspacePaths = {
	codexDir: string;
	configPath: string;
};

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

export function resolveCodexPaths(homeDir: string = os.homedir()): WorkspacePaths {
	const codexDir = path.join(homeDir, '.codex');
	return {
		codexDir,
		configPath: path.join(codexDir, 'config.toml'),
	};
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
