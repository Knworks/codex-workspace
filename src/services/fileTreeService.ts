import fs from 'fs';
import path from 'path';

export type FileEntry = {
	name: string;
	fullPath: string;
	isDirectory: boolean;
	isFile: boolean;
};

export function listFileEntries(targetPath: string): FileEntry[] {
	if (!targetPath || !fs.existsSync(targetPath)) {
		return [];
	}

	const entries = fs.readdirSync(targetPath, { withFileTypes: true });
	return entries.map((entry) => ({
		name: entry.name,
		fullPath: path.join(targetPath, entry.name),
		isDirectory: entry.isDirectory(),
		isFile: entry.isFile(),
	}));
}
