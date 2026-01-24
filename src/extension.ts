// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { ensureSelection } from './services/selectionGuard';
import {
	getWorkspaceStatus,
	resolveCodexPaths,
	TEMPLATE_FOLDER_NAME,
} from './services/workspaceStatus';
import { CodexTreeItem } from './models/treeItems';
import { registerFileCommands } from './commands/fileCommands';
import { CoreExplorerProvider } from './views/coreExplorerProvider';
import { FileExplorerProvider } from './views/fileExplorerProvider';
import { McpExplorerProvider } from './views/mcpExplorerProvider';
import { toggleMcpServer } from './services/mcpService';
import { messages } from './i18n';
import { runSafely } from './services/errorHandling';
import { SelectionContext } from './services/selectionContext';
import { TreeExpansionState } from './services/treeExpansionState';
import { ViewFocusState } from './services/viewFocusState';
import { getSyncSettings } from './services/settings';
import {
	syncCoreFilesBidirectional,
	syncDirectoryBidirectional,
} from './services/syncService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const coreProvider = new CoreExplorerProvider(context);
	const promptsProvider = new FileExplorerProvider('prompts', context);
	const skillsProvider = new FileExplorerProvider('skills', context);
	const templatesProvider = new FileExplorerProvider('templates', context);
	const mcpProvider = new McpExplorerProvider(context);
	const selectionContext = new SelectionContext();
	const expansionState = new TreeExpansionState();
	const viewFocusState = new ViewFocusState();

	const coreView = vscode.window.createTreeView('codex-workspace.core', {
		treeDataProvider: coreProvider,
	});
	const promptsView = vscode.window.createTreeView('codex-workspace.prompts', {
		treeDataProvider: promptsProvider,
	});
	const skillsView = vscode.window.createTreeView('codex-workspace.skills', {
		treeDataProvider: skillsProvider,
	});
	const templatesView = vscode.window.createTreeView(
		'codex-workspace.templates',
		{
			treeDataProvider: templatesProvider,
		},
	);
	const mcpView = vscode.window.createTreeView('codex-workspace.mcp', {
		treeDataProvider: mcpProvider,
	});

	const trackExpansion = (
		kind: 'prompts' | 'skills' | 'templates',
		view: vscode.TreeView<CodexTreeItem>,
	) => [
		view.onDidExpandElement((event) =>
			expansionState.registerExpanded(kind, event.element),
		),
		view.onDidCollapseElement((event) =>
			expansionState.registerCollapsed(kind, event.element),
		),
	];

	const trackSelection = (
		view: vscode.TreeView<CodexTreeItem>,
		kind?: 'prompts' | 'skills' | 'templates',
	) =>
		view.onDidChangeSelection((event) => {
			selectionContext.setSelection(event.selection[0]);
			if (kind) {
				viewFocusState.setActive(kind, event.selection.length > 0);
				return;
			}
			viewFocusState.clear();
		});

	context.subscriptions.push(
		coreView,
		promptsView,
		skillsView,
		templatesView,
		mcpView,
		trackSelection(coreView),
		trackSelection(promptsView, 'prompts'),
		trackSelection(skillsView, 'skills'),
		trackSelection(templatesView, 'templates'),
		trackSelection(mcpView),
		...trackExpansion('prompts', promptsView),
		...trackExpansion('skills', skillsView),
		...trackExpansion('templates', templatesView),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			viewFocusState.clear();
		}),
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codex-workspace" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const helloWorldDisposable = vscode.commands.registerCommand(
		'codex-workspace.helloWorld',
		(item?: vscode.TreeItem) =>
			runSafely(() => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				if (!ensureSelection(item)) {
					return;
				}
				// The code you place here will be executed every time your command is executed
				// Display a message box to the user
				vscode.window.showInformationMessage(messages.helloWorld);
			}),
	);

	const openFileDisposable = vscode.commands.registerCommand(
		'codex-workspace.openFile',
		(item?: CodexTreeItem) =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				if (!ensureSelection(item) || !item.fsPath) {
					return;
				}
				const target = vscode.Uri.file(item.fsPath);
				await vscode.commands.executeCommand('vscode.open', target);
			}),
	);

	const revealFolder = async (targetDir: string): Promise<void> => {
		if (!fs.existsSync(targetDir)) {
			vscode.window.showErrorMessage(messages.openFolderMissing);
			return;
		}
		await vscode.env.openExternal(vscode.Uri.file(targetDir));
	};

	const openCodexFolderDisposable = vscode.commands.registerCommand(
		'codex-workspace.openCodexFolder',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				await revealFolder(codexDir);
			}),
	);

	const openPromptsFolderDisposable = vscode.commands.registerCommand(
		'codex-workspace.openPromptsFolder',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				await revealFolder(path.join(codexDir, 'prompts'));
			}),
	);

	const openSkillsFolderDisposable = vscode.commands.registerCommand(
		'codex-workspace.openSkillsFolder',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				await revealFolder(path.join(codexDir, 'skills'));
			}),
	);

	const openTemplatesFolderDisposable = vscode.commands.registerCommand(
		'codex-workspace.openTemplatesFolder',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				await revealFolder(path.join(codexDir, TEMPLATE_FOLDER_NAME));
			}),
	);

	const confirmSync = async (targetDir: string): Promise<boolean> => {
		const message = messages.syncConfirm(targetDir);
		const choice = await vscode.window.showWarningMessage(
			message,
			{ modal: true },
			'OK',
		);
		return choice === 'OK';
	};

	const syncCoreDisposable = vscode.commands.registerCommand(
		'codex-workspace.syncCore',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexFolder } = getSyncSettings();
				if (!codexFolder) {
					return;
				}
				if (!(await confirmSync(codexFolder))) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				const result = syncCoreFilesBidirectional(codexDir, codexFolder);
				if (result.skipped.length > 0) {
					vscode.window.showWarningMessage(
						messages.syncSkipped(result.skipped.length),
					);
				}
				coreProvider.refresh();
			}),
	);

	const syncPromptsDisposable = vscode.commands.registerCommand(
		'codex-workspace.syncPrompts',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { promptsFolder } = getSyncSettings();
				if (!promptsFolder) {
					return;
				}
				if (!(await confirmSync(promptsFolder))) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				const result = syncDirectoryBidirectional(
					'prompts',
					codexDir,
					path.join(codexDir, 'prompts'),
					promptsFolder,
				);
				if (result.skipped.length > 0) {
					vscode.window.showWarningMessage(
						messages.syncSkipped(result.skipped.length),
					);
				}
				promptsProvider.refresh();
			}),
	);

	const syncSkillsDisposable = vscode.commands.registerCommand(
		'codex-workspace.syncSkills',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { skillsFolder } = getSyncSettings();
				if (!skillsFolder) {
					return;
				}
				if (!(await confirmSync(skillsFolder))) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				const result = syncDirectoryBidirectional(
					'skills',
					codexDir,
					path.join(codexDir, 'skills'),
					skillsFolder,
				);
				if (result.skipped.length > 0) {
					vscode.window.showWarningMessage(
						messages.syncSkipped(result.skipped.length),
					);
				}
				skillsProvider.refresh();
			}),
	);

	const syncTemplatesDisposable = vscode.commands.registerCommand(
		'codex-workspace.syncTemplates',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { templatesFolder } = getSyncSettings();
				if (!templatesFolder) {
					return;
				}
				if (!(await confirmSync(templatesFolder))) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				const result = syncDirectoryBidirectional(
					'templates',
					codexDir,
					path.join(codexDir, TEMPLATE_FOLDER_NAME),
					templatesFolder,
				);
				if (result.skipped.length > 0) {
					vscode.window.showWarningMessage(
						messages.syncSkipped(result.skipped.length),
					);
				}
				templatesProvider.refresh();
			}),
	);

	const refreshDisposable = vscode.commands.registerCommand(
		'codex-workspace.refreshAll',
		() =>
			runSafely(() => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				coreProvider.refresh();
				promptsProvider.refresh();
				skillsProvider.refresh();
				templatesProvider.refresh();
				mcpProvider.refresh();
			}),
	);

	const toggleMcpDisposable = vscode.commands.registerCommand(
		'codex-workspace.mcp.toggle',
		(serverId?: string) =>
			runSafely(() => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				if (!serverId) {
					ensureSelection(undefined);
					return;
				}
				const configPath = resolveCodexPaths().configPath;
				if (toggleMcpServer(configPath, serverId)) {
					vscode.window.showInformationMessage(
						messages.mcpToggleUpdated,
					);
					mcpProvider.refresh();
				}
			}),
	);

	context.subscriptions.push(
		helloWorldDisposable,
		openFileDisposable,
		openCodexFolderDisposable,
		openPromptsFolderDisposable,
		openSkillsFolderDisposable,
		openTemplatesFolderDisposable,
		syncCoreDisposable,
		syncPromptsDisposable,
		syncSkillsDisposable,
		syncTemplatesDisposable,
		refreshDisposable,
		toggleMcpDisposable,
	);

	registerFileCommands(context, {
		getSelection: () => selectionContext.getSelection(),
		providers: {
			prompts: promptsProvider,
			skills: skillsProvider,
			templates: templatesProvider,
		},
		views: {
			prompts: promptsView,
			skills: skillsView,
			templates: templatesView,
		},
		expansionState,
		viewFocusState,
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}
