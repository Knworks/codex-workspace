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
import { TreeExpansionState } from '../services/treeExpansionState';
import { ViewFocusState } from '../services/viewFocusState';
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
	expansionState: TreeExpansionState;
	viewFocusState: ViewFocusState;
};

export function registerFileCommands(
	context: vscode.ExtensionContext,
	config: FileCommandContext,
): vscode.Disposable[] {
	const { getSelection, providers, views, expansionState, viewFocusState } = config;
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
						const viewSelection = views[viewKind].selection[0];
						const hasSelection =
							viewFocusState.isActive(viewKind) &&
							views[viewKind].selection.length > 0;
						const activeSelection = resolveAddViewSelection(
							hasSelection,
							item,
							viewSelection,
						);
						const selection = resolveSelectionForView(
							viewKind,
							activeSelection,
							activeSelection,
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
						const viewSelection = views[viewKind].selection[0];
						const hasSelection =
							viewFocusState.isActive(viewKind) &&
							views[viewKind].selection.length > 0;
						const activeSelection = resolveAddViewSelection(
							hasSelection,
							item,
							viewSelection,
						);
						const selection = resolveSelectionForView(
							viewKind,
							activeSelection,
							activeSelection,
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
					if (!ensureAvailable()) {
						return;
					}

					const activeKind = viewFocusState.getActiveKind();
					if (!item && activeKind) {
						const provider = providers[activeKind];
						const viewSelection = views[activeKind].selection[0];
						const hasSelection =
							viewFocusState.isActive(activeKind) &&
							views[activeKind].selection.length > 0;
						const activeSelection = resolveAddViewSelection(
							hasSelection,
							undefined,
							viewSelection,
						);
						const selection = resolveSelectionForView(
							activeKind,
							activeSelection,
							activeSelection,
							provider.getRootPath(),
						);
						await addFileWithSelection(selection, provider, views);
						return;
					}

					const selection = resolveSelection(item, getSelection);
					if (!ensureSelection(selection)) {
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
					if (!ensureAvailable()) {
						return;
					}

					const activeKind = viewFocusState.getActiveKind();
					if (!item && activeKind) {
						const provider = providers[activeKind];
						const viewSelection = views[activeKind].selection[0];
						const hasSelection =
							viewFocusState.isActive(activeKind) &&
							views[activeKind].selection.length > 0;
						const activeSelection = resolveAddViewSelection(
							hasSelection,
							undefined,
							viewSelection,
						);
						const selection = resolveSelectionForView(
							activeKind,
							activeSelection,
							activeSelection,
							provider.getRootPath(),
						);
						await addFolderWithSelection(selection, provider, views);
						return;
					}

					const selection = resolveSelection(item, getSelection);
					if (!ensureSelection(selection)) {
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
					const viewKind = selection.kind as FileViewKind;
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
					const targetExists = pathExists(targetPath);
					const caseOnlyRename = isCaseOnlyRename(selection.fsPath, targetPath);
					let renamedPath: string | null = null;

					if (targetExists && !caseOnlyRename) {
						if (selection.nodeType === 'folder') {
							vscode.window.showErrorMessage(messages.file.renameFolderExists);
							return;
						}

						const suggestedName = resolveUniqueName(parentDir, normalizedName);
						const suggestedPath = path.join(parentDir, suggestedName);
						const confirmed = await confirmUseNumberedName(
							normalizedName,
							suggestedName,
							suggestedPath,
						);
						if (!confirmed) {
							return;
						}

						renamePathSafely(selection.fsPath, suggestedPath);
						renamedPath = suggestedPath;
					} else if (!isSamePath(selection.fsPath, targetPath) || caseOnlyRename) {
						renamePathSafely(selection.fsPath, targetPath);
						renamedPath = targetPath;
					}

					if (renamedPath && selection.nodeType === 'folder') {
						expansionState.renamePaths(
							viewKind,
							selection.fsPath,
							renamedPath,
						);
					}

					provider.refresh();
					if (renamedPath && selection.nodeType === 'folder') {
						await expansionState.restore(viewKind, views);
					}
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

export function resolveAddViewSelection(
	hasSelection: boolean,
	item: CodexTreeItem | undefined,
	selection: CodexTreeItem | undefined,
): CodexTreeItem | undefined {
	if (!hasSelection) {
		return undefined;
	}
	return item ?? selection;
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
	const targetPath = path.join(targetDir, fileName);
	let resolvedName = fileName;
	if (pathExists(targetPath)) {
		const suggestedName = resolveUniqueName(targetDir, fileName);
		const suggestedPath = path.join(targetDir, suggestedName);
		const confirmed = await confirmUseNumberedName(
			fileName,
			suggestedName,
			suggestedPath,
		);
		if (!confirmed) {
			return;
		}
		resolvedName = suggestedName;
	}

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

	const targetPath = path.join(targetDir, normalizedName);
	if (pathExists(targetPath)) {
		vscode.window.showErrorMessage(messages.file.renameFolderExists);
		return;
	}

	createFolder(targetDir, normalizedName);
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

async function confirmUseNumberedName(
	originalName: string,
	suggestedName: string,
	targetPath: string,
): Promise<boolean> {
	const message = messages.file.fileExistsUseDifferentName(
		originalName,
		suggestedName,
	);
	const detail = `${message}
${targetPath}`;
	const choice = await vscode.window.showWarningMessage(
		detail,
		{ modal: true },
		'OK',
	);
	return choice === 'OK';
}


export function isSamePath(sourcePath: string, targetPath: string): boolean {
	return path.resolve(sourcePath) === path.resolve(targetPath);
}

export function shouldDeleteRenameTarget(
	sourcePath: string,
	targetPath: string,
): boolean {
	const resolvedSource = path.resolve(sourcePath);
	const resolvedTarget = path.resolve(targetPath);
	if (isSamePath(resolvedSource, resolvedTarget)) {
		return false;
	}
	if (process.platform === 'win32') {
		return resolvedSource.toLowerCase() !== resolvedTarget.toLowerCase();
	}
	return true;
}

function renamePathSafely(sourcePath: string, targetPath: string): void {
	if (!isCaseOnlyRename(sourcePath, targetPath)) {
		renamePath(sourcePath, targetPath);
		return;
	}

	const parentDir = path.dirname(sourcePath);
	const tempName = resolveUniqueName(
		parentDir,
		`${path.basename(sourcePath)}.__tmp__`,
	);
	const tempPath = path.join(parentDir, tempName);
	renamePath(sourcePath, tempPath);
	renamePath(tempPath, targetPath);
}

export function isCaseOnlyRename(
	sourcePath: string,
	targetPath: string,
): boolean {
	if (process.platform !== 'win32') {
		return false;
	}
	const resolvedSource = path.resolve(sourcePath);
	const resolvedTarget = path.resolve(targetPath);
	return (
		resolvedSource !== resolvedTarget &&
		resolvedSource.toLowerCase() === resolvedTarget.toLowerCase()
	);
}
