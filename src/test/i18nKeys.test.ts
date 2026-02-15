import * as assert from 'assert';
import fs from 'fs';
import path from 'path';

suite('Localization keys', () => {
	test('runtime message keys exist in localization files', () => {
		const base = path.resolve(__dirname, '..', '..');
		const nlsPath = path.join(base, 'package.nls.json');
		const nlsJaPath = path.join(base, 'package.nls.ja.json');
		const nls = JSON.parse(fs.readFileSync(nlsPath, 'utf8')) as Record<
			string,
			string
		>;
		const nlsJa = JSON.parse(fs.readFileSync(nlsJaPath, 'utf8')) as Record<
			string,
			string
		>;

		const keys = [
			'message.selectionRequired',
			'message.unavailablePrefix',
			'message.unavailableUnknown',
			'message.reason.codexMissing',
			'message.reason.configMissing',
			'message.reason.configUnreadable',
			'message.reason.configInvalid',
			'message.openFolderMissing',
			'message.unexpectedError',
			'message.mcpToggleUpdated',
			'message.syncConfirm',
			'message.syncSkipped',
			'message.historyPanelTitle',
			'message.historyPanelPlaceholder',
			'message.inputFileName',
			'message.inputFolderName',
			'message.inputRenameName',
			'message.invalidName',
			'message.renameRootNotAllowed',
			'message.renameFolderExists',
			'message.deleteFileConfirm',
			'message.deleteFolderConfirm',
			'message.deleteRootNotAllowed',
			'message.overwriteFileConfirm',
			'message.overwrite',
			'message.fileExistsUseDifferentName',
			'message.useDifferentName',
			'message.cancel',
			'message.templateNone',
			'message.templatePickPlaceholder',
			'message.selectionNotSupported',
			'message.helloWorld',
		];

		for (const key of keys) {
			assert.ok(nls[key]);
			assert.ok(nlsJa[key]);
		}
	});
});
