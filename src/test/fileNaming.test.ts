import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	applyDefaultExtension,
	resolveUniqueName,
	sanitizeName,
} from '../services/fileNaming';

suite('File naming utilities', () => {
	test('sanitizeName replaces invalid characters', () => {
		const result = sanitizeName('a<>:\"/\\\\|?*b');
		assert.ok(!/[<>:"/\\|?*]/.test(result));
	});

	test('applyDefaultExtension appends .md when missing', () => {
		assert.strictEqual(applyDefaultExtension('note'), 'note.md');
		assert.strictEqual(applyDefaultExtension('note.txt'), 'note.txt');
	});

	test('resolveUniqueName appends counter when exists', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-naming-'));
		try {
			fs.writeFileSync(path.join(tempDir, 'sample.md'), 'a', 'utf8');
			const result = resolveUniqueName(tempDir, 'sample.md');
			assert.strictEqual(result, 'sample_1.md');
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
