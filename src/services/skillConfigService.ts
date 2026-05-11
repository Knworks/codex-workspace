import fs from 'fs';
import path from 'path';
import { SkillLocation, getSkillLocations } from './skillLocations';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';

export type SkillRecord = {
	id: string;
	name: string;
	description: string;
	skillPath: string;
	location: SkillLocation;
	enabled: boolean;
};

const SKILL_CONFIG_HEADER_PATTERN = /^\s*\[\[skills\.config\]\]\s*$/;
const PATH_PATTERN = /^(\s*path\s*=\s*)(['"])(.*)\2(\s*#.*)?$/;
const ENABLED_PATTERN = /^(\s*enabled\s*=\s*)(true|false)(\s*#.*)?$/i;

export function listSkillRecords(
	configPath: string,
	locations: SkillLocation[] = getSkillLocations(),
): SkillRecord[] {
	const disabledPaths = readSkillEnabledByPath(configPath);
	return locations.flatMap((location) =>
		findSkillMarkdownFiles(location.rootPath).map((skillPath) => {
			const metadata = readSkillMetadata(skillPath);
			const enabled = disabledPaths.get(path.resolve(skillPath)) ?? true;
			return {
				id: `${location.kind}:${skillPath}`,
				name: metadata.name || path.basename(path.dirname(skillPath)),
				description: metadata.description,
				skillPath,
				location,
				enabled,
			};
		}),
	);
}

export function readSkillMetadata(skillPath: string): { name: string; description: string } {
	const contents = fs.readFileSync(skillPath, 'utf8');
	const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return { name: '', description: '' };
	}
	const frontmatter = match[1];
	return {
		name: readFrontmatterString(frontmatter, 'name'),
		description: readFrontmatterString(frontmatter, 'description'),
	};
}

function readFrontmatterString(frontmatter: string, key: string): string {
	const pattern = new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|(.+))\\s*$`, 'm');
	const match = frontmatter.match(pattern);
	return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function findSkillMarkdownFiles(rootPath: string): string[] {
	if (!fs.existsSync(rootPath)) {
		return [];
	}
	const results: string[] = [];
	const traverse = (currentPath: string): void => {
		const entries = fs.readdirSync(currentPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const entryPath = path.join(currentPath, entry.name);
			if (entry.isDirectory()) {
				traverse(entryPath);
				continue;
			}
			if (entry.isFile() && entry.name === 'SKILL.md') {
				results.push(entryPath);
			}
		}
	};
	traverse(rootPath);
	return results.sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
	);
}

export function readSkillEnabledByPath(configPath: string): Map<string, boolean> {
	if (!fs.existsSync(configPath)) {
		return new Map<string, boolean>();
	}
	const blocks = parseSkillConfigBlocks(fs.readFileSync(configPath, 'utf8'));
	const enabledByPath = new Map<string, boolean>();
	for (const block of blocks) {
		if (!block.pathValue) {
			continue;
		}
		enabledByPath.set(
			path.resolve(block.pathValue),
			block.enabledValue ?? true,
		);
	}
	return enabledByPath;
}

export function setSkillEnabled(
	configPath: string,
	skillPath: string,
	enabled: boolean,
): void {
	const contents = fs.existsSync(configPath)
		? fs.readFileSync(configPath, 'utf8')
		: '';
	const lines = contents.split(/\r?\n/);
	const blocks = parseSkillConfigBlocks(contents);
	const resolvedSkillPath = path.resolve(skillPath);
	const existing = blocks.find((block) =>
		block.pathValue ? path.resolve(block.pathValue) === resolvedSkillPath : false,
	);

	if (!existing) {
		if (enabled) {
			return;
		}
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		const nextBlock = [
			'[[skills.config]]',
			`path = '${escapeTomlSingleQuotedString(skillPath)}'`,
			'enabled = false',
		].join('\n');
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(`${contents}${separator}${nextBlock}\n`),
			'utf8',
		);
		return;
	}

	if (enabled) {
		const nextLines = [
			...lines.slice(0, existing.startLineIndex),
			...lines.slice(existing.endLineIndex + 1),
		];
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(nextLines.join('\n')),
			'utf8',
		);
		return;
	}

	if (existing.enabledLineIndex !== undefined) {
		const line = lines[existing.enabledLineIndex];
		const match = line.match(ENABLED_PATTERN);
		if (match) {
			lines[existing.enabledLineIndex] =
				`${match[1]}false${match[3] ?? ''}`;
			fs.writeFileSync(
				configPath,
				stabilizeManagedConfigToml(lines.join('\n')),
				'utf8',
			);
			return;
		}
	}

	lines.splice(existing.endLineIndex + 1, 0, 'enabled = false');
	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(lines.join('\n')),
		'utf8',
	);
}

function escapeTomlSingleQuotedString(value: string): string {
	return value.replace(/'/g, "''");
}

function parseSkillConfigBlocks(contents: string): Array<{
	startLineIndex: number;
	endLineIndex: number;
	pathValue?: string;
	enabledValue?: boolean;
	enabledLineIndex?: number;
}> {
	const lines = contents.split(/\r?\n/);
	const blocks: Array<{
		startLineIndex: number;
		endLineIndex: number;
		pathValue?: string;
		enabledValue?: boolean;
		enabledLineIndex?: number;
	}> = [];
	let current:
		| {
				startLineIndex: number;
				endLineIndex: number;
				pathValue?: string;
				enabledValue?: boolean;
				enabledLineIndex?: number;
		  }
		| undefined;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const isHeader = /^\s*\[/.test(line);
		if (isHeader) {
			if (current) {
				current.endLineIndex = index - 1;
				current = undefined;
			}
			if (SKILL_CONFIG_HEADER_PATTERN.test(line)) {
				current = {
					startLineIndex: index,
					endLineIndex: lines.length - 1,
				};
				blocks.push(current);
			}
			continue;
		}

		if (!current) {
			continue;
		}
		const pathMatch = line.match(PATH_PATTERN);
		if (pathMatch) {
			current.pathValue = pathMatch[3];
			continue;
		}
		const enabledMatch = line.match(ENABLED_PATTERN);
		if (enabledMatch) {
			current.enabledValue = enabledMatch[2].toLowerCase() === 'true';
			current.enabledLineIndex = index;
		}
	}

	return blocks;
}
