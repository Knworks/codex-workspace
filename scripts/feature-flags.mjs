import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFeatureCatalog, parseFeatureList } from './feature-flags-lib.mjs';

const snapshotPath = fileURLToPath(new URL('../src/data/codexFeatureFlags.json', import.meta.url));
const mode = process.argv[2];
if (mode !== 'check' && mode !== 'update') {
	throw new Error('Usage: node scripts/feature-flags.mjs <check|update>');
}

// Isolate user and project configuration: features list reports effective state.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-features-'));
try {
	const cli = process.env.CODEX_FEATURES_CLI || 'codex';
	const options = {
		cwd: tempRoot,
		env: { ...process.env, CODEX_HOME: tempRoot },
		encoding: 'utf8',
		timeout: 30_000,
	};
	const version = execFileSync(cli, ['--version'], options).trim();
	if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
		throw new Error(`Unexpected CLI version: ${version}`);
	}
	const output = execFileSync(cli, ['features', 'list'], options);
	const features = parseFeatureList(output);
	const snapshot = { version, features };
	const previous = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : { features: [] };
	const changes = compareFeatureCatalog(previous, snapshot);
	console.log(changes.join('\n') || `Feature catalog matches ${version} (${features.length} flags).`);
	if (mode === 'update') {
		fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
		fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
	} else if (changes.length > 0) {
		process.exitCode = 1;
	}
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
