import * as assert from 'assert';
import * as vscode from 'vscode';
import { promptTextInputWithQuickPick } from '../services/textInputQuickPick';

type AcceptHandler = () => void;
type ChangeValueHandler = (value: string) => void;
type HideHandler = () => void;

class FakeQuickPick {
	value = '';
	title = '';
	placeholder: string | undefined;
	ignoreFocusOut = false;
	items: Array<vscode.QuickPickItem & { value: string }> = [];
	activeItems: Array<vscode.QuickPickItem & { value: string }> = [];
	selectedItems: Array<vscode.QuickPickItem & { value: string }> = [];
	matchOnDescription = false;
	matchOnDetail = false;
	sortByLabel = true;
	canSelectMany = false;
	busy = false;
	enabled = true;
	keepScrollPosition = false;
	step: number | undefined;
	totalSteps: number | undefined;
	valueSelection: [number, number] | undefined;
	buttons: readonly vscode.QuickInputButton[] = [];
	customButton = false;
	description: string | undefined;
	detail: string | undefined;
	ignoreFocusOutDefault = false;
	titleButtons: readonly vscode.QuickInputButton[] = [];

	private readonly acceptHandlers: AcceptHandler[] = [];
	private readonly changeHandlers: ChangeValueHandler[] = [];
	private readonly hideHandlers: HideHandler[] = [];
	private showHook: (() => void) | undefined;

	show(): void {
		this.showHook?.();
	}

	hide(): void {
		for (const handler of this.hideHandlers) {
			handler();
		}
	}

	dispose(): void {
		// no-op
	}

	onDidAccept(handler: AcceptHandler): vscode.Disposable {
		this.acceptHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeValue(handler: ChangeValueHandler): vscode.Disposable {
		this.changeHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidHide(handler: HideHandler): vscode.Disposable {
		this.hideHandlers.push(handler);
		return new vscode.Disposable(() => undefined);
	}

	onDidTriggerButton(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidTriggerItemButton(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeActive(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	onDidChangeSelection(): vscode.Disposable {
		return new vscode.Disposable(() => undefined);
	}

	setShowHook(handler: () => void): void {
		this.showHook = handler;
	}

	triggerValueChange(value: string): void {
		this.value = value;
		for (const handler of this.changeHandlers) {
			handler(value);
		}
	}

	triggerAccept(): void {
		for (const handler of this.acceptHandlers) {
			handler();
		}
	}
}

suite('Text input quick pick', () => {
	test('shows a preview candidate and returns the accepted raw value', async () => {
		const originalCreateQuickPick = vscode.window.createQuickPick;
		const fakeQuickPick = new FakeQuickPick();
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			() => fakeQuickPick as unknown as vscode.QuickPick<any>;

		fakeQuickPick.setShowHook(() => {
			fakeQuickPick.triggerValueChange('  sample skill  ');
			assert.strictEqual(fakeQuickPick.items.length, 1);
			assert.strictEqual(fakeQuickPick.items[0]?.label, 'sample-skill.md');
			fakeQuickPick.triggerAccept();
		});

		try {
			const value = await promptTextInputWithQuickPick({
				title: 'Enter name',
				resolvePreviewValue: (rawValue) => rawValue.trim().replace(/\s+/g, '-').concat('.md'),
			});
			assert.strictEqual(value, '  sample skill  ');
		} finally {
			(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
				originalCreateQuickPick;
		}
	});

	test('returns undefined when the quick pick is closed without accepting', async () => {
		const originalCreateQuickPick = vscode.window.createQuickPick;
		const fakeQuickPick = new FakeQuickPick();
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			() => fakeQuickPick as unknown as vscode.QuickPick<any>;

		fakeQuickPick.setShowHook(() => {
			fakeQuickPick.hide();
		});

		try {
			const value = await promptTextInputWithQuickPick({
				title: 'Enter name',
			});
			assert.strictEqual(value, undefined);
		} finally {
			(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
				originalCreateQuickPick;
		}
	});

	test('can return the preview value when resolveValue maps empty input', async () => {
		const originalCreateQuickPick = vscode.window.createQuickPick;
		const fakeQuickPick = new FakeQuickPick();
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			() => fakeQuickPick as unknown as vscode.QuickPick<any>;

		fakeQuickPick.setShowHook(() => {
			fakeQuickPick.triggerValueChange('');
			assert.strictEqual(fakeQuickPick.items[0]?.label, 'SKILL.md');
			fakeQuickPick.triggerAccept();
		});

		try {
			const value = await promptTextInputWithQuickPick({
				title: 'Enter name',
				resolvePreviewValue: () => 'SKILL.md',
				resolveValue: (rawValue, previewValue) => rawValue.trim() ? rawValue : previewValue,
			});
			assert.strictEqual(value, 'SKILL.md');
		} finally {
			(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
				originalCreateQuickPick;
		}
	});

	test('keeps suggestion items and appends a custom candidate for unmatched input', async () => {
		const originalCreateQuickPick = vscode.window.createQuickPick;
		const fakeQuickPick = new FakeQuickPick();
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			() => fakeQuickPick as unknown as vscode.QuickPick<any>;

		fakeQuickPick.setShowHook(() => {
			fakeQuickPick.triggerValueChange('custom-folder');
			assert.deepStrictEqual(
				fakeQuickPick.items.map((item) => item.label),
				['references/', 'scripts/', 'assets/', 'custom-folder/'],
			);
			fakeQuickPick.activeItems = [fakeQuickPick.items[3]!];
			fakeQuickPick.triggerAccept();
		});

		try {
			const value = await promptTextInputWithQuickPick({
				title: 'Enter folder name',
				suggestions: [
					{ label: 'references/', value: 'references' },
					{ label: 'scripts/', value: 'scripts' },
					{ label: 'assets/', value: 'assets' },
				],
				resolvePreviewValue: (rawValue) => rawValue.trim(),
				resolveValue: (_rawValue, previewValue) => previewValue,
				formatLabel: (value) => `${value}/`,
			});
			assert.strictEqual(value, 'custom-folder');
		} finally {
			(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
				originalCreateQuickPick;
		}
	});

	test('returns an existing suggestion without duplicating it in the item list', async () => {
		const originalCreateQuickPick = vscode.window.createQuickPick;
		const fakeQuickPick = new FakeQuickPick();
		(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
			() => fakeQuickPick as unknown as vscode.QuickPick<any>;

		fakeQuickPick.setShowHook(() => {
			fakeQuickPick.triggerValueChange('scripts');
			assert.deepStrictEqual(
				fakeQuickPick.items.map((item) => item.label),
				['references/', 'scripts/', 'assets/'],
			);
			fakeQuickPick.activeItems = [fakeQuickPick.items[1]!];
			fakeQuickPick.triggerAccept();
		});

		try {
			const value = await promptTextInputWithQuickPick({
				title: 'Enter folder name',
				suggestions: [
					{ label: 'references/', value: 'references' },
					{ label: 'scripts/', value: 'scripts' },
					{ label: 'assets/', value: 'assets' },
				],
				resolvePreviewValue: (rawValue) => rawValue.trim(),
				resolveValue: (_rawValue, previewValue) => previewValue,
				formatLabel: (value) => `${value}/`,
			});
			assert.strictEqual(value, 'scripts');
		} finally {
			(vscode.window as unknown as { createQuickPick: typeof originalCreateQuickPick }).createQuickPick =
				originalCreateQuickPick;
		}
	});
});
