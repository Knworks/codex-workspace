import fs from 'fs';
import path from 'path';

export function ensureDirectoryExists(targetDir: string): void {
	if (!fs.existsSync(targetDir)) {
		fs.mkdirSync(targetDir, { recursive: true });
	}
}

export function createFile(targetDir: string, fileName: string, contents = ''): string {
	ensureDirectoryExists(targetDir);
	const fullPath = path.join(targetDir, fileName);
	fs.writeFileSync(fullPath, contents, 'utf8');
	return fullPath;
}

export function createFolder(targetDir: string, folderName: string): string {
	ensureDirectoryExists(targetDir);
	const fullPath = path.join(targetDir, folderName);
	ensureDirectoryExists(fullPath);
	return fullPath;
}

export function deletePath(targetPath: string): void {
	fs.rmSync(targetPath, { recursive: true, force: true });
}

export function renamePath(sourcePath: string, targetPath: string): void {
	fs.renameSync(sourcePath, targetPath);
}

export function pathExists(targetPath: string): boolean {
	return fs.existsSync(targetPath);
}
