import * as vscode from 'vscode';
import path from 'path';
import { CodexTreeDataProvider, WorkspaceStatusProvider } from './codexTreeProvider';
import { CodexTreeItem, FileViewKind } from '../models/treeItems';
import {
	resolveCodexPaths,
	TEMPLATE_FOLDER_NAME,
} from '../services/workspaceStatus';
import { FileEntry, listFileEntries } from '../services/fileTreeService';

const FILE_ICON_MAP: Record<string, string> = {
	'.md': 'markdown32.png',
	'.py': 'python32.png',
	'.txt': 'text32.png',
	'.xml': 'file_xml32.png',
	'.yaml': 'settingsfile32.png',
	'.yml': 'settingsfile32.png',
	'.toml': 'settingsfile32.png',
	'.png': 'image32.png',
	'.jpg': 'image32.png',
	'.jpeg': 'image32.png',
	'.bmp': 'image32.png',
	'.gif': 'image32.png',
	'.ico': 'image32.png',
	'.icon': 'image32.png',
	'.xls': 'office_excel32.png',
	'.xlsx': 'office_excel32.png',
	'.doc': 'office_word32.png',
	'.docx': 'office_word32.png',
	'.ppt': 'office_powerpoint32.png',
	'.pptx': 'office_powerpoint32.png',
	'.ps1': 'powershell32.png',
	'.js': 'script32.png',
	'.vbs': 'file_vb32.png',
	'.vb': 'file_vb32.png',
};

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
			return this.readDirectory(this.getRootPath());
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
			return undefined;
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
		const entries = this.listEntries(targetPath)
			.filter((entry) => !this.isHiddenName(entry.name))
			.sort((left, right) => {
				if (left.isDirectory !== right.isDirectory) {
					return left.isDirectory ? -1 : 1;
				}
				return left.name.localeCompare(right.name, undefined, {
					numeric: true,
					sensitivity: 'base',
				});
			});
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
		const iconFileName = FILE_ICON_MAP[extension] ?? 'unknown32.png';
		const iconPath = this.context.asAbsolutePath(path.join('images', iconFileName));
		const iconUri = vscode.Uri.file(iconPath);
		return { light: iconUri, dark: iconUri };
	}
}
