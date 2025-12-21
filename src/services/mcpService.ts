import fs from 'fs';
import path from 'path';

export type McpServer = {
	id: string;
	enabled: boolean;
	enabledLineIndex?: number;
	headerLineIndex: number;
};

const mcpHeaderPattern = /^\s*\[mcp_servers\.([^\]]+)\]\s*$/;
const enabledPattern = /^(\s*enabled\s*=\s*)(true|false)(\s*#.*)?$/i;

export function readMcpServers(configPath: string): McpServer[] {
	const contents = fs.readFileSync(configPath, 'utf8');
	return parseMcpServers(contents);
}

export function parseMcpServers(contents: string): McpServer[] {
	const lines = contents.split(/\r?\n/);
	const blocks: { id: string; headerLineIndex: number; endLineIndex: number }[] = [];
	let currentBlock: { id: string; headerLineIndex: number; endLineIndex: number } | null =
		null;

	for (let i = 0; i < lines.length; i += 1) {
		const headerMatch = lines[i].match(/^\s*\[[^\]]+\]\s*$/);
		if (headerMatch) {
			if (currentBlock) {
				currentBlock.endLineIndex = i - 1;
				currentBlock = null;
			}
			const mcpMatch = lines[i].match(mcpHeaderPattern);
			if (mcpMatch) {
				currentBlock = {
					id: mcpMatch[1],
					headerLineIndex: i,
					endLineIndex: lines.length - 1,
				};
				blocks.push(currentBlock);
			}
			continue;
		}
	}

	return blocks.map((block) => {
		let enabled = true;
		let enabledLineIndex: number | undefined;
		for (let i = block.headerLineIndex + 1; i <= block.endLineIndex; i += 1) {
			const lineMatch = lines[i].match(enabledPattern);
			if (!lineMatch) {
				continue;
			}
			enabled = lineMatch[2].toLowerCase() === 'true';
			enabledLineIndex = i;
			break;
		}
		return {
			id: block.id,
			enabled,
			enabledLineIndex,
			headerLineIndex: block.headerLineIndex,
		};
	});
}

export function toggleMcpServer(configPath: string, serverId: string): boolean {
	const contents = fs.readFileSync(configPath, 'utf8');
	const lines = contents.split(/\r?\n/);
	const blocks = parseMcpServers(contents);
	const target = blocks.find((server) => server.id === serverId);
	if (!target) {
		return false;
	}

	const headerLineIndex = target.headerLineIndex;
	if (target.enabledLineIndex === undefined) {
		lines.splice(headerLineIndex + 1, 0, 'enabled = false');
		writeConfig(configPath, lines);
		return true;
	}

	const line = lines[target.enabledLineIndex];
	const match = line.match(enabledPattern);
	if (!match) {
		return false;
	}
	const nextValue = match[2].toLowerCase() === 'true' ? 'false' : 'true';
	lines[target.enabledLineIndex] = `${match[1]}${nextValue}${match[3] ?? ''}`;
	writeConfig(configPath, lines);
	return true;
}

function writeConfig(configPath: string, lines: string[]): void {
	const normalized = lines.join('\n');
	fs.writeFileSync(configPath, normalized, 'utf8');
}

export function getMcpConfigPath(codexDir: string): string {
	return path.join(codexDir, 'config.toml');
}
