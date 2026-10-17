import { resolveCodexHomeDir } from './codexPaths';
import { buildLegacyHistoryIndex, createHistoryIndex, formatLocalTime, type HistoryIndex, type HistoryTurnRecord } from './historyService';
import { createHistoryThreadClient, HistoryApiError, isHistoryApiUnsupported, type HistoryThreadClient } from './historyAppServerClient';

type ApiRecord = Record<string, unknown>;

type CachedThread = { revision?: string; turns: HistoryTurnRecord[] };

/** Session-only cache, isolated by the resolved Codex home. No history is written to disk. */
export class ThreadHistoryCache {
	private readonly homes = new Map<string, Map<string, CachedThread>>();
	forHome(home: string): Map<string, CachedThread> {
		let entries = this.homes.get(home);
		if (!entries) { entries = new Map(); this.homes.set(home, entries); }
		return entries;
	}
}

type HistoryReadOptions = {
	onProgress?: (index: HistoryIndex) => void;
	cache?: Map<string, CachedThread>;
	signal?: AbortSignal;
};

function revisionOf(thread: ApiRecord): string | undefined {
	// Active threads can change within the timestamp's one-second resolution.
	if (typeof thread.updatedAt !== 'number' || !Number.isFinite(thread.updatedAt)
		|| thread.updatedAt >= Date.now() / 1000 - 2
		|| (thread.status as ApiRecord | undefined)?.type === 'active') { return undefined; }
	return JSON.stringify([thread.updatedAt, thread.createdAt, thread.path]);
}

// The default API filter includes only CLI and VS Code threads.
const HISTORY_SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer', 'subAgent',
	'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];

function record(value: unknown): ApiRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new HistoryApiError('Invalid Codex history response.');
	}
	return value as ApiRecord;
}

function records(value: unknown): ApiRecord[] {
	if (!Array.isArray(value)) {
		throw new HistoryApiError('Invalid Codex history page.');
	}
	return value.map(record);
}

function identifier(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new HistoryApiError('Missing Codex history identifier.');
	}
	return value;
}

async function listPages(client: HistoryThreadClient, method: string, params: ApiRecord,
	onPage?: (entries: ApiRecord[]) => void): Promise<ApiRecord[]> {
	const result: ApiRecord[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = record(await client.request(method, { ...params, ...(cursor ? { cursor } : {}), limit: 100 }));
		result.push(...records(page.data));
		onPage?.(result);
		if (page.nextCursor === null || page.nextCursor === undefined) {
			break;
		}
		cursor = identifier(page.nextCursor);
		if (seen.has(cursor)) {
			throw new HistoryApiError(`Repeated Codex history cursor: ${method}`);
		}
		seen.add(cursor);
	} while (cursor);
	return result;
}

type ItemWithTime = { item: ApiRecord; timestampMs?: number };

function secondsToMs(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : undefined;
}

function textContent(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (!Array.isArray(value)) {
		return '';
	}
	return value.map((part) => {
		if (typeof part === 'string') {
			return part;
		}
		const content = record(part);
		if (typeof content.text === 'string') {
			return content.text;
		}
		if (content.type === 'image' || content.type === 'localImage') {
			return '[Image]';
		}
		return '';
	}).filter(Boolean).join('\n');
}

function mapTurn(thread: ApiRecord, turn: ApiRecord, entries: ItemWithTime[]): HistoryTurnRecord {
	const sessionId = identifier(thread.id);
	const taskTurnId = identifier(turn.id);
	const timestampMs = secondsToMs(turn.startedAt) ?? entries.find((entry) => entry.timestampMs !== undefined)?.timestampMs
		?? secondsToMs(thread.createdAt) ?? 0;
	const date = new Date(timestampMs);
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const result: HistoryTurnRecord = {
		turnId: `${sessionId}:${taskTurnId}`, sessionId, taskTurnId,
		filePath: typeof thread.path === 'string' ? thread.path : '',
		year, month, day, dateKey: `${year}/${month}/${day}`,
		localTime: formatLocalTime(timestampMs), sortTimestampMs: timestampMs,
		userMessage: '', agentMessages: [], reasoningMessages: [],
		userMessageLocalTime: formatLocalTime(timestampMs),
		agentMessageLocalTimes: [], agentMessageTimestampMs: [],
		reasoningMessageLocalTimes: [], reasoningMessageTimestampMs: [], aiTimeline: [],
	};
	for (const { item, timestampMs: itemTime } of entries) {
		const message = item.type === 'userMessage' ? textContent(item.content)
			: item.type === 'agentMessage' ? textContent(item.text)
				: item.type === 'reasoning' ? (textContent(item.summary) || textContent(item.content)) : '';
		if (!message) {
			continue;
		}
		const time = itemTime ?? timestampMs;
		if (item.type === 'userMessage') {
			result.userMessage += `${result.userMessage ? '\n\n' : ''}${message}`;
			result.userMessageLocalTime = formatLocalTime(time);
			continue;
		}
		const reasoning = item.type === 'reasoning';
		(reasoning ? result.reasoningMessages : result.agentMessages).push(message);
		(reasoning ? result.reasoningMessageLocalTimes : result.agentMessageLocalTimes)!.push(formatLocalTime(time));
		(reasoning ? result.reasoningMessageTimestampMs : result.agentMessageTimestampMs)!.push(time);
		result.aiTimeline!.push({ kind: reasoning ? 'reasoning' : 'assistant', message,
			localTime: formatLocalTime(time), sortTimestampMs: time, sequence: result.aiTimeline!.length });
	}
	return result;
}

function mapFullTurns(thread: ApiRecord, turns: ApiRecord[]): HistoryTurnRecord[] {
	return turns.map((turn) => mapTurn(thread, turn, records(turn.items).map((item) => ({ item }))));
}

/** Read persisted turns without resuming a thread or generating a new turn. */
export async function readThreadHistoryIndex(client: HistoryThreadClient, options: HistoryReadOptions = {}): Promise<HistoryIndex> {
	const threads = new Map<string, ApiRecord>();
	for (const archived of [false, true]) {
		for (const thread of await listPages(client, 'thread/list', {
			archived, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], sourceKinds: HISTORY_SOURCE_KINDS,
		})) {
			threads.set(identifier(thread.id), thread);
		}
	}
	const history: HistoryTurnRecord[] = [];
	const pendingCached = new Map(options.cache);
	const publish = (threadId: string, turns: HistoryTurnRecord[], complete = true): void => {
		options.signal?.throwIfAborted();
		if (complete) { pendingCached.delete(threadId); }
		if (!options.onProgress) { return; }
		const visible = new Map([...pendingCached.values()].flatMap((entry) => entry.turns)
			.concat(history, turns).map((turn) => [turn.turnId, turn]));
		options.onProgress?.(createHistoryIndex([...visible.values()]));
	};
	const orderedThreads = [...threads.values()].sort((a, b) =>
		(Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.updatedAt) || Number(a.createdAt) || 0));
	for (const thread of orderedThreads) {
		options.signal?.throwIfAborted();
		const threadId = identifier(thread.id);
		const revision = revisionOf(thread);
		const cached = options.cache?.get(threadId);
		if (revision && cached?.revision === revision) {
			publish(threadId, cached.turns);
			history.push(...cached.turns);
			continue;
		}
		let turns: ApiRecord[];
		try {
			turns = await listPages(client, 'thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'full' },
				(page) => publish(threadId, mapFullTurns(thread, page), false));
		} catch (error) {
			if (!isHistoryApiUnsupported(error)) {
				throw error;
			}
			const response = record(await client.request('thread/read', { threadId, includeTurns: true }));
			turns = records(record(response.thread).turns);
			publish(threadId, mapFullTurns(thread, turns));
		}
		let itemsByTurn: Map<string, ItemWithTime[]> | undefined;
		{
			try {
				const items = await listPages(client, 'thread/items/list', { threadId, sortDirection: 'asc' });
				itemsByTurn = new Map();
				for (const entry of items) {
					const turnId = identifier(entry.turnId);
					const entries = itemsByTurn.get(turnId) ?? [];
					entries.push({ item: record(entry.item), timestampMs: typeof entry.startedAtMs === 'number' ? entry.startedAtMs : undefined });
					itemsByTurn.set(turnId, entries);
				}
			} catch (error) {
				if (!isHistoryApiUnsupported(error)) {
					throw error;
				}
			}
		}
		const threadHistory = turns.map((turn) => {
			const turnId = identifier(turn.id);
			const entries = itemsByTurn ? (itemsByTurn.get(turnId) ?? []) : records(turn.items).map((item) => ({ item }));
			return mapTurn(thread, turn, entries);
		});
		publish(threadId, threadHistory);
		history.push(...threadHistory);
		options.cache?.set(threadId, { revision, turns: threadHistory });
	}
	// Only an entirely successful listing can remove deleted threads from the cache.
	for (const id of options.cache?.keys() ?? []) {
		if (!threads.has(id)) { options.cache!.delete(id); }
	}
	return createHistoryIndex(history);
}

export async function buildThreadHistoryIndex(
	codexHomeDir = resolveCodexHomeDir(),
	createClient: (home: string) => Promise<HistoryThreadClient> = createHistoryThreadClient,
	loadLegacy: (home: string) => HistoryIndex = buildLegacyHistoryIndex,
	signal?: AbortSignal,
	options: { onProgress?: (index: HistoryIndex) => void; cache?: ThreadHistoryCache } = {},
): Promise<HistoryIndex> {
	let client: HistoryThreadClient | undefined;
	const abort = (): void => client?.dispose();
	try {
		signal?.throwIfAborted();
		const cache = options.cache?.forHome(codexHomeDir);
		if (cache?.size) {
			options.onProgress?.(createHistoryIndex([...cache.values()].flatMap((entry) => entry.turns)));
		}
		client = await createClient(codexHomeDir);
		signal?.throwIfAborted();
		signal?.addEventListener('abort', abort, { once: true });
		return await readThreadHistoryIndex(client, { ...options, cache, signal });
	} catch (error) {
		signal?.throwIfAborted();
		if (isHistoryApiUnsupported(error) || (error instanceof HistoryApiError && error.code === 'ENOENT')) {
			return loadLegacy(codexHomeDir);
		}
		throw error;
	} finally {
		signal?.removeEventListener('abort', abort);
		client?.dispose();
	}
}
