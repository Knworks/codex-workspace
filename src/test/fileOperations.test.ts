import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	createFile,
	createFolder,
	deletePath,
	renamePath,
} from '../services/fileOperations';

suite('File operations', () => {
	test('creates files and folders', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-'));
		try {
			const folderPath = createFolder(tempDir, 'docs');
			assert.ok(fs.existsSync(folderPath));

			const filePath = createFile(folderPath, 'note.md', 'hello');
			assert.ok(fs.existsSync(filePath));
			const contents = fs.readFileSync(filePath, 'utf8');
			assert.strictEqual(contents, 'hello');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('renames and deletes paths', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-'));
		try {
			const filePath = createFile(tempDir, 'note.md', 'hello');
			const renamedPath = path.join(tempDir, 'note2.md');
			renamePath(filePath, renamedPath);
			assert.ok(fs.existsSync(renamedPath));

			deletePath(renamedPath);
			assert.ok(!fs.existsSync(renamedPath));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
