import { FileViewKind } from '../models/treeItems';

export class ViewFocusState {
	private activeKind?: FileViewKind;
	private selectionActive = false;

	setActive(kind: FileViewKind, hasSelection: boolean): void {
		this.activeKind = kind;
		this.selectionActive = hasSelection;
	}

	clear(): void {
		this.activeKind = undefined;
		this.selectionActive = false;
	}

	isActive(kind: FileViewKind): boolean {
		return this.activeKind === kind;
	}

	hasSelection(kind: FileViewKind): boolean {
		return this.activeKind === kind && this.selectionActive;
	}

	getActiveKind(): FileViewKind | undefined {
		return this.activeKind;
	}
}
