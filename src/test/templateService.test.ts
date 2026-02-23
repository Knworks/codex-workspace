import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTemplateRootPath, listTemplateCandidates } from '../services/templateService';

suite('Template service', () => {
	test('lists non-hidden template files recursively', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-template-'));
		try {
			const root = path.join(tempDir, 'codex-templates');
			const nestedDir = path.join(root, 'nested');
			fs.mkdirSync(nestedDir, { recursive: true });
			fs.writeFileSync(path.join(root, 'a.md'), 'a', 'utf8');
			fs.writeFileSync(path.join(root, '.hidden.md'), 'x', 'utf8');
			fs.writeFileSync(path.join(nestedDir, 'b.md'), 'b', 'utf8');

			const candidates = listTemplateCandidates(root);
			const labels = candidates.map((candidate) => candidate.label);
			assert.ok(labels.includes('a.md'));
			assert.ok(labels.includes(path.join('nested', 'b.md')));
			assert.ok(!labels.includes('.hidden.md'));
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('uses .codex/codex-templates as template root path', () => {
		const homeDir = path.join('home', 'tester');
		const rootPath = getTemplateRootPath(homeDir);
		assert.strictEqual(rootPath, path.join(homeDir, '.codex', 'codex-templates'));
		assert.ok(!rootPath.includes(path.join('.codex', '.codex-workspace')));
	});
});
