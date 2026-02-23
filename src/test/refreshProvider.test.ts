import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EmptyExplorerProvider } from '../views/emptyExplorerProvider';

suite('CodexTreeDataProvider refresh', () => {
	test('refresh emits change event', (done) => {
		const provider = new EmptyExplorerProvider(() => ({ isAvailable: true }));
		let fired = false;
		provider.onDidChangeTreeData(() => {
			fired = true;
			assert.strictEqual(fired, true);
			done();
		});
		provider.refresh();
	});

	test('refreshAll command refreshes agent explorer too', () => {
		const extensionPath = path.resolve(
			__dirname,
			'..',
			'..',
			'src',
			'extension.ts',
		);
		const extensionSource = fs.readFileSync(extensionPath, 'utf8');
		assert.ok(
			extensionSource.includes('agentsProvider.refresh();'),
			'refreshAll should call agentsProvider.refresh()',
		);
	});
});
