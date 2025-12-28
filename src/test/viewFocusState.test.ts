import * as assert from 'assert';
import { ViewFocusState } from '../services/viewFocusState';

suite('View focus state', () => {
	test('tracks active view kind', () => {
		const state = new ViewFocusState();
		assert.strictEqual(state.isActive('prompts'), false);
		state.setActive('prompts', true);
		assert.strictEqual(state.isActive('prompts'), true);
		assert.strictEqual(state.isActive('skills'), false);
		assert.strictEqual(state.hasSelection('prompts'), true);
	});

	test('clears active view', () => {
		const state = new ViewFocusState();
		state.setActive('templates', true);
		state.clear();
		assert.strictEqual(state.isActive('templates'), false);
		assert.strictEqual(state.hasSelection('templates'), false);
	});
});
