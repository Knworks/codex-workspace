import fs from 'fs';
import path from 'path';
import { resolveCodexHomeDir } from './codexPaths';

export type ProfileConfigFile = {
	name: string;
	fileName: string;
	configPath: string;
};

/** Lists Profile V2 files without parsing or merging their settings. */
export function listProfileConfigFiles(homeDir?: string): ProfileConfigFile[] {
	const codexDir = resolveCodexHomeDir(homeDir);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(codexDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
	const suffix = '.config.toml';
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(suffix) && entry.name.length > suffix.length)
		.map((entry) => ({
			name: entry.name.slice(0, -suffix.length),
			fileName: entry.name,
			configPath: path.join(codexDir, entry.name),
		}))
		.sort((left, right) => left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0);
}
