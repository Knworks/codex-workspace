import os from 'os';
import path from 'path';

export type WorkspacePaths = {
	codexDir: string;
	configPath: string;
};

/** Resolves the shared Codex root, preserving non-blank environment paths verbatim. */
export function resolveCodexHomeDir(homeDir: string = os.homedir()): string {
	const codexHome = process.env.CODEX_HOME;
	return codexHome?.trim() ? codexHome : path.join(homeDir, '.codex');
}

export function resolveCodexPaths(homeDir: string = os.homedir()): WorkspacePaths {
	const codexDir = resolveCodexHomeDir(homeDir);
	return {
		codexDir,
		configPath: path.join(codexDir, 'config.toml'),
	};
}
