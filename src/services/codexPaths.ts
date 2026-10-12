import os from 'os';
import path from 'path';

export type WorkspacePaths = {
	codexDir: string;
	configPath: string;
};

/** Resolves Codex home consistently for configuration, state, and plugin assets. */
export function resolveCodexHomeDir(homeDir: string = os.homedir()): string {
	const codexHome = process.env.CODEX_HOME;
	return codexHome?.trim() ? codexHome : path.join(homeDir, '.codex');
}

export function resolveCodexPaths(homeDir?: string): WorkspacePaths {
	const codexDir = resolveCodexHomeDir(homeDir);
	return {
		codexDir,
		configPath: path.join(codexDir, 'config.toml'),
	};
}

export function resolvePluginCacheRoot(homeDir?: string): string {
	return path.join(resolveCodexHomeDir(homeDir), 'plugins', 'cache');
}
