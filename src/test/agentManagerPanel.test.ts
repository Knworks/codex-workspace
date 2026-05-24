import * as assert from 'assert';
import fs from 'fs';
import path from 'path';

suite('Agent manager panel', () => {
	test('ready message does not trigger a full refresh loop', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'agentManagerPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes("if (message.type === 'ready') {"));
		assert.ok(source.includes('\t\t\treturn;'));
		assert.ok(source.includes("if (message.type === 'refresh') {"));
		assert.ok(!source.includes("if (message.type === 'refresh' || message.type === 'ready') {"));
	});
});
