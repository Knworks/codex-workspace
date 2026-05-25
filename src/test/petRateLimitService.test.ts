import * as assert from 'assert';
import { mapCodexStatusToPetRateLimits } from '../services/petRateLimitService';

suite('petRateLimitService', () => {
	test('maps supported rate limit windows and sorts them by label', () => {
		const snapshot = mapCodexStatusToPetRateLimits({
			rateLimits: {
				primary: {
					usedPercent: 80,
					windowDurationMins: 10080,
					resetsAt: 1_700_000_000,
				},
				secondary: {
					usedPercent: 20,
					windowDurationMins: 300,
					resetsAt: 1_700_100_000,
				},
			},
		});

		assert.ok(snapshot);
		assert.deepStrictEqual(
			snapshot.windows.map((window) => window.label),
			['5h', '1w'],
		);
		assert.strictEqual(snapshot.windows[0].remainingPercent, 80);
		assert.strictEqual(snapshot.windows[0].isWarning, false);
		assert.strictEqual(snapshot.windows[1].remainingPercent, 20);
		assert.strictEqual(snapshot.windows[1].isWarning, true);
	});

	test('maps non-hour windows such as the current 15 minute primary limit', () => {
		const snapshot = mapCodexStatusToPetRateLimits({
			rateLimits: {
				primary: {
					usedPercent: 20,
					windowDurationMins: 15,
					resetsAt: 1_700_000_000,
				},
				secondary: null,
			},
		});

		assert.ok(snapshot);
		assert.strictEqual(snapshot.windows.length, 1);
		assert.strictEqual(snapshot.windows[0].label, '15m');
		assert.strictEqual(snapshot.windows[0].remainingPercent, 80);
	});
});
