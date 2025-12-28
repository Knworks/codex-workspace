import * as assert from 'assert';
import path from 'path';
import { shouldDeleteRenameTarget } from '../commands/fileCommands';

suite('File commands', () => {
	test('does not delete when source and target are identical', () => {
		const sourcePath = path.join('root', 'AGENTS.md');
		assert.strictEqual(shouldDeleteRenameTarget(sourcePath, sourcePath), false);
	});

	test('detects case-only rename overwrite behavior', () => {
		const sourcePath = path.join('root', 'AGENTS.md');
		const targetPath = path.join('root', 'agents.md');
		const expected = process.platform === 'win32';
		assert.strictEqual(shouldDeleteRenameTarget(sourcePath, targetPath), !expected);
	});
});
