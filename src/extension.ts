// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import fs from 'fs';
import { ensureSelection } from './services/selectionGuard';
import { getWorkspaceStatus, resolveCodexPaths } from './services/workspaceStatus';
import { CodexTreeItem } from './models/treeItems';
import { registerFileCommands } from './commands/fileCommands';
import { CoreExplorerProvider } from './views/coreExplorerProvider';
import { FileExplorerProvider } from './views/fileExplorerProvider';
import { McpExplorerProvider } from './views/mcpExplorerProvider';
import { toggleMcpServer } from './services/mcpService';
import { messages } from './i18n';
import { runSafely } from './services/errorHandling';
import { SelectionContext } from './services/selectionContext';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const coreProvider = new CoreExplorerProvider();
	const promptsProvider = new FileExplorerProvider('prompts', context);
	const skillsProvider = new FileExplorerProvider('skills', context);
	const templatesProvider = new FileExplorerProvider('templates', context);
	const mcpProvider = new McpExplorerProvider(context);
	const selectionContext = new SelectionContext();

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

	const trackSelection = (view: vscode.TreeView<CodexTreeItem>) =>
		view.onDidChangeSelection((event) => {
			selectionContext.setSelection(event.selection[0]);
		});

	context.subscriptions.push(
		coreView,
		promptsView,
		skillsView,
		templatesView,
		mcpView,
		trackSelection(coreView),
		trackSelection(promptsView),
		trackSelection(skillsView),
		trackSelection(templatesView),
		trackSelection(mcpView),
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

	const openCodexFolderDisposable = vscode.commands.registerCommand(
		'codex-workspace.openCodexFolder',
		() =>
			runSafely(async () => {
				if (!getWorkspaceStatus().isAvailable) {
					return;
				}
				const { codexDir } = resolveCodexPaths();
				if (!fs.existsSync(codexDir)) {
					vscode.window.showErrorMessage(messages.openFolderMissing);
					return;
				}
				await vscode.commands.executeCommand(
					'revealFileInOS',
					vscode.Uri.file(codexDir),
				);
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
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}
