import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { AgentLocation, findAgentLocationForPath, getAgentLocations } from '../services/agentLocations';
import { AgentManagerRecord, refreshAgentManagerRecords } from '../services/agentManagerService';

/** Uses the same file-backed inventory and enabled state as the Agents tab. */
export class AgentExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	constructor(
		_context: vscode.ExtensionContext,
		statusProvider?: WorkspaceStatusProvider,
		private readonly readRecords: () => AgentManagerRecord[] = () => refreshAgentManagerRecords(resolveCodexPaths().configPath),
		private readonly readLocations: () => AgentLocation[] = getAgentLocations,
	) {
		super(statusProvider);
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		return this.readRecords().map((record) => {
			const fileName = path.basename(record.agentPath);
			const item = new CodexTreeItem('file', 'agents', record.name === path.basename(fileName, path.extname(fileName))
				? fileName : `${record.name} (${fileName})`, vscode.TreeItemCollapsibleState.None, record.agentPath);
			item.id = record.id;
			item.agentRecord = record;
			item.contextValue = 'codex-agent-file';
			item.description = record.location.label;
			item.tooltip = `${record.location.label}: ${record.agentPath}\n${record.configPath}`;
			item.command = { command: 'codex-workspace.openFile', title: 'Open agent file', arguments: [item] };
			item.iconPath = record.enabled ? new vscode.ThemeIcon('hubot')
				: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
			return item;
		});
	}

	getLocationForPath(targetPath: string): AgentLocation | undefined {
		return findAgentLocationForPath(targetPath, this.readLocations());
	}

	getRootOptions(): AgentLocation[] {
		return this.readLocations();
	}
}
