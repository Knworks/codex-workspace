import * as fs from 'fs';
import * as path from 'path';

export type DisabledAgentEntry = {
	disabledAt: string;
	source: 'config.toml';
	block: string;
};

type DisabledAgentsStore = {
	version: 1;
	disabledAgents: Record<string, DisabledAgentEntry>;
};

const STORE_VERSION = 1;

/**
 * Returns the fixed disabled-agent store path.
 */
export function getDisabledAgentsStorePath(codexDir: string): string {
	return path.join(codexDir, '.codex-workspace', 'agents-disabled.json');
}

/**
 * Saves a disabled agent block, replacing any existing entry for the same id.
 */
export function saveDisabledAgentBlock(
	storePath: string,
	agentId: string,
	block: string,
	nowIso: string = new Date().toISOString(),
): void {
	const store = readDisabledAgentsStore(storePath);
	store.disabledAgents[agentId] = {
		disabledAt: nowIso,
		source: 'config.toml',
		block,
	};
	writeDisabledAgentsStore(storePath, store);
}

/**
 * Retrieves and removes a stored disabled block for the target agent.
 */
export function takeDisabledAgentBlock(
	storePath: string,
	agentId: string,
): string | undefined {
	const store = readDisabledAgentsStore(storePath);
	const entry = store.disabledAgents[agentId];
	if (!entry) {
		return undefined;
	}
	delete store.disabledAgents[agentId];
	writeDisabledAgentsStore(storePath, store);
	return entry.block;
}

function readDisabledAgentsStore(storePath: string): DisabledAgentsStore {
	if (!fs.existsSync(storePath)) {
		return createEmptyStore();
	}
	const raw = fs.readFileSync(storePath, 'utf8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('agents-disabled.json is invalid JSON');
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		!('version' in parsed) ||
		!('disabledAgents' in parsed)
	) {
		throw new Error('agents-disabled.json has invalid schema');
	}
	const version = (parsed as { version: unknown }).version;
	const disabledAgents = (parsed as { disabledAgents: unknown }).disabledAgents;
	if (
		version !== STORE_VERSION ||
		typeof disabledAgents !== 'object' ||
		disabledAgents === null
	) {
		throw new Error('agents-disabled.json has unsupported schema');
	}
	return {
		version: STORE_VERSION,
		disabledAgents: disabledAgents as Record<string, DisabledAgentEntry>,
	};
}

function writeDisabledAgentsStore(storePath: string, store: DisabledAgentsStore): void {
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function createEmptyStore(): DisabledAgentsStore {
	return {
		version: STORE_VERSION,
		disabledAgents: {},
	};
}
