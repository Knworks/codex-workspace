import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem } from '../models/treeItems';
import { ensureSelection } from '../services/selectionGuard';
import { getWorkspaceStatus, resolveCodexPaths } from '../services/workspaceStatus';
import { messages } from '../i18n';
import { runSafely } from '../services/errorHandling';
import { sanitizeName } from '../services/fileNaming';
import {
	listTemplateCandidates,
	readTemplateContents,
} from '../services/templateService';
import {
	appendAgentConfigRawBlock,
	appendAgentConfigBlock,
	extractAgentConfigBlock,
	getAgentDescription,
	hasAgentConfigBlock,
	upsertAgentConfigBlock,
} from '../services/agentConfigService';
import {
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from '../services/disabledAgentsStore';
import { AgentExplorerProvider } from '../views/agentExplorerProvider';
import { removeSyncStateEntry } from '../services/syncService';

type AgentCommandContext = {
	getSelection: () => CodexTreeItem | undefined;
	agentProvider: AgentExplorerProvider;
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
					await editAgent(selection.fsPath, agentProvider);
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
					await deleteAgent(selection.fsPath, agentProvider);
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
					await enableAgent(selection.fsPath, agentProvider);
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
					await disableAgent(selection.fsPath, agentProvider);
				}),
		),
	);

	context.subscriptions.push(...disposables);
	return disposables;
}

async function addAgent(agentProvider: AgentExplorerProvider): Promise<void> {
	const { codexDir, configPath } = resolveCodexPaths();
	const agentsDir = path.join(codexDir, 'agents');
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

	fs.mkdirSync(agentsDir, { recursive: true });
	const agentFilePath = path.join(agentsDir, `${agentName}.toml`);
	if (fs.existsSync(agentFilePath)) {
		vscode.window.showWarningMessage(messages.agent.fileExists(agentName));
		return;
	}

	fs.writeFileSync(agentFilePath, templateContent, 'utf8');

	const configContents = fs.readFileSync(configPath, 'utf8');
	const appendResult = appendAgentConfigBlock(configContents, agentName, description);
	if (!appendResult.appended) {
		vscode.window.showWarningMessage(messages.agent.configExists(agentName));
		agentProvider.refresh();
		return;
	}

	fs.writeFileSync(configPath, appendResult.contents, 'utf8');
	agentProvider.refresh();
}

async function editAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
): Promise<void> {
	const { configPath } = resolveCodexPaths();
	const currentName = path.basename(agentFilePath, path.extname(agentFilePath));
	const configContents = fs.readFileSync(configPath, 'utf8');
	const currentDescription = getAgentDescription(configContents, currentName) ?? '';

	const nextName = await promptAgentName(currentName);
	if (!nextName) {
		return;
	}
	const nextDescription = await promptAgentDescription(currentDescription);
	if (nextDescription === undefined) {
		return;
	}

	const nextFilePath = path.join(path.dirname(agentFilePath), `${nextName}.toml`);
	if (
		!isSamePath(agentFilePath, nextFilePath) &&
		fs.existsSync(nextFilePath)
	) {
		vscode.window.showWarningMessage(messages.agent.fileExists(nextName));
		return;
	}
	if (
		currentName !== nextName &&
		hasAgentConfigBlock(configContents, nextName)
	) {
		vscode.window.showWarningMessage(messages.agent.configExists(nextName));
		return;
	}

	if (!isSamePath(agentFilePath, nextFilePath)) {
		fs.renameSync(agentFilePath, nextFilePath);
	}

	const updatedConfig = upsertAgentConfigBlock(
		configContents,
		currentName,
		nextName,
		nextDescription,
	);
	fs.writeFileSync(configPath, updatedConfig, 'utf8');
	agentProvider.refresh();
}

async function deleteAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
): Promise<void> {
	const { codexDir, configPath } = resolveCodexPaths();
	const agentId = path.basename(agentFilePath, path.extname(agentFilePath));
	const storePath = getDisabledAgentsStorePath(codexDir);
	const choice = await vscode.window.showWarningMessage(
		messages.agent.deleteConfirm(path.basename(agentFilePath)),
		{ modal: true },
		'OK',
	);
	if (choice !== 'OK') {
		return;
	}
	fs.rmSync(agentFilePath, { force: true });

	const configContents = fs.readFileSync(configPath, 'utf8');
	const extracted = extractAgentConfigBlock(configContents, agentId);
	if (extracted.removed) {
		fs.writeFileSync(configPath, extracted.contents, 'utf8');
	}

	// Delete stale disabled backup to avoid resurrecting deleted agents.
	takeDisabledAgentBlock(storePath, agentId);
	removeSyncStateEntry(codexDir, 'agents', `${agentId}.toml`);
	agentProvider.refresh();
}

async function enableAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
): Promise<void> {
	const { codexDir, configPath } = resolveCodexPaths();
	const storePath = getDisabledAgentsStorePath(codexDir);
	const agentId = path.basename(agentFilePath, path.extname(agentFilePath));
	const configContents = fs.readFileSync(configPath, 'utf8');
	if (hasAgentConfigBlock(configContents, agentId)) {
		vscode.window.showWarningMessage(messages.agent.configExists(agentId));
		return;
	}

	const stashedBlock = takeDisabledAgentBlock(storePath, agentId);
	const nextContents = stashedBlock
		? appendAgentConfigRawBlock(configContents, stashedBlock)
		: appendAgentConfigBlock(configContents, agentId, '').contents;
	fs.writeFileSync(configPath, nextContents, 'utf8');
	vscode.window.showInformationMessage(messages.agent.toggleUpdated);
	agentProvider.refresh();
}

async function disableAgent(
	agentFilePath: string,
	agentProvider: AgentExplorerProvider,
): Promise<void> {
	const { codexDir, configPath } = resolveCodexPaths();
	const storePath = getDisabledAgentsStorePath(codexDir);
	const agentId = path.basename(agentFilePath, path.extname(agentFilePath));
	const configContents = fs.readFileSync(configPath, 'utf8');
	const extracted = extractAgentConfigBlock(configContents, agentId);
	if (!extracted.removed || !extracted.block) {
		vscode.window.showWarningMessage(messages.agent.notEnabled(agentId));
		return;
	}

	fs.writeFileSync(configPath, extracted.contents, 'utf8');
	saveDisabledAgentBlock(storePath, agentId, extracted.block);
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
	const value = await vscode.window.showInputBox({
		prompt: messages.agent.inputName,
		value: defaultValue,
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

async function pickTemplateContents(): Promise<string | null> {
	const templates = listTemplateCandidates();
	if (templates.length === 0) {
		return '';
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
		return '';
	}

	const selected = templates.find((candidate) => candidate.label === selection.label);
	if (!selected) {
		return '';
	}
	return readTemplateContents(selected.fsPath);
}

function isSamePath(sourcePath: string, targetPath: string): boolean {
	return path.resolve(sourcePath) === path.resolve(targetPath);
}
