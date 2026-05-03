import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { parse } from 'toml';
import { resolveCodexPaths } from './workspaceStatus';

export type AgentsChainStatus = 'Active' | 'Skipped' | 'Missing' | 'Error';
export type AgentsChainKind = 'Global' | 'Project';
export type AgentsChainType = 'Standard' | 'Override' | 'Fallback';

export type AgentsChainNode = {
	status: AgentsChainStatus;
	kind: AgentsChainKind;
	type: AgentsChainType;
	fileName: string;
	absolutePath: string;
	reason: string;
	contentPreview?: string;
};

export type TrustedDirectory = {
	path: string;
	exists: boolean;
	reason?: string;
};

export function buildAgentsLoadingChain(
	workspaceRoot: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	homeDir: string = os.homedir(),
): AgentsChainNode[] {
	const { codexDir, configPath } = resolveCodexPaths(homeDir);
	const fallbackNames = readFallbackNames(configPath);
	const nodes: AgentsChainNode[] = [];
	nodes.push(
		...buildTierNodes(codexDir, 'Global', ['AGENTS.override.md', 'AGENTS.md']),
	);
	if (workspaceRoot) {
		nodes.push(
			...buildTierNodes(
				workspaceRoot,
				'Project',
				['AGENTS.override.md', 'AGENTS.md', ...fallbackNames],
				fallbackNames,
			),
		);
	}
	return nodes;
}

export function listTrustedDirectories(configPath: string): TrustedDirectory[] {
	if (!fs.existsSync(configPath)) {
		return [];
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	return parseProjectBlocks(contents)
		.filter((block) => block.trustLevel === 'trusted')
		.map((block) => {
			const exists = fs.existsSync(block.projectPath);
			return {
				path: block.projectPath,
				exists,
				reason: exists ? undefined : 'Directory does not exist or cannot be accessed.',
			};
		});
}

export function addTrustedDirectory(configPath: string, projectPath: string): void {
	const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	const blocks = parseProjectBlocks(contents);
	const existing = blocks.find((block) => block.projectPath === projectPath);
	if (!existing) {
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		fs.writeFileSync(
			configPath,
			`${contents}${separator}[projects."${escapeTomlString(projectPath)}"]\ntrust_level = "trusted"\n`,
			'utf8',
		);
		return;
	}
	const lines = contents.split(/\r?\n/);
	if (existing.trustLine !== undefined) {
		lines[existing.trustLine] = 'trust_level = "trusted"';
	} else {
		lines.splice(existing.endLine + 1, 0, 'trust_level = "trusted"');
	}
	fs.writeFileSync(configPath, normalizeLines(lines), 'utf8');
}

export function removeTrustedDirectory(configPath: string, projectPath: string): boolean {
	const contents = fs.readFileSync(configPath, 'utf8');
	const target = parseProjectBlocks(contents).find((block) => block.projectPath === projectPath);
	if (!target) {
		return false;
	}
	const lines = contents.split(/\r?\n/);
	lines.splice(target.startLine, target.endLine - target.startLine + 1);
	fs.writeFileSync(configPath, normalizeLines(lines), 'utf8');
	return true;
}

function buildTierNodes(
	root: string,
	kind: AgentsChainKind,
	fileNames: string[],
	fallbackNames: string[] = [],
): AgentsChainNode[] {
	const candidates = fileNames.map((fileName) =>
		buildNode(root, kind, fileName, fallbackNames.includes(fileName)),
	);
	const firstReadable = candidates.find((node) => node.status === 'Active');
	if (!firstReadable) {
		return candidates;
	}
	return candidates.map((node) => {
		if (node.absolutePath === firstReadable.absolutePath) {
			return node;
		}
		if (node.status === 'Active') {
			return {
				...node,
				status: 'Skipped' as const,
				reason: `${firstReadable.fileName} has higher priority.`,
			};
		}
		return node;
	});
}

function buildNode(
	root: string,
	kind: AgentsChainKind,
	fileName: string,
	isFallback: boolean,
): AgentsChainNode {
	const absolutePath = path.join(root, fileName);
	const type: AgentsChainType = fileName === 'AGENTS.override.md'
		? 'Override'
		: isFallback
			? 'Fallback'
			: 'Standard';
	if (!fs.existsSync(absolutePath)) {
		return {
			status: 'Missing',
			kind,
			type,
			fileName,
			absolutePath,
			reason: isFallback ? 'Fallback candidate is missing.' : 'Candidate file is absent.',
		};
	}
	try {
		const contents = fs.readFileSync(absolutePath, 'utf8');
		return {
			status: 'Active',
			kind,
			type,
			fileName,
			absolutePath,
			reason: 'First readable candidate in this tier.',
			contentPreview: contents.slice(0, 2000),
		};
	} catch (error) {
		return {
			status: 'Error',
			kind,
			type,
			fileName,
			absolutePath,
			reason: error instanceof Error ? error.message : 'Read failed.',
		};
	}
}

function readFallbackNames(configPath: string): string[] {
	try {
		if (!fs.existsSync(configPath)) {
			return [];
		}
		const parsed = parse(fs.readFileSync(configPath, 'utf8')) as {
			project_doc_fallback_filenames?: unknown;
		};
		return Array.isArray(parsed.project_doc_fallback_filenames)
			? parsed.project_doc_fallback_filenames.filter((item): item is string => typeof item === 'string')
			: [];
	} catch {
		return [];
	}
}

function parseProjectBlocks(contents: string): Array<{
	projectPath: string;
	startLine: number;
	endLine: number;
	trustLine?: number;
	trustLevel?: string;
}> {
	const lines = contents.split(/\r?\n/);
	const blocks: Array<{
		projectPath: string;
		startLine: number;
		endLine: number;
		trustLine?: number;
		trustLevel?: string;
	}> = [];
	let current: (typeof blocks)[number] | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const header = lines[index].match(/^\s*\[projects\."((?:[^"\\]|\\.)*)"\]\s*$/);
		if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
			if (current) {
				current.endLine = index - 1;
				current = undefined;
			}
			if (header) {
				current = {
					projectPath: header[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
					startLine: index,
					endLine: lines.length - 1,
				};
				blocks.push(current);
			}
			continue;
		}
		if (!current) {
			continue;
		}
		const trust = lines[index].match(/^\s*trust_level\s*=\s*"([^"]*)"/);
		if (trust) {
			current.trustLine = index;
			current.trustLevel = trust[1];
		}
	}
	return blocks;
}

function escapeTomlString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeLines(lines: string[]): string {
	return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}
