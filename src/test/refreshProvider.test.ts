import * as assert from 'assert';
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
});
