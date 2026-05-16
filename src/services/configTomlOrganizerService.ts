import fs from 'fs';
import path from 'path';

const WORKSPACE_META_DIR = '.codex-workspace';
const CONFIG_BACKUP_FILE = 'config.toml.bk';

type ManagedClusterKind =
	| 'features'
	| 'skills.config'
	| 'agents'
	| 'mcp'
	| 'projects';

type TopLevelBlock = {
	startLine: number;
	endLine: number;
	text: string;
	clusterKind?: ManagedClusterKind;
	mcpParentId?: string;
	mcpCompanionParentId?: string;
};

export type OrganizeConfigTomlResult = {
	backupPath: string;
	changed: boolean;
};

export function organizeConfigToml(configPath: string): OrganizeConfigTomlResult {
	if (!fs.existsSync(configPath)) {
		throw new Error(`config.toml not found: ${configPath}`);
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	const backupPath = getConfigTomlBackupPath(configPath);
	fs.mkdirSync(path.dirname(backupPath), { recursive: true });
	fs.writeFileSync(backupPath, contents, 'utf8');

	const organized = organizeConfigTomlContents(contents);
	if (organized !== contents) {
		fs.writeFileSync(configPath, organized, 'utf8');
	}

	return {
		backupPath,
		changed: organized !== contents,
	};
}

export function stabilizeManagedConfigToml(contents: string): string {
	const organized = organizeConfigTomlContents(contents);
	if (organized.length === 0 || organized.endsWith('\n')) {
		return organized;
	}
	return `${organized}\n`;
}

export function getConfigTomlBackupPath(configPath: string): string {
	return path.join(path.dirname(configPath), WORKSPACE_META_DIR, CONFIG_BACKUP_FILE);
}

export function organizeConfigTomlContents(contents: string): string {
	if (contents.length === 0) {
		return contents;
	}

	const { lines, blocks } = parseTopLevelBlocks(contents);
	if (blocks.length === 0) {
		return contents;
	}

	const managedBlocks = blocks.filter((block) => block.clusterKind);
	if (managedBlocks.length === 0) {
		return contents;
	}

	const clusterFirstIndex = new Map<ManagedClusterKind, number>();
	for (let index = 0; index < blocks.length; index += 1) {
		const clusterKind = blocks[index].clusterKind;
		if (clusterKind && !clusterFirstIndex.has(clusterKind)) {
			clusterFirstIndex.set(clusterKind, index);
		}
	}

	const clusterContents = new Map<ManagedClusterKind, string>();
	for (const clusterKind of clusterFirstIndex.keys()) {
		const clusterBlocks = blocks.filter((block) => block.clusterKind === clusterKind);
		clusterContents.set(
			clusterKind,
			clusterKind === 'mcp'
				? buildMcpClusterText(clusterBlocks)
				: joinBlocksWithSingleBlankLine(clusterBlocks),
		);
	}

	const preamble =
		blocks[0].startLine > 0
			? `${lines.slice(0, blocks[0].startLine).join('\n')}\n`
			: '';
	const emittedClusters = new Set<ManagedClusterKind>();
	let rebuilt = preamble;

	for (let index = 0; index < blocks.length; index += 1) {
		for (const [clusterKind, firstIndex] of clusterFirstIndex) {
			if (!emittedClusters.has(clusterKind) && firstIndex === index) {
				rebuilt += clusterContents.get(clusterKind) ?? '';
				emittedClusters.add(clusterKind);
			}
		}

		if (blocks[index].clusterKind) {
			continue;
		}
		rebuilt += blocks[index].text;
	}

	return rebuilt;
}

function buildMcpClusterText(blocks: TopLevelBlock[]): string {
	const companionsByParentId = new Map<string, TopLevelBlock[]>();
	for (const block of blocks) {
		if (block.mcpCompanionParentId) {
			const companions = companionsByParentId.get(block.mcpCompanionParentId) ?? [];
			companions.push(block);
			companionsByParentId.set(block.mcpCompanionParentId, companions);
		}
	}

	const emitted = new Set<TopLevelBlock>();
	let result = '';
	for (const block of blocks) {
		if (emitted.has(block)) {
			continue;
		}
		if (block.mcpParentId) {
			result += normalizeBlockText(block.text);
			emitted.add(block);
			const companionBlocks = companionsByParentId.get(block.mcpParentId) ?? [];
			for (const companionBlock of companionBlocks) {
				if (emitted.has(companionBlock)) {
					continue;
				}
				result += `\n${normalizeBlockText(companionBlock.text)}`;
				emitted.add(companionBlock);
			}
			result += '\n\n';
			continue;
		}
		result += `${normalizeBlockText(block.text)}\n\n`;
		emitted.add(block);
	}

	return result.replace(/\n{3,}$/u, '\n\n');
}

function parseKnownMcpCompanionId(
	id: string,
	allowUnknownBareCompanion = false,
): { parentId: string; settingName: string } | undefined {
	for (const settingName of ['env', 'http_headers', 'env_http_headers']) {
		const suffix = `.${settingName}`;
		if (id.toLowerCase().endsWith(suffix)) {
			return {
				parentId: id.slice(0, -suffix.length),
				settingName,
			};
		}
	}
	const toolsMarker = '.tools.';
	const toolsIndex = id.toLowerCase().indexOf(toolsMarker);
	if (toolsIndex > 0 && toolsIndex + toolsMarker.length < id.length) {
		return {
			parentId: id.slice(0, toolsIndex),
			settingName: id.slice(toolsIndex + 1),
		};
	}
	if (!allowUnknownBareCompanion) {
		return undefined;
	}
	const segments = id.split('.');
	if (segments.length > 1 && segments[0]) {
		return {
			parentId: segments[0],
			settingName: segments.slice(1).join('.'),
		};
	}
	return undefined;
}

function joinBlocksWithSingleBlankLine(blocks: TopLevelBlock[]): string {
	return `${blocks.map((block) => normalizeBlockText(block.text)).join('\n\n')}\n\n`;
}

function normalizeBlockText(text: string): string {
	return text.replace(/\n+$/u, '');
}

function parseTopLevelBlocks(contents: string): {
	lines: string[];
	blocks: TopLevelBlock[];
} {
	const lines = contents.split(/\r?\n/);
	const headerIndexes: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (isTopLevelHeader(lines[index])) {
			headerIndexes.push(index);
		}
	}

	const blocks: TopLevelBlock[] = [];
	for (let index = 0; index < headerIndexes.length; index += 1) {
		const startLine = headerIndexes[index];
		const endLine =
			index + 1 < headerIndexes.length
				? headerIndexes[index + 1] - 1
				: lines.length - 1;
		const headerLine = lines[startLine];
		blocks.push({
			startLine,
			endLine,
			text: `${lines.slice(startLine, endLine + 1).join('\n')}\n`,
			...classifyBlock(headerLine),
		});
	}

	return { lines, blocks };
}

function isTopLevelHeader(line: string): boolean {
	return /^\s*\[[^\]]+\]\s*$/.test(line) || /^\s*\[\[[^\]]+\]\]\s*$/.test(line);
}

function classifyBlock(headerLine: string): Partial<TopLevelBlock> {
	if (/^\s*\[features\]\s*$/.test(headerLine)) {
		return { clusterKind: 'features' };
	}
	if (/^\s*\[\[skills\.config\]\]\s*$/.test(headerLine)) {
		return { clusterKind: 'skills.config' };
	}
	const agentMatch = headerLine.match(
		/^\s*\[agents\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_-]+))\]\s*$/,
	);
	if (agentMatch) {
		return { clusterKind: 'agents' };
	}
	const projectMatch = headerLine.match(
		/^\s*\[projects\.(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\]\s*$/,
	);
	if (projectMatch) {
		return { clusterKind: 'projects' };
	}
	const mcpMatch = headerLine.match(
		/^\s*\[mcp_servers\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.-]+))\]\s*$/,
	);
	if (mcpMatch) {
		const quotedId = mcpMatch[1];
		const bareId = mcpMatch[2];
		const blockId = unescapeTomlString(quotedId ?? bareId ?? '');
		const companion = parseKnownMcpCompanionId(blockId, !quotedId);
		if (companion) {
			return {
				clusterKind: 'mcp',
				mcpCompanionParentId: companion.parentId,
			};
		}
		return {
			clusterKind: 'mcp',
			mcpParentId: blockId,
		};
	}
	return {};
}

function unescapeTomlString(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
