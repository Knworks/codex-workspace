import * as vscode from 'vscode';

type InputQuickPickItem = vscode.QuickPickItem & {
	value: string;
};

export type TextInputQuickPickOptions = {
	title: string;
	placeholder?: string;
	initialValue?: string;
	ignoreFocusOut?: boolean;
	resolvePreviewValue?: (value: string) => string;
	resolveValue?: (rawValue: string, previewValue: string) => string;
	formatLabel?: (value: string) => string;
	description?: string;
};

export async function promptTextInputWithQuickPick(
	options: TextInputQuickPickOptions,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		const quickPick = vscode.window.createQuickPick<InputQuickPickItem>();
		quickPick.title = options.title;
		quickPick.placeholder = options.placeholder;
		quickPick.value = options.initialValue ?? '';
		quickPick.ignoreFocusOut = options.ignoreFocusOut ?? true;
		let settled = false;

		const updateItems = (): InputQuickPickItem[] => {
			const rawValue = quickPick.value;
			const previewValue = options.resolvePreviewValue
				? options.resolvePreviewValue(rawValue)
				: rawValue.trim();
			const items = previewValue
				? [
						{
							label: options.formatLabel
								? options.formatLabel(previewValue)
								: previewValue,
							description: options.description,
							value: options.resolveValue
								? options.resolveValue(rawValue, previewValue)
								: rawValue,
						},
					]
				: [];
			quickPick.items = items;
			if (items.length > 0) {
				quickPick.activeItems = [items[0]];
			}
			return items;
		};

		const finish = (value: string | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			quickPick.hide();
			quickPick.dispose();
			resolve(value);
		};

		quickPick.onDidAccept(() => {
			const activeItem = quickPick.activeItems[0];
			const selectedItem = quickPick.selectedItems[0];
			finish(activeItem?.value ?? selectedItem?.value ?? quickPick.value);
		});
		quickPick.onDidChangeValue(() => {
			updateItems();
		});
		quickPick.onDidHide(() => finish(undefined));
		updateItems();
		quickPick.show();
	});
}
