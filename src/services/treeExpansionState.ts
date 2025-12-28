import path from 'path';
import * as vscode from 'vscode';
import { CodexTreeItem, FileViewKind } from '../models/treeItems';

export class TreeExpansionState {
	private readonly expandedByKind = new Map<FileViewKind, Set<string>>();

	registerExpanded(kind: FileViewKind, item: CodexTreeItem): void {
		if (!item.fsPath || item.nodeType !== 'folder') {
			return;
		}
		this.getExpandedSet(kind).add(item.fsPath);
	}

	registerCollapsed(kind: FileViewKind, item: CodexTreeItem): void {
		if (!item.fsPath || item.nodeType !== 'folder') {
			return;
		}
		this.getExpandedSet(kind).delete(item.fsPath);
	}

	renamePaths(kind: FileViewKind, fromPath: string, toPath: string): void {
		const expanded = this.expandedByKind.get(kind);
		if (!expanded || expanded.size === 0) {
			return;
		}

		const updated = new Set<string>();
		for (const entry of expanded) {
			if (this.isSamePath(entry, fromPath)) {
				updated.add(toPath);
				continue;
			}
			if (this.isWithinPath(entry, fromPath)) {
				const relative = path.relative(fromPath, entry);
				updated.add(path.join(toPath, relative));
				continue;
			}
			updated.add(entry);
		}

		this.expandedByKind.set(kind, updated);
	}

	async restore(
		kind: FileViewKind,
		views: Record<FileViewKind, vscode.TreeView<CodexTreeItem>>,
	): Promise<void> {
		const expanded = this.expandedByKind.get(kind);
		if (!expanded || expanded.size === 0) {
			return;
		}

		for (const targetPath of expanded) {
			const item = new CodexTreeItem(
				'folder',
				kind,
				path.basename(targetPath),
				vscode.TreeItemCollapsibleState.Collapsed,
				targetPath,
			);
			item.id = targetPath;
			try {
				await views[kind].reveal(item, {
					expand: true,
					focus: false,
					select: false,
				});
			} catch (error) {
				console.error(error);
			}
		}
	}

	listExpanded(kind: FileViewKind): string[] {
		return Array.from(this.expandedByKind.get(kind) ?? []);
	}

	private getExpandedSet(kind: FileViewKind): Set<string> {
		const existing = this.expandedByKind.get(kind);
		if (existing) {
			return existing;
		}
		const created = new Set<string>();
		this.expandedByKind.set(kind, created);
		return created;
	}

	private normalize(fsPath: string): string {
		const resolved = path.resolve(fsPath);
		return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
	}

	private isSamePath(left: string, right: string): boolean {
		return this.normalize(left) === this.normalize(right);
	}

	private isWithinPath(childPath: string, parentPath: string): boolean {
		const normalizedChild = this.normalize(childPath);
		const normalizedParent = this.normalize(parentPath);
		if (normalizedChild === normalizedParent) {
			return true;
		}
		const relative = path.relative(normalizedParent, normalizedChild);
		return (
			relative !== '' &&
			!relative.startsWith('..') &&
			!path.isAbsolute(relative)
		);
	}
}
