import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

export const messages = {
	selectionRequired: localize(
		'message.selectionRequired',
		'Please select a target.',
	),
	unavailablePrefix: localize(
		'message.unavailablePrefix',
		'? Unable to open Codex Workspace: ',
	),
	unavailableUnknown: localize(
		'message.unavailableUnknown',
		'Unknown reason.',
	),
	reasonCodexMissing: localize(
		'message.reason.codexMissing',
		'.codex does not exist.',
	),
	reasonConfigMissing: localize(
		'message.reason.configMissing',
		'config.toml does not exist.',
	),
	reasonConfigUnreadable: localize(
		'message.reason.configUnreadable',
		'config.toml cannot be read.',
	),
	reasonConfigInvalid: localize(
		'message.reason.configInvalid',
		'config.toml cannot be parsed.',
	),
	openFolderMissing: localize(
		'message.openFolderMissing',
		'Target folder does not exist.',
	),
	unexpectedError: localize(
		'message.unexpectedError',
		'An unexpected error occurred.',
	),
	mcpToggleUpdated: localize(
		'message.mcpToggleUpdated',
		'Settings updated. Please restart Codex to apply changes.',
	),
	helloWorld: localize(
		'message.helloWorld',
		'Hello World from Codex Workspace!',
	),
	file: {
		inputFileName: localize('message.inputFileName', 'Enter a file name.'),
		inputFolderName: localize(
			'message.inputFolderName',
			'Enter a folder name.',
		),
		inputRenameName: localize(
			'message.inputRenameName',
			'Enter a new name.',
		),
		invalidName: localize(
			'message.invalidName',
			'Please enter a valid name.',
		),
		renameRootNotAllowed: localize(
			'message.renameRootNotAllowed',
			'Root folders cannot be renamed.',
		),
		renameFolderExists: localize(
			'message.renameFolderExists',
			'A folder with the same name already exists.',
		),
		deleteFileConfirm: localize(
			'message.deleteFileConfirm',
			'Are you sure you want to delete this file?',
		),
		deleteFolderConfirm: localize(
			'message.deleteFolderConfirm',
			'Are you sure you want to delete this folder and its contents?',
		),
		overwriteFileConfirm: localize(
			'message.overwriteFileConfirm',
			'Overwrite the file? The existing file will be deleted.',
		),
		overwrite: localize('message.overwrite', 'Overwrite'),
		useDifferentName: localize(
			'message.useDifferentName',
			'Use a different name (_1)',
		),
		cancel: localize('message.cancel', 'Cancel'),
		templateNone: localize('message.templateNone', 'Empty file'),
		templatePickPlaceholder: localize(
			'message.templatePickPlaceholder',
			'Select a template.',
		),
		selectionNotSupported: localize(
			'message.selectionNotSupported',
			'Select a target in prompts, skills, or templates.',
		),
	},
};
