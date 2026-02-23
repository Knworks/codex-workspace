import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from '../services/disabledAgentsStore';

suite('Disabled agents store', () => {
	test('save and take block round trip', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disabled-agent-store-'));
		try {
			const storePath = getDisabledAgentsStorePath(tempDir);
			saveDisabledAgentBlock(
				storePath,
				'reviewer',
				'[agents.reviewer]\nconfig_file = "agents/reviewer.toml"\n',
				'2026-02-23T00:00:00.000Z',
			);
			assert.ok(fs.existsSync(storePath));

			const block = takeDisabledAgentBlock(storePath, 'reviewer');
			assert.ok(block?.includes('[agents.reviewer]'));
			const missing = takeDisabledAgentBlock(storePath, 'reviewer');
			assert.strictEqual(missing, undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('take from missing store returns undefined', () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disabled-agent-store-'));
		try {
			const storePath = getDisabledAgentsStorePath(tempDir);
			const block = takeDisabledAgentBlock(storePath, 'missing');
			assert.strictEqual(block, undefined);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
