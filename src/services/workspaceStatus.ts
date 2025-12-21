import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'toml';

export type WorkspaceStatus = {
	isAvailable: boolean;
	reason?: string;
};

export type WorkspacePaths = {
	codexDir: string;
	configPath: string;
};

export const UNAVAILABLE_REASONS = {
	codexMissing: '.codex が存在しません',
	configMissing: 'config.toml が存在しません',
	configUnreadable: 'config.toml を読み取れません',
	configInvalid: 'config.toml を解析できません',
} as const;

export const UNAVAILABLE_PREFIX = '? Codex Workspace を開けません: ';

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
