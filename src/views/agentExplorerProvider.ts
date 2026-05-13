import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import {
	AgentLocation,
	findAgentLocationForPath,
	getAgentLocations,
} from '../services/agentLocations';
import { listPluginAgentRecords } from '../services/pluginService';

type AgentEntry = {
	name: string;
	fullPath: string;
	isFile: boolean;
};

type AgentEntryReader = (agentsDir: string) => AgentEntry[];
type EnabledAgentReader = (configPath: string) => Set<string>;
type AgentLocationReader = () => AgentLocation[];

const AGENT_CONFIG_HEADER_PATTERN = /^\s*\[agents\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/;

/**
 * Provides the Agents tree view by listing `.codex/agents/*.toml` files.
 * Icon state is derived from whether `[agents.<id>]` exists in config.toml.
 */
export class AgentExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly readEntries: AgentEntryReader;
	private readonly readEnabledAgents: EnabledAgentReader;
	private readonly readLocations: AgentLocationReader;

	constructor(
		_context: vscode.ExtensionContext,
		statusProvider?: WorkspaceStatusProvider,
		readEntries: AgentEntryReader = listAgentEntries,
		readEnabledAgents: EnabledAgentReader = readEnabledAgentIds,
		readLocations: AgentLocationReader = getAgentLocations,
	) {
		super(statusProvider);
		this.readEntries = readEntries;
		this.readEnabledAgents = readEnabledAgents;
		this.readLocations = readLocations;
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		const { configPath } = resolveCodexPaths();
		const enabledAgents = this.readEnabledAgents(configPath);
		const normalItems = this.readLocations().flatMap((location) =>
			this.readEntries(location.rootPath)
				.filter((entry) => entry.isFile && path.extname(entry.name).toLowerCase() === '.toml')
				.sort((left, right) =>
					left.name.localeCompare(right.name, undefined, {
						numeric: true,
						sensitivity: 'base',
					}),
				)
				.map((entry) => this.toTreeItem(entry, enabledAgents, location)),
		);
		const pluginItems = listPluginAgentRecords({ configPath }).map((agent) => {
			const item = new CodexTreeItem(
				'file',
				'agents',
				agent.name,
				vscode.TreeItemCollapsibleState.None,
				agent.definitionPath,
			);
			item.id = `plugin-agent:${agent.pluginId}:${agent.definitionPath}`;
			item.contextValue = 'codex-plugin-agent-file';
			item.description = agent.pluginDisplayName;
			item.tooltip = `${agent.pluginDisplayName}: ${agent.name}\n${agent.definitionPath}`;
			item.command = {
				command: 'codex-workspace.openFile',
				title: 'Open plugin agent file',
				arguments: [item],
			};
			item.iconPath = agent.enabled && !agent.error
				? new vscode.ThemeIcon('plug')
				: new vscode.ThemeIcon(
					agent.error ? 'warning' : 'circle-slash',
					new vscode.ThemeColor(agent.error ? 'editorWarning.foreground' : 'disabledForeground'),
				);
			return item;
		});
		return [...normalItems, ...pluginItems];
	}

	getLocationForPath(targetPath: string): AgentLocation | undefined {
		return findAgentLocationForPath(targetPath, this.readLocations());
	}

	getRootOptions(): AgentLocation[] {
		return this.readLocations();
	}

	private toTreeItem(
		entry: AgentEntry,
		enabledAgents: Set<string>,
		location: AgentLocation,
	): CodexTreeItem {
				const isEnabled = enabledAgents.has(getAgentId(entry.name));
				const item = new CodexTreeItem(
					'file',
					'agents',
					entry.name,
					vscode.TreeItemCollapsibleState.None,
					entry.fullPath,
				);
				item.id = entry.fullPath;
				item.contextValue = 'codex-agent-file';
				item.description = location.label;
				item.tooltip = `${location.label}: ${entry.fullPath}`;
				item.command = {
					command: 'codex-workspace.openFile',
					title: 'Open agent file',
					arguments: [item],
				};
				item.iconPath = this.getIcon(isEnabled);
				return item;
	}

	private getIcon(isEnabled: boolean): vscode.ThemeIcon {
		if (isEnabled) {
			return new vscode.ThemeIcon('hubot');
		}

		return new vscode.ThemeIcon(
			'circle-slash',
			new vscode.ThemeColor('disabledForeground'),
		);
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
