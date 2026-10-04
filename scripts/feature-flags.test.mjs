import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compareFeatureCatalog, parseFeatureList } from './feature-flags-lib.mjs';

test('parse CLI rows including multi-word stages, dotted keys, CRLF and sorting', () => {
	assert.deepEqual(parseFeatureList('z stable true\r\na under development false\r\na.thread removed true\r\n'), [
		{ key: 'a', stage: 'under development', defaultEnabled: false },
		{ key: 'a.thread', stage: 'removed', defaultEnabled: true },
		{ key: 'z', stage: 'stable', defaultEnabled: true },
	]);
});

test('reject empty, malformed, unknown-stage and duplicate output', () => {
	for (const output of ['', 'a stable yes', 'a preview true', 'a stable true\na stable false']) {
		assert.throws(() => parseFeatureList(output), /Unexpected or duplicate feature row/);
	}
});

test('detect version, additions, deletions, stage and default changes', () => {
	const previous = { version: 'codex-cli 0.157.1', features: parseFeatureList('goals experimental false\ncodex_hooks stable true\npersonality stable true') };
	const current = { version: 'codex-cli 0.160.0', features: parseFeatureList('goals stable true\nhooks stable true\npersonality removed false') };
	assert.deepEqual(compareFeatureCatalog(previous, current), [
		'Version: codex-cli 0.157.1 -> codex-cli 0.160.0',
		'Stage: goals: experimental -> stable',
		'Default: goals: false -> true',
		'Added: hooks (stable)',
		'Stage: personality: stable -> removed',
		'Default: personality: true -> false',
		'Deleted: codex_hooks',
	]);
});

test('catalog comparison ignores row order and reports no changes for identical data', () => {
	const features = parseFeatureList('a stable true\nb experimental false');
	assert.deepEqual(compareFeatureCatalog({ version: 'v1', features }, { version: 'v1', features: [...features].reverse() }), []);
});

test('committed catalog contains unique, valid CLI rows', () => {
	const snapshot = JSON.parse(fs.readFileSync(new URL('../src/data/codexFeatureFlags.json', import.meta.url), 'utf8'));
	assert.match(snapshot.version, /^codex-cli \d+\.\d+\.\d+/);
	for (const feature of snapshot.features) {
		assert.equal(typeof feature.defaultEnabled, 'boolean');
	}
	const parsed = parseFeatureList(snapshot.features.map((feature) => `${feature.key} ${feature.stage} ${feature.defaultEnabled}`).join('\n'));
	assert.deepEqual(parsed, snapshot.features);
});
