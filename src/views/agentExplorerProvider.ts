import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';

type AgentEntry = {
	name: string;
	fullPath: string;
	isFile: boolean;
};

type AgentEntryReader = (agentsDir: string) => AgentEntry[];
type EnabledAgentReader = (configPath: string) => Set<string>;

const AGENT_CONFIG_HEADER_PATTERN = /^\s*\[agents\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/;

/**
 * Provides the Agents tree view by listing `.codex/agents/*.toml` files.
 * Icon state is derived from whether `[agents.<id>]` exists in config.toml.
 */
export class AgentExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly context: vscode.ExtensionContext;
	private readonly readEntries: AgentEntryReader;
	private readonly readEnabledAgents: EnabledAgentReader;

	constructor(
		context: vscode.ExtensionContext,
		statusProvider?: WorkspaceStatusProvider,
		readEntries: AgentEntryReader = listAgentEntries,
		readEnabledAgents: EnabledAgentReader = readEnabledAgentIds,
	) {
		super(statusProvider);
		this.context = context;
		this.readEntries = readEntries;
		this.readEnabledAgents = readEnabledAgents;
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const { codexDir, configPath } = resolveCodexPaths();
		const agentsDir = path.join(codexDir, 'agents');
		const enabledAgents = this.readEnabledAgents(configPath);
		return this.readEntries(agentsDir)
			.filter((entry) => entry.isFile && path.extname(entry.name).toLowerCase() === '.toml')
			.sort((left, right) =>
				left.name.localeCompare(right.name, undefined, {
					numeric: true,
					sensitivity: 'base',
				}),
			)
			.map((entry) => {
				const item = new CodexTreeItem(
					'file',
					'agents',
					entry.name,
					vscode.TreeItemCollapsibleState.None,
					entry.fullPath,
				);
				item.id = entry.fullPath;
				item.contextValue = 'codex-agent-file';
				item.command = {
					command: 'codex-workspace.openFile',
					title: 'Open agent file',
					arguments: [item],
				};
				item.iconPath = this.getIcon(enabledAgents.has(getAgentId(entry.name)));
				return item;
			});
	}

	private getIcon(isEnabled: boolean): { light: vscode.Uri; dark: vscode.Uri } {
		const iconName = isEnabled ? 'agent_on.png' : 'agent_off.png';
		const iconPath = this.context.asAbsolutePath(path.join('images', iconName));
		const iconUri = vscode.Uri.file(iconPath);
		return {
			light: iconUri,
			dark: iconUri,
		};
	}
}

function listAgentEntries(agentsDir: string): AgentEntry[] {
	if (!fs.existsSync(agentsDir)) {
		return [];
	}
	return fs.readdirSync(agentsDir, { withFileTypes: true }).map((entry) => ({
		name: entry.name,
		fullPath: path.join(agentsDir, entry.name),
		isFile: entry.isFile(),
	}));
}

/**
 * Extracts enabled agent ids from config.toml text by scanning `[agents.*]` headers.
 */
export function parseEnabledAgentIds(contents: string): Set<string> {
	const enabledAgentIds = new Set<string>();
	const lines = contents.split(/\r?\n/);
	for (const line of lines) {
		const match = line.match(AGENT_CONFIG_HEADER_PATTERN);
		if (!match) {
			continue;
		}
		const agentId = match[1] ?? match[2];
		if (!agentId) {
			continue;
		}
		enabledAgentIds.add(agentId);
	}
	return enabledAgentIds;
}

function readEnabledAgentIds(configPath: string): Set<string> {
	try {
		if (!fs.existsSync(configPath)) {
			return new Set<string>();
		}
		const contents = fs.readFileSync(configPath, 'utf8');
		return parseEnabledAgentIds(contents);
	} catch {
		return new Set<string>();
	}
}

function getAgentId(fileName: string): string {
	return path.basename(fileName, path.extname(fileName));
}
