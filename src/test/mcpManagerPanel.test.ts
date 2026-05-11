import * as assert from 'assert';
import fs from 'fs';
import path from 'path';

suite('MCP manager panel', () => {
	test('uses row-based editors for args and tool lists', () => {
		const sourcePath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'services',
			'mcpManagerPanel.ts',
		);
		const source = fs.readFileSync(sourcePath, 'utf8');

		assert.ok(source.includes("data-list-rows=\"args\""));
		assert.ok(source.includes("data-list-rows=\"enabledTools\""));
		assert.ok(source.includes("data-list-rows=\"disabledTools\""));
		assert.ok(source.includes("collectListEntries('args')"));
		assert.ok(source.includes("collectListEntries('enabledTools')"));
		assert.ok(source.includes("collectListEntries('disabledTools')"));
		assert.ok(!source.includes('<textarea class="textarea-args" name="args">'));
	});
});
