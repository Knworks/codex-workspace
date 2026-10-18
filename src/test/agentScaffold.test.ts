import * as assert from 'assert';
import * as toml from 'toml';
import { createAgentScaffold } from '../services/agentScaffold';

suite('Agent scaffold', () => {
	for (const [name, description] of [
		['reviewer', 'Review changes carefully.'],
		['設計 "担当"\\改行\n次行', '日本語 "引用" \\\n# comment\r\nmodel = "injected"\rnext\t\b\f\u0000\u001f\u007f'],
		['emoji_😀', 'Triple quotes: """ and literal \\n'],
	]) {
		test(`round trips name and description: ${JSON.stringify(name)}`, () => {
			const contents = createAgentScaffold(name, description);
			assert.deepStrictEqual({ ...toml.parse(contents) }, {
				name,
				description,
				developer_instructions: description,
			});
			const header = contents.split('\n').slice(0, 4);
			assert.ok(header.every((line) => line.startsWith('# ')));
			assert.strictEqual(header[1], `# name: ${JSON.stringify(name).slice(1, -1)}`);
			assert.ok(!contents.includes('\u007f'));
		});
	}

	for (const description of ['', ' \t\r\n ']) {
		test(`provides editable required fields for blank description: ${JSON.stringify(description)}`, () => {
			const parsed = toml.parse(createAgentScaffold('reviewer', description));
			assert.strictEqual(parsed.name, 'reviewer');
			assert.strictEqual(typeof parsed.description, 'string');
			assert.strictEqual(typeof parsed.developer_instructions, 'string');
			assert.match(String(parsed.description), /TODO:.*agent/);
			assert.match(String(parsed.developer_instructions), /TODO:.*instructions/);
			assert.deepStrictEqual(Object.keys(parsed).sort(), ['description', 'developer_instructions', 'name']);
		});
	}
});
