import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { CodexTreeItem, FileViewKind } from '../models/treeItems';
import {
	resolveCodexPaths,
	TEMPLATE_FOLDER_NAME,
} from '../services/workspaceStatus';
import { FileEntry, listFileEntries } from '../services/fileTreeService';

export class FileExplorerProvider extends CodexTreeDataProvider<CodexTreeItem> {
	private readonly kind: FileViewKind;
	private readonly context: vscode.ExtensionContext;
	private readonly rootPathOverride?: string;
	private readonly listEntries: (targetPath: string) => FileEntry[];

	constructor(
		kind: FileViewKind,
		context: vscode.ExtensionContext,
		statusProvider?: WorkspaceStatusProvider,
		rootPathOverride?: string,
		listEntries?: (targetPath: string) => FileEntry[],
	) {
		super(statusProvider);
		this.kind = kind;
		this.context = context;
		this.rootPathOverride = rootPathOverride;
		this.listEntries = listEntries ?? listFileEntries;
	}

	getRootPath(): string {
		if (this.rootPathOverride) {
			return this.rootPathOverride;
		}
		if (this.kind === 'templates') {
			return path.join(resolveCodexPaths().codexDir, TEMPLATE_FOLDER_NAME);
		}
		return path.join(resolveCodexPaths().codexDir, this.kind);
	}

	protected getAvailableChildren(element?: CodexTreeItem): vscode.ProviderResult<CodexTreeItem[]> {
		if (!element) {
			const rootPath = this.getRootPath();
			const rootItem = new CodexTreeItem(
				'root',
				this.kind,
				path.basename(rootPath),
				vscode.TreeItemCollapsibleState.Expanded,
				rootPath,
			);
			rootItem.id = rootItem.fsPath ?? this.kind;
			rootItem.contextValue = 'codex-root';
			rootItem.iconPath = this.getFolderIcon();
			return [rootItem];
		}

		if (element.nodeType === 'root' || element.nodeType === 'folder') {
			return this.readDirectory(element.fsPath ?? '');
		}

		return [];
	}

	getParent(element: CodexTreeItem): vscode.ProviderResult<CodexTreeItem> {
		if (!element.fsPath) {
			return undefined;
		}
		if (element.nodeType === 'root') {
			return undefined;
		}

		const parentPath = path.dirname(element.fsPath);
		if (!parentPath || parentPath === element.fsPath) {
			return undefined;
		}

		const rootPath = this.getRootPath();
		if (parentPath === rootPath) {
			const rootItem = new CodexTreeItem(
				'root',
				this.kind,
				path.basename(rootPath),
				vscode.TreeItemCollapsibleState.Expanded,
				rootPath,
			);
			rootItem.id = rootItem.fsPath ?? this.kind;
			rootItem.contextValue = 'codex-root';
			rootItem.iconPath = this.getFolderIcon();
			return rootItem;
		}

		const folderItem = new CodexTreeItem(
			'folder',
			this.kind,
			path.basename(parentPath),
			vscode.TreeItemCollapsibleState.Collapsed,
			parentPath,
		);
		folderItem.id = parentPath;
		folderItem.contextValue = 'codex-folder';
		folderItem.iconPath = this.getFolderIcon();
		return folderItem;
	}

	private readDirectory(targetPath: string): CodexTreeItem[] {
		const entries = this.listEntries(targetPath).filter(
			(entry) => !this.isHiddenName(entry.name),
		);
		return entries.map((entry) => {
			if (entry.isDirectory) {
				const folderItem = new CodexTreeItem(
					'folder',
					this.kind,
					entry.name,
					vscode.TreeItemCollapsibleState.Collapsed,
					entry.fullPath,
				);
				folderItem.id = entry.fullPath;
				folderItem.contextValue = 'codex-folder';
				folderItem.iconPath = this.getFolderIcon();
				return folderItem;
			}

			const fileItem = new CodexTreeItem(
				'file',
				this.kind,
				entry.name,
				vscode.TreeItemCollapsibleState.None,
				entry.fullPath,
			);
			fileItem.id = entry.fullPath;
			fileItem.contextValue = 'codex-file';
			fileItem.command = {
				command: 'codex-workspace.openFile',
				title: 'Open file',
				arguments: [fileItem],
			};
			fileItem.iconPath = this.getFileIcon(entry.name);
			return fileItem;
		});
	}

	private isHiddenName(name: string): boolean {
		return name.startsWith('.');
	}

	private getFolderIcon():
		| vscode.ThemeIcon
		| { light: vscode.Uri; dark: vscode.Uri }
		| undefined {
		const iconPath = this.context.asAbsolutePath(path.join('images', 'folder32.png'));
		const iconUri = vscode.Uri.file(iconPath);
		return { light: iconUri, dark: iconUri };
	}

	private getFileIcon(fileName: string):
		| vscode.ThemeIcon
		| { light: vscode.Uri; dark: vscode.Uri }
		| undefined {
		const extension = path.extname(fileName).toLowerCase();
		const iconFileName =
			extension === '.md'
				? 'markdown32.png'
				: extension === '.py'
					? 'python32.png'
					: 'text32.png';
		const iconPath = this.context.asAbsolutePath(path.join('images', iconFileName));
		const iconUri = vscode.Uri.file(iconPath);
		return { light: iconUri, dark: iconUri };
	}
}
