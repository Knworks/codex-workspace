import fs from 'fs';
import path from 'path';

const invalidCharsPattern = /[<>:"/\\|?*\u0000-\u001F]/g;

export function sanitizeName(input: string): string {
	const trimmed = input.trim();
	return trimmed.replace(invalidCharsPattern, '_');
}

export function applyDefaultExtension(fileName: string, extension = '.md'): string {
	if (path.extname(fileName)) {
		return fileName;
	}
	return `${fileName}${extension}`;
}

export function resolveUniqueName(parentDir: string, fileName: string): string {
	const parsed = path.parse(fileName);
	let counter = 1;
	let candidate = fileName;

	while (pathExists(path.join(parentDir, candidate))) {
		candidate = `${parsed.name}_${counter}${parsed.ext}`;
		counter += 1;
	}

	return candidate;
}

function pathExists(targetPath: string): boolean {
	try {
		return fsExistsSync(targetPath);
	} catch {
		return false;
	}
}

function fsExistsSync(targetPath: string): boolean {
	return fs.existsSync(targetPath);
}
