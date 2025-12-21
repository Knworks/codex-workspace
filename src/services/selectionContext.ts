import { CodexTreeItem } from '../models/treeItems';

export class SelectionContext {
	private current?: CodexTreeItem;

	setSelection(item?: CodexTreeItem): void {
		this.current = item;
	}

	getSelection(): CodexTreeItem | undefined {
		return this.current;
	}
}
