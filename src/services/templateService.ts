import fs from 'fs';
import path from 'path';
import { resolveCodexPaths } from './workspaceStatus';

export type TemplateCandidate = {
	label: string;
	fsPath: string;
};

export function getTemplateRootPath(homeDir?: string): string {
	return path.join(resolveCodexPaths(homeDir).codexDir, 'templates');
}

export function listTemplateCandidates(rootPath?: string): TemplateCandidate[] {
	const templatesRoot = rootPath ?? getTemplateRootPath();
	if (!fs.existsSync(templatesRoot)) {
		return [];
	}

	const files = listFilesRecursively(templatesRoot);
	return files
		.filter((filePath) => !path.basename(filePath).startsWith('.'))
		.map((filePath) => ({
			label: path.relative(templatesRoot, filePath),
			fsPath: filePath,
		}));
}

export function readTemplateContents(templatePath: string): string {
	return fs.readFileSync(templatePath, 'utf8');
}

function listFilesRecursively(targetDir: string): string[] {
	const entries = fs.readdirSync(targetDir, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const entryPath = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			results.push(...listFilesRecursively(entryPath));
			continue;
		}
		if (entry.isFile()) {
			results.push(entryPath);
		}
	}

	return results;
}
