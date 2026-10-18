import * as vscode from 'vscode';
import { messages } from '../i18n';
import { listAgentConfigSources } from './agentManagerService';
import { ManagedAgentRecord, registerManagedAgent } from './managedAgentService';

export async function registerAgentCandidate(configPath: string, record: ManagedAgentRecord): Promise<boolean> {
	const source = await vscode.window.showQuickPick(listAgentConfigSources(configPath).map((item) => ({
		label: item.location.label, description: item.configPath, configPath: item.configPath,
	})), { placeHolder: messages.agentRegistrationSource });
	if (!source) { return false; }
	const description = record.description || await vscode.window.showInputBox({
		prompt: messages.agent.inputDescription, validateInput: (value) => value.trim() ? undefined : messages.agentDescriptionRequired,
	});
	if (description === undefined) { return false; }
	registerManagedAgent(configPath, record.id, source.configPath, description);
	return true;
}

export function getAgentStatusLabel(status: ManagedAgentRecord['availability']): string {
	return messages.agentStatuses[status];
}
