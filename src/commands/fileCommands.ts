import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeItem, FileViewKind } from '../models/treeItems';
import { ensureSelection } from '../services/selectionGuard';
import { getWorkspaceStatus } from '../services/workspaceStatus';
import { messages } from '../i18n';
import {
	createFile,
	createFolder,
	deletePath,
	ensureDirectoryExists,
	pathExists,
	renamePath,
} from '../services/fileOperations';
import {
	applyDefaultExtension,
	resolveUniqueName,
	sanitizeName,
} from '../services/fileNaming';
import {
	listTemplateCandidates,
	readTemplateContents,
} from '../services/templateService';
import { FileExplorerProvider } from '../views/fileExplorerProvider';
import { runSafely } from '../services/errorHandling';
import { expandParentFolder } from '../services/treeViewExpansion';

type FileCommandContext = {
	getSelection: () => CodexTreeItem | undefined;
	providers: Record<FileViewKind, FileExplorerProvider>;
	views: Record<FileViewKind, vscode.TreeView<CodexTreeItem>>;
};

export function registerFileCommands(
	context: vscode.ExtensionContext,
	config: FileCommandContext,
): vscode.Disposable[] {
	const { getSelection, providers, views } = config;
	const disposables: vscode.Disposable[] = [];
	const registerAddFileForView = (
		commandId: string,
		viewKind: FileViewKind,
	) => {
		disposables.push(
			vscode.commands.registerCommand(
				commandId,
				(item?: CodexTreeItem) =>
					runSafely(async () => {
						if (!ensureAvailable()) {
							return;
						}
						const provider = providers[viewKind];
						const selection = resolveSelectionForView(
							viewKind,
							item,
							getSelection(),
							provider.getRootPath(),
						);
						await addFileWithSelection(selection, provider, views);
					}),
			),
		);
	};

	const registerAddFolderForView = (
		commandId: string,
		viewKind: FileViewKind,
	) => {
		disposables.push(
			vscode.commands.registerCommand(
				commandId,
				(item?: CodexTreeItem) =>
					runSafely(async () => {
						if (!ensureAvailable()) {
							return;
						}
						const provider = providers[viewKind];
						const selection = resolveSelectionForView(
							viewKind,
							item,
							getSelection(),
							provider.getRootPath(),
						);
						await addFolderWithSelection(selection, provider, views);
					}),
			),
		);
	};

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.addFile',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					const selection = resolveSelection(item, getSelection);
					if (!ensureAvailable() || !ensureSelection(selection)) {
						return;
					}

					const provider = resolveProvider(selection, providers);
					if (!provider) {
						return;
					}

					await addFileWithSelection(selection, provider, views);
				}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.addFolder',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					const selection = resolveSelection(item, getSelection);
					if (!ensureAvailable() || !ensureSelection(selection)) {
						return;
					}

					const provider = resolveProvider(selection, providers);
					if (!provider) {
						return;
					}

					await addFolderWithSelection(selection, provider, views);
				}),
		),
	);

	registerAddFolderForView('codex-workspace.addPromptsFolder', 'prompts');
	registerAddFolderForView('codex-workspace.addSkillsFolder', 'skills');
	registerAddFolderForView('codex-workspace.addTemplatesFolder', 'templates');
	registerAddFileForView('codex-workspace.addPromptsFile', 'prompts');
	registerAddFileForView('codex-workspace.addSkillsFile', 'skills');
	registerAddFileForView('codex-workspace.addTemplatesFile', 'templates');

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.rename',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					const selection = resolveSelection(item, getSelection);
					if (
						!ensureAvailable() ||
						!ensureSelection(selection) ||
						!selection.fsPath
					) {
						return;
					}

					const provider = resolveProvider(selection, providers);
					if (!provider) {
						return;
					}
					if (isRootNode(selection)) {
						vscode.window.showErrorMessage(messages.file.renameRootNotAllowed);
						return;
					}

					const parentDir = path.dirname(selection.fsPath);
					const renameInput = await vscode.window.showInputBox({
						prompt: messages.file.inputRenameName,
						value: path.basename(selection.fsPath),
					});
					if (!renameInput) {
						return;
					}

					const normalizedName = sanitizeName(renameInput);
					if (!normalizedName) {
						vscode.window.showErrorMessage(messages.file.invalidName);
						return;
					}

					const targetPath = path.join(parentDir, normalizedName);
					if (pathExists(targetPath)) {
						if (selection.nodeType === 'folder') {
							vscode.window.showErrorMessage(messages.file.renameFolderExists);
							return;
						}

						const choice = await vscode.window.showQuickPick(
							[
								messages.file.overwrite,
								messages.file.useDifferentName,
								messages.file.cancel,
							],
							{ placeHolder: '' },
						);
						if (!choice || choice === messages.file.cancel) {
							return;
						}

						if (choice === messages.file.overwrite) {
							const confirmed = await confirmDialog(
								messages.file.overwriteFileConfirm,
								selection.fsPath,
							);
							if (!confirmed) {
								return;
							}
							deletePath(targetPath);
							renamePath(selection.fsPath, targetPath);
						} else if (choice === messages.file.useDifferentName) {
							const fallbackName = resolveUniqueName(parentDir, normalizedName);
							renamePath(selection.fsPath, path.join(parentDir, fallbackName));
						}
					} else {
						renamePath(selection.fsPath, targetPath);
					}

					provider.refresh();
				}),
		),
	);

	disposables.push(
		vscode.commands.registerCommand(
			'codex-workspace.delete',
			(item?: CodexTreeItem) =>
				runSafely(async () => {
					const selection = resolveSelection(item, getSelection);
					if (
						!ensureAvailable() ||
						!ensureSelection(selection) ||
						!selection.fsPath
					) {
						return;
					}

					const provider = resolveProvider(selection, providers);
					if (!provider) {
						return;
					}
					if (isRootNode(selection)) {
						vscode.window.showErrorMessage(messages.file.deleteRootNotAllowed);
						return;
					}

					const message =
						selection.nodeType === 'folder'
							? messages.file.deleteFolderConfirm
							: messages.file.deleteFileConfirm;
					const confirmed = await confirmDialog(message, selection.fsPath);
					if (!confirmed) {
						return;
					}
					deletePath(selection.fsPath);
					provider.refresh();
				}),
		),
	);

	context.subscriptions.push(...disposables);
	return disposables;
}

function ensureAvailable(): boolean {
	return getWorkspaceStatus().isAvailable;
}

export function isRootNode(item: CodexTreeItem): boolean {
	return item.nodeType === 'root';
}

const FILE_VIEW_KINDS: FileViewKind[] = ['prompts', 'skills', 'templates'];

function resolveSelection(
	item: CodexTreeItem | undefined,
	getSelection: () => CodexTreeItem | undefined,
): CodexTreeItem | undefined {
	return item ?? getSelection();
}

export function resolveSelectionForView(
	viewKind: FileViewKind,
	item: CodexTreeItem | undefined,
	selection: CodexTreeItem | undefined,
	rootPath: string,
): CodexTreeItem {
	if (item?.kind === viewKind) {
		return item;
	}
	if (selection?.kind === viewKind) {
		return selection;
	}
	return createRootItem(viewKind, rootPath);
}

function isFileViewKind(kind: string): kind is FileViewKind {
	return FILE_VIEW_KINDS.includes(kind as FileViewKind);
}

function resolveProvider(
	item: CodexTreeItem,
	providers: Record<FileViewKind, FileExplorerProvider>,
): FileExplorerProvider | null {
	if (!isFileViewKind(item.kind)) {
		vscode.window.showInformationMessage(
			messages.file.selectionNotSupported,
		);
		return null;
	}

	return providers[item.kind];
}

function resolveTargetDirectory(
	item: CodexTreeItem,
	provider: FileExplorerProvider,
): string | null {
	if (!item.fsPath) {
		return null;
	}

	if (item.nodeType === 'file') {
		ensureDirectoryExists(path.dirname(item.fsPath));
		return path.dirname(item.fsPath);
	}

	ensureDirectoryExists(item.fsPath);
	return item.fsPath || provider.getRootPath();
}

function createRootItem(viewKind: FileViewKind, rootPath: string): CodexTreeItem {
	const rootItem = new CodexTreeItem(
		'root',
		viewKind,
		path.basename(rootPath),
		vscode.TreeItemCollapsibleState.Collapsed,
		rootPath,
	);
	rootItem.id = rootPath;
	rootItem.contextValue = 'codex-root';
	return rootItem;
}

async function addFileWithSelection(
	selection: CodexTreeItem,
	provider: FileExplorerProvider,
	views: Record<FileViewKind, vscode.TreeView<CodexTreeItem>>,
): Promise<void> {
	const targetDir = resolveTargetDirectory(selection, provider);
	if (!targetDir) {
		return;
	}

	const fileNameInput = await vscode.window.showInputBox({
		prompt: messages.file.inputFileName,
	});
	if (!fileNameInput) {
		return;
	}

	const normalizedName = sanitizeName(fileNameInput);
	if (!normalizedName) {
		vscode.window.showErrorMessage(messages.file.invalidName);
		return;
	}

	const fileName = applyDefaultExtension(normalizedName);
	const resolvedName = resolveUniqueName(targetDir, fileName);
	const templateContent = await pickTemplateContents();
	if (templateContent === null) {
		return;
	}

	createFile(targetDir, resolvedName, templateContent);
	await expandParentFolder(selection, views);
	provider.refresh();
}

async function addFolderWithSelection(
	selection: CodexTreeItem,
	provider: FileExplorerProvider,
	views: Record<FileViewKind, vscode.TreeView<CodexTreeItem>>,
): Promise<void> {
	const targetDir = resolveTargetDirectory(selection, provider);
	if (!targetDir) {
		return;
	}

	const folderNameInput = await vscode.window.showInputBox({
		prompt: messages.file.inputFolderName,
	});
	if (!folderNameInput) {
		return;
	}

	const normalizedName = sanitizeName(folderNameInput);
	if (!normalizedName) {
		vscode.window.showErrorMessage(messages.file.invalidName);
		return;
	}

	const resolvedName = resolveUniqueName(targetDir, normalizedName);
	createFolder(targetDir, resolvedName);
	await expandParentFolder(selection, views);
	provider.refresh();
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

async function confirmDialog(message: string, targetPath: string): Promise<boolean> {
	const detail = `${message}\n${targetPath}`;
	const choice = await vscode.window.showWarningMessage(detail, { modal: true }, 'OK');
	return choice === 'OK';
}
