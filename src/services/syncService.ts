import fs from 'fs';
import path from 'path';
import { ensureDirectoryExists } from './fileOperations';

export type SyncResult = {
	skipped: string[];
};

type FileEntry = {
	mtimeMs: number;
	fullPath: string;
};

type SyncState = Record<string, Record<string, true>>;

const SYNC_STATE_DIR = '.codex-sync';
const SYNC_STATE_FILE = 'state.json';

function isHiddenSegment(segment: string): boolean {
	return segment.startsWith('.');
}

function isHiddenPath(relativePath: string): boolean {
	return relativePath
		.split(path.sep)
		.some((segment) => isHiddenSegment(segment));
}

function readSyncState(codexRoot: string): SyncState {
	const statePath = path.join(codexRoot, SYNC_STATE_DIR, SYNC_STATE_FILE);
	if (!fs.existsSync(statePath)) {
		return {};
	}
	try {
		const contents = fs.readFileSync(statePath, 'utf8');
		const parsed = JSON.parse(contents) as SyncState;
		return parsed ?? {};
	} catch {
		return {};
	}
}

function writeSyncState(codexRoot: string, state: SyncState): void {
	const stateDir = path.join(codexRoot, SYNC_STATE_DIR);
	ensureDirectoryExists(stateDir);
	const statePath = path.join(stateDir, SYNC_STATE_FILE);
	fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function buildFileMap(rootDir: string): Map<string, FileEntry> {
	const entries = new Map<string, FileEntry>();
	if (!fs.existsSync(rootDir)) {
		return entries;
	}

	const traverse = (currentDir: string) => {
		const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });
		for (const entry of dirEntries) {
			const fullPath = path.join(currentDir, entry.name);
			const relativePath = path.relative(rootDir, fullPath);
			if (isHiddenPath(relativePath)) {
				continue;
			}
			if (entry.isDirectory()) {
				traverse(fullPath);
			} else if (entry.isFile()) {
				const stat = fs.statSync(fullPath);
				entries.set(relativePath, { fullPath, mtimeMs: stat.mtimeMs });
			}
		}
	};

	traverse(rootDir);
	return entries;
}

function copyFileSafely(
	sourcePath: string,
	targetPath: string,
	skipped: string[],
): boolean {
	try {
		ensureDirectoryExists(path.dirname(targetPath));
		fs.copyFileSync(sourcePath, targetPath);
		return true;
	} catch {
		skipped.push(targetPath);
		return false;
	}
}

function deleteFileSafely(targetPath: string, skipped: string[]): boolean {
	try {
		fs.rmSync(targetPath, { force: true });
		return true;
	} catch {
		skipped.push(targetPath);
		return false;
	}
}

function cleanupEmptyParents(
	rootDir: string,
	targetPath: string,
	skipped: string[],
): void {
	let currentDir = path.dirname(targetPath);
	const rootResolved = path.resolve(rootDir);

	while (path.resolve(currentDir).startsWith(rootResolved)) {
		try {
			const entries = fs.readdirSync(currentDir, { withFileTypes: true });
			const hasVisibleEntry = entries.some((entry) => !entry.name.startsWith('.'));
			if (hasVisibleEntry) {
				return;
			}
			fs.rmdirSync(currentDir);
		} catch {
			skipped.push(currentDir);
			return;
		}

		if (path.resolve(currentDir) === rootResolved) {
			return;
		}
		currentDir = path.dirname(currentDir);
	}
}

function syncEntries(
	scopeKey: string,
	codexRoot: string,
	codexScopeRoot: string,
	targetRoot: string,
	codexEntries: Map<string, FileEntry>,
	targetEntries: Map<string, FileEntry>,
): SyncResult {
	const state = readSyncState(codexRoot);
	const scopeState = state[scopeKey] ?? {};
	const skipped: string[] = [];
	const allPaths = new Set<string>([
		...codexEntries.keys(),
		...targetEntries.keys(),
		...Object.keys(scopeState),
	]);

	for (const relativePath of allPaths) {
		const codexEntry = codexEntries.get(relativePath);
		const targetEntry = targetEntries.get(relativePath);
		const codexPath =
			codexEntry?.fullPath ?? path.join(codexScopeRoot, relativePath);
		const targetPath =
			targetEntry?.fullPath ?? path.join(targetRoot, relativePath);
		const known = scopeState[relativePath] === true;

		if (!codexEntry && !targetEntry) {
			delete scopeState[relativePath];
			continue;
		}

		if (codexEntry && targetEntry) {
			if (codexEntry.mtimeMs === targetEntry.mtimeMs) {
				scopeState[relativePath] = true;
				continue;
			}

			const source =
				codexEntry.mtimeMs > targetEntry.mtimeMs
					? { from: codexEntry, to: targetPath, codex: true }
					: { from: targetEntry, to: codexPath, codex: false };
			const copied = copyFileSafely(source.from.fullPath, source.to, skipped);
			if (copied) {
				scopeState[relativePath] = true;
			}
			continue;
		}

		if (!codexEntry && targetEntry) {
			if (known) {
				if (deleteFileSafely(targetEntry.fullPath, skipped)) {
					delete scopeState[relativePath];
					cleanupEmptyParents(targetRoot, targetEntry.fullPath, skipped);
				}
				continue;
			}

			const copied = copyFileSafely(targetEntry.fullPath, codexPath, skipped);
			if (copied) {
				scopeState[relativePath] = true;
			}
			continue;
		}

		if (codexEntry && !targetEntry) {
			if (known) {
				if (deleteFileSafely(codexEntry.fullPath, skipped)) {
					delete scopeState[relativePath];
					cleanupEmptyParents(
						codexScopeRoot,
						codexEntry.fullPath,
						skipped,
					);
				}
				continue;
			}

			const copied = copyFileSafely(codexEntry.fullPath, targetPath, skipped);
			if (copied) {
				scopeState[relativePath] = true;
			}
		}
	}

	state[scopeKey] = scopeState;
	writeSyncState(codexRoot, state);
	return { skipped };
}

/**
 * Synchronizes directory contents bidirectionally based on modification times.
 *
 * @param scopeKey - Sync scope name for tracking deletion metadata.
 * @param codexDir - Source directory under .codex.
 * @param targetDir - Destination directory for syncing.
 */
export function syncDirectoryBidirectional(
	scopeKey: string,
	codexRoot: string,
	codexDir: string,
	targetDir: string,
): SyncResult {
	const codexEntries = buildFileMap(codexDir);
	const targetEntries = buildFileMap(targetDir);
	return syncEntries(
		scopeKey,
		codexRoot,
		codexDir,
		targetDir,
		codexEntries,
		targetEntries,
	);
}

/**
 * Synchronizes Codex core files bidirectionally.
 *
 * @param codexDir - Path to the .codex directory.
 * @param targetDir - Destination directory for syncing.
 */
export function syncCoreFilesBidirectional(
	codexDir: string,
	targetDir: string,
): SyncResult {
	const files = ['AGENTS.md', 'config.toml'];
	const codexEntries = new Map<string, FileEntry>();
	const targetEntries = new Map<string, FileEntry>();

	for (const fileName of files) {
		const codexPath = path.join(codexDir, fileName);
		if (fs.existsSync(codexPath)) {
			const stat = fs.statSync(codexPath);
			codexEntries.set(fileName, { fullPath: codexPath, mtimeMs: stat.mtimeMs });
		}
		const targetPath = path.join(targetDir, fileName);
		if (fs.existsSync(targetPath)) {
			const stat = fs.statSync(targetPath);
			targetEntries.set(fileName, {
				fullPath: targetPath,
				mtimeMs: stat.mtimeMs,
			});
		}
	}

	return syncEntries(
		'core',
		codexDir,
		codexDir,
		targetDir,
		codexEntries,
		targetEntries,
	);
}
