import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { resolveCodexPaths } from '../services/workspaceStatus';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { AgentLocation, findAgentLocationForPath, getAgentLocations } from '../services/agentLocations';
import { ManagedAgentRecord, listManagedAgentRecords, getManagedAgentOpenPath } from '../services/managedAgentService';
import { getAgentStatusLabel } from '../services/managedAgentActions';

/** Uses the same CLI definitions, candidates and diagnostics as the Agents tab. */
export class AgentExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	constructor(
		_context: vscode.ExtensionContext,
		statusProvider?: WorkspaceStatusProvider,
		private readonly readRecords: () => ManagedAgentRecord[] = () => listManagedAgentRecords(resolveCodexPaths().configPath),
		private readonly readLocations: () => AgentLocation[] = getAgentLocations,
	) {
		super(statusProvider);
	}

	protected getAvailableChildren(): vscode.ProviderResult<CodexTreeItem[]> {
		return this.readRecords().map((record) => {
			const fileName = path.basename(record.agentPath);
			const item = new CodexTreeItem('file', 'agents', record.name === path.basename(fileName, path.extname(fileName))
				? fileName : `${record.name} (${fileName})`, vscode.TreeItemCollapsibleState.None, getManagedAgentOpenPath(record));
			item.id = record.id;
			item.agentRecord = record;
			item.contextValue = 'codex-agent-file';
			item.description = `${record.location.label} · ${getAgentStatusLabel(record.availability)}`;
			item.tooltip = `${record.location.label}: ${record.agentPath}\n${record.configPath}\n${record.reason ?? getAgentStatusLabel(record.availability)}`;
			item.command = { command: 'codex-workspace.openFile', title: 'Open agent file', arguments: [item] };
			item.iconPath = record.enabled ? new vscode.ThemeIcon('hubot')
				: record.availability === 'disabled' ? new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'))
					: new vscode.ThemeIcon(record.availability === 'candidate' ? 'question' : 'warning');
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
