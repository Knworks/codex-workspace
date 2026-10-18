import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { ensureSelection } from '../services/selectionGuard';
import { getWorkspaceStatus, resolveCodexPaths } from '../services/workspaceStatus';
import { messages } from '../i18n';
import { runSafely } from '../services/errorHandling';
import { sanitizeName } from '../services/fileNaming';
import { createAgentScaffold } from '../services/agentScaffold';
import {
	listTemplateCandidates,
	readTemplateContents,
} from '../services/templateService';
import { promptTextInputWithQuickPick } from '../services/textInputQuickPick';
import {
	toAgentConfigFilePath,
	upsertAgentConfigMetadata,
} from '../services/agentConfigService';
import { stabilizeManagedConfigToml } from '../services/configTomlOrganizerService';
import { AgentExplorerProvider } from '../views/agentExplorerProvider';
import { AgentManagerRecord, parseAgentRoleDeclarations } from '../services/agentManagerService';
import { deleteManagedAgent, editManagedAgent, resolveManagedAgent, setManagedAgentEnabled } from '../services/managedAgentService';
import { registerAgentCandidate } from '../services/managedAgentActions';
import { readAgentDefinition } from '../services/cliAgentService';

type AgentCommandContext = {
	getSelection: () => CodexTreeItem | undefined;
	agentProvider: AgentExplorerProvider;
	onDidChangeAgents?: () => void;
};

export function registerAgentCommands(
	context: vscode.ExtensionContext,
	config: AgentCommandContext,
): vscode.Disposable[] {
	const { getSelection, agentProvider } = config;
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.commands.registerCommand('codex-workspace.addAgent', () =>
			runSafely(async () => {
				if (!ensureAvailable()) {
					return;
				}
				await addAgent(agentProvider);
				config.onDidChangeAgents?.();
			}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.editAgent',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					if (!ensureAvailable()) {
						return;
					}
					const selection = resolveAgentSelection(item, getSelection);
					if (!ensureSelection(selection) || !selection.fsPath) {
						return;
					}
					await editAgent(selection.fsPath, agentProvider, selection.agentRecord);
					config.onDidChangeAgents?.();
				}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.deleteAgent',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					if (!ensureAvailable()) {
						return;
					}
					const selection = resolveAgentSelection(item, getSelection);
					if (!ensureSelection(selection) || !selection.fsPath) {
						return;
					}
					await deleteAgent(selection.fsPath, agentProvider, selection.agentRecord);
					config.onDidChangeAgents?.();
				}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.enableAgent',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					if (!ensureAvailable()) {
						return;
					}
					const selection = resolveAgentSelection(item, getSelection);
					if (!ensureSelection(selection) || !selection.fsPath) {
						return;
					}
					await enableAgent(selection.fsPath, agentProvider, selection.agentRecord);
					config.onDidChangeAgents?.();
				}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.disableAgent',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					if (!ensureAvailable()) {
						return;
					}
					const selection = resolveAgentSelection(item, getSelection);
					if (!ensureSelection(selection) || !selection.fsPath) {
						return;
					}
					await disableAgent(selection.fsPath, agentProvider, selection.agentRecord);
					config.onDidChangeAgents?.();
				}),
		),
	);

	context.subscriptions.push(...disposables);
	return disposables;
}

async function addAgent(agentProvider: AgentExplorerProvider): Promise<void> {
	const agentsDir = await pickAgentLocationRoot(agentProvider);
	if (!agentsDir) {
		return;
	}
	const configPath = path.join(path.dirname(agentsDir), 'config.toml');
	const agentName = await promptAgentName();
	if (!agentName) {
		return;
	}
	const description = await promptAgentDescription();
	if (description === undefined) {
		return;
	}
	const templateContent = await pickTemplateContents();
	if (templateContent === null) {
		return;
	}
	const initialAgentContents = templateContent ?? createAgentScaffold(agentName, description);

	fs.mkdirSync(agentsDir, { recursive: true });
	const agentFilePath = path.join(agentsDir, `${agentName}.toml`);
	if (fs.existsSync(agentFilePath)) {
		vscode.window.showWarningMessage(messages.agent.fileExists(agentName));
		return;
	}

	fs.writeFileSync(agentFilePath, initialAgentContents, 'utf8');

	const configContents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	if (parseAgentRoleDeclarations(configContents).some((role) => role.name === agentName)) {
		vscode.window.showWarningMessage(messages.agent.configExists(agentName));
		agentProvider.refresh();
		return;
	}
	if (!readAgentDefinition(agentFilePath, true).reason) { agentProvider.refresh(); return; }

	fs.writeFileSync(
		configPath,
		stabilizeManagedConfigToml(
			upsertAgentConfigMetadata(
				configContents,
				agentName,
				description,
				toAgentConfigFilePath(configPath, agentFilePath),
			),
		),
		'utf8',
	);
	agentProvider.refresh();
}

async function editAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
	record?: AgentManagerRecord,
): Promise<void> {
	const configPath = resolveCodexPaths().configPath;
	const target = resolveManagedAgent(configPath, record ? { id: record.id } : { agentPath: agentFilePath });
	const currentName = path.basename(target.agentPath).replace(/\.toml(?:\.disabled)?$/, '');

	const nextName = await promptAgentName(currentName);
	if (!nextName) {
		return;
	}
	const nextDescription = await promptAgentDescription(target.description);
	if (nextDescription === undefined) {
		return;
	}
	const nextFilePath = path.join(path.dirname(target.agentPath), `${nextName}.toml${target.agentPath.endsWith('.disabled') ? '.disabled' : ''}`);
	if (
		!isSamePath(agentFilePath, nextFilePath) &&
		fs.existsSync(nextFilePath)
	) {
		vscode.window.showWarningMessage(messages.agent.fileExists(nextName));
		return;
	}
	editManagedAgent(configPath, target.id, nextFilePath, nextDescription);
	agentProvider.refresh();
}

async function deleteAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
	record?: AgentManagerRecord,
): Promise<void> {
	const { configPath } = resolveCodexPaths();
	const target = resolveManagedAgent(configPath, record ? { id: record.id } : { agentPath: agentFilePath });
	const location = agentProvider.getLocationForPath(agentFilePath);
	const warning =
		location?.kind === 'user'
			? `\n${messages.agent.userAgentsDeleteWarning}`
			: '';
	const choice = await vscode.window.showWarningMessage(
		`${messages.agent.deleteConfirm(path.basename(agentFilePath))}${warning}`,
		{ modal: true },
		messages.dialogOk,
	);
	if (choice !== messages.dialogOk) {
		return;
	}
	deleteManagedAgent(configPath, target.id);
	agentProvider.refresh();
}

async function pickAgentLocationRoot(
	agentProvider: AgentExplorerProvider,
): Promise<string | null> {
	const locations = agentProvider.getRootOptions();
	const projectFirst = [
		...locations.filter((location) => location.kind === 'project'),
		...locations.filter((location) => location.kind !== 'project'),
	];
	const selected = await vscode.window.showQuickPick(
		projectFirst.map((location) => ({
			label: location.label,
			description: location.rootPath,
			location,
		})),
		{ placeHolder: messages.agent.locationPickPlaceholder },
	);
	return selected
		? (selected.location.createPath ?? selected.location.rootPath)
		: null;
}

async function enableAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
	record?: AgentManagerRecord,
): Promise<void> {
	const { configPath } = resolveCodexPaths();
	const target = resolveManagedAgent(configPath, record ? { id: record.id } : { agentPath: agentFilePath });
	const changed = target.definitionFormat === 'candidate'
		? await registerAgentCandidate(configPath, target) : setManagedAgentEnabled(configPath, target.id, true);
	if (!changed) {
		return;
	}
	vscode.window.showInformationMessage(messages.agent.toggleUpdated);
	agentProvider.refresh();
}

async function disableAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
	record?: AgentManagerRecord,
): Promise<void> {
	const { configPath } = resolveCodexPaths();
	const target = resolveManagedAgent(configPath, record ? { id: record.id } : { agentPath: agentFilePath });
	if (!setManagedAgentEnabled(configPath, target.id, false)) {
		vscode.window.showWarningMessage(messages.agent.notEnabled(target.name));
		return;
	}
	vscode.window.showInformationMessage(messages.agent.toggleUpdated);
	agentProvider.refresh();
}

function ensureAvailable(): boolean {
	return getWorkspaceStatus().isAvailable;
}

function resolveAgentSelection(
	item: CodexTreeItem | undefined,
	getSelection: () => CodexTreeItem | undefined,
): CodexTreeItem | undefined {
	const selection = item ?? getSelection();
	if (!selection) {
		return undefined;
	}
	if (selection.kind !== 'agents' || selection.nodeType !== 'file') {
		vscode.window.showInformationMessage(messages.agent.selectionNotSupported);
		return undefined;
	}
	return selection;
}

async function promptAgentName(defaultValue?: string): Promise<string | undefined> {
	const value = await promptTextInputWithQuickPick({
		title: messages.agent.inputName,
		placeholder: messages.agent.inputName,
		initialValue: defaultValue,
		resolvePreviewValue: (rawValue) => {
			const sanitized = sanitizeName(rawValue.trim());
			const withoutExt = path.basename(sanitized, path.extname(sanitized));
			return withoutExt;
		},
		formatLabel: (previewValue) => `${previewValue}.toml`,
	});
	if (value === undefined) {
		return undefined;
	}
	const sanitized = sanitizeName(value.trim());
	const withoutExt = path.basename(sanitized, path.extname(sanitized));
	if (!withoutExt) {
		vscode.window.showErrorMessage(messages.agent.invalidName);
		return undefined;
	}
	return withoutExt;
}

async function promptAgentDescription(defaultValue = ''): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt: messages.agent.inputDescription,
		value: defaultValue,
	});
}

async function pickTemplateContents(): Promise<string | null | undefined> {
	const templates = listTemplateCandidates();
	if (templates.length === 0) {
		return undefined;
	}

	const items: vscode.QuickPickItem[] = [
		{ label: messages.file.templateNone },
		...templates.map((candidate) => ({
			label: candidate.label,
			description: candidate.fsPath,
		})),
	];

	const selection = await vscode.window.showQuickPick(items, {
		placeHolder: messages.file.templatePickPlaceholder,
	});
	if (!selection) {
		return null;
	}
	if (selection.label === messages.file.templateNone) {
		return undefined;
	}

	const selected = templates.find((candidate) => candidate.label === selection.label);
	if (!selected) {
		return null;
	}
	return readTemplateContents(selected.fsPath);
}

function isSamePath(sourcePath: string, targetPath: string): boolean {
	return path.resolve(sourcePath) === path.resolve(targetPath);
}
