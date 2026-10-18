import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildThreadHistoryIndex, readThreadHistoryIndex, ThreadHistoryCache } from '../services/threadHistoryService';
import { buildLegacyHistoryIndex } from '../services/historyService';
import { HistoryApiError, type HistoryThreadClient } from '../services/historyAppServerClient';

function clientWith(request: HistoryThreadClient['request']): HistoryThreadClient & { disposed: boolean } {
	return { request, disposed: false, dispose() { this.disposed = true; } };
}

const thread = { id: 'active', createdAt: 1791800000 };
const user = { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'Find **history**' }] };
const assistant = { type: 'agentMessage', id: 'a', text: 'Here is `history`.' };
const reasoning = { type: 'reasoning', id: 'r', summary: ['Check the archive'], content: [] };
const turn = { id: 'turn', startedAt: 1791800010, items: [user, reasoning, assistant] };

suite('Thread API history', () => {
	test('publishes newest updated threads and turn pages before all history is available', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const snapshots: string[][] = [];
		let completed = false;
		const client = clientWith(async (method, params) => {
			if (method === 'thread/list') {
				assert.strictEqual(params.sortKey, 'updated_at');
				return { data: [{ ...thread, id: params.archived ? 'archive' : 'active', updatedAt: params.archived ? 200 : 100 }] };
			}
			if (method === 'thread/turns/list') {
				assert.strictEqual(params.sortDirection, 'desc');
				if (params.cursor) { await gate; return { data: [{ ...turn, id: 'older' }] }; }
				return { data: [turn], nextCursor: 'next' };
			}
			throw new HistoryApiError('Items unsupported', -32601);
		});
		const result = readThreadHistoryIndex(client, { onProgress: (index) => {
			snapshots.push(index.turns.map((entry) => entry.turnId));
		} }).then((index) => { completed = true; return index; });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.strictEqual(completed, false);
		assert.deepStrictEqual(snapshots[0], ['archive:turn']);
		release();
		assert.strictEqual((await result).turns.length, 4);
	});

	test('reuses unchanged thread bodies, refreshes changes, removes deleted threads and isolates homes', async () => {
		const cache = new ThreadHistoryCache();
		let updatedAt = 100;
		let includeArchive = true;
		const bodies: string[] = [];
		const client = clientWith(async (method, params) => {
			if (method === 'thread/list') {
				return { data: params.archived ? (includeArchive ? [{ ...thread, id: 'archive', updatedAt: 100 }] : [])
					: [{ ...thread, updatedAt }] };
			}
			bodies.push(method);
			if (method === 'thread/turns/list') { return { data: [turn] }; }
			throw new HistoryApiError('Items unsupported', -32601);
		});
		const load = (home = 'home') => buildThreadHistoryIndex(home, async () => client, undefined, undefined, { cache });
		assert.strictEqual((await load()).turns.length, 2);
		assert.strictEqual(bodies.length, 4);
		bodies.length = 0;
		assert.strictEqual((await load()).turns.length, 2);
		assert.strictEqual(bodies.length, 0);
		updatedAt = 101;
		includeArchive = false;
		assert.strictEqual((await load()).turns.length, 1);
		assert.strictEqual(bodies.length, 2);
		assert.strictEqual(cache.forHome('home').has('archive'), false);
		bodies.length = 0;
		await load('another-home');
		assert.strictEqual(bodies.length, 2);

		// Cached results are delivered before the server can even initialize.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let visible = 0;
		const reopen = buildThreadHistoryIndex('home', async () => { await gate; return client; }, undefined, undefined,
			{ cache, onProgress: (index) => { visible = index.turns.length; } });
		assert.strictEqual(visible, 1);
		release();
		await reopen;
	});

	test('does not reuse active or unversioned threads and retains completed cache on failure', async () => {
		const cache = new ThreadHistoryCache();
		let fail = false;
		let bodyCalls = 0;
		const client = clientWith(async (method, params) => {
			if (method === 'thread/list') {
				if (fail) { throw new Error('list failed'); }
				return { data: params.archived ? [] : [
					{ ...thread, updatedAt: 100, status: { type: 'active' } }, { ...thread, id: 'unversioned' },
				] };
			}
			if (method === 'thread/turns/list') { bodyCalls++; return { data: [turn] }; }
			throw new HistoryApiError('Items unsupported', -32601);
		});
		const load = () => buildThreadHistoryIndex('home', async () => client, undefined, undefined, { cache });
		await load(); await load();
		assert.strictEqual(bodyCalls, 4);
		fail = true;
		await assert.rejects(load(), /list failed/);
		assert.strictEqual(cache.forHome('home').size, 2);
	});

	test('pages active, archived, turns and items while preserving message order and timestamps', async () => {
		const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
		const client = clientWith(async (method, params) => {
			calls.push({ method, params });
			if (method === 'thread/list') {
				return params.archived ? (params.cursor
					? { data: [{ ...thread, id: 'archived-older' }], nextCursor: null }
					: { data: [{ ...thread, id: 'archived' }], nextCursor: 'archive-page-2' })
					: params.cursor ? { data: [{ ...thread, id: 'older' }], nextCursor: null }
						: { data: [thread], nextCursor: 'thread-page-2' };
			}
			if (method === 'thread/turns/list') {
				return params.cursor ? { data: [{ ...turn, id: 'older-turn' }], nextCursor: null }
					: { data: [turn], nextCursor: 'turn-page-2' };
			}
			assert.strictEqual(method, 'thread/items/list');
			const entry = (item: unknown, startedAtMs: number) => ({ turnId: 'turn', item, startedAtMs });
			return params.cursor ? { data: [entry(assistant, 1791800013000), { turnId: 'older-turn', item: user }], nextCursor: null }
				: { data: [entry(user, 1791800011000), entry(reasoning, 1791800012000)], nextCursor: 'item-page-2' };
		});
		const index = await readThreadHistoryIndex(client);
		assert.strictEqual(index.turns.length, 8);
		assert.deepStrictEqual(new Set(index.turns.map((entry) => entry.sessionId)), new Set(['active', 'older', 'archived', 'archived-older']));
		const selected = index.turns.find((entry) => entry.turnId === 'active:turn')!;
		assert.strictEqual(selected.userMessage, 'Find **history**');
		assert.deepStrictEqual(selected.agentMessages, ['Here is `history`.']);
		assert.deepStrictEqual(selected.reasoningMessages, ['Check the archive']);
		assert.deepStrictEqual(selected.aiTimeline?.map((item) => item.kind), ['reasoning', 'assistant']);
		assert.deepStrictEqual(selected.agentMessageTimestampMs, [1791800013000]);
		assert.strictEqual(selected.sortTimestampMs, 1791800010000);
		assert.strictEqual(index.days.flatMap((day) => day.turns).length, 8);
		assert.ok(calls.some((call) => call.params.cursor === 'thread-page-2'));
		assert.ok(calls.some((call) => call.params.archived === true && call.params.cursor === 'archive-page-2'));
		assert.ok(calls.some((call) => call.params.cursor === 'turn-page-2'));
		assert.ok(calls.some((call) => call.params.cursor === 'item-page-2'));
	});

	test('uses full API turns when item pagination is unsupported', async () => {
		const client = clientWith(async (method, params) => {
			if (method === 'thread/list') {
				return { data: params.archived ? [] : [thread] };
			}
			if (method === 'thread/items/list') {
				throw new HistoryApiError('Unsupported storage method.', -32601);
			}
			assert.strictEqual(params.itemsView, 'full');
			return { data: [turn] };
		});
		const index = await readThreadHistoryIndex(client);
		assert.deepStrictEqual(index.turns[0].agentMessages, [assistant.text]);
		assert.deepStrictEqual(index.turns[0].reasoningMessages, reasoning.summary);
	});

	test('uses thread/read for an older server without turn pagination', async () => {
		const client = clientWith(async (method, params) => {
			if (method === 'thread/list') {
				return { data: params.archived ? [] : [thread] };
			}
			if (method === 'thread/read') {
				assert.strictEqual(params.includeTurns, true);
				return { thread: { ...thread, turns: [turn] } };
			}
			throw new HistoryApiError('Method not found.', -32601);
		});
		assert.strictEqual((await readThreadHistoryIndex(client)).turns[0].userMessage, 'Find **history**');
	});

	test('does not fall back after ordinary list, turn or item API failures', async () => {
		for (const failedMethod of ['thread/list', 'thread/turns/list', 'thread/items/list']) {
			const client = clientWith(async (method, params) => {
				if (method === failedMethod) {
					throw new HistoryApiError('Storage read failed.', -32000);
				}
				return { data: method === 'thread/list' ? (params.archived ? [] : [thread]) : [turn] };
			});
			let legacyLoaded = false;
			await assert.rejects(buildThreadHistoryIndex('home', async () => client, () => {
				legacyLoaded = true;
				return { days: [], turns: [] };
			}), /Storage read failed/);
			assert.strictEqual(legacyLoaded, false);
			assert.strictEqual(client.disposed, true);
		}
	});

	test('keeps empty API results authoritative and closes the client', async () => {
		const client = clientWith(async () => ({ data: [] }));
		const index = await buildThreadHistoryIndex('selected-home', async (home) => {
			assert.strictEqual(home, 'selected-home');
			return client;
		}, () => { throw new Error('Legacy must not run.'); });
		assert.deepStrictEqual(index, { days: [], turns: [] });
		assert.strictEqual(client.disposed, true);
	});

	test('rejects malformed pages and repeated cursors without silently losing history', async () => {
		await assert.rejects(readThreadHistoryIndex(clientWith(async () => ({ data: 'bad' }))), /Invalid Codex history page/);
		await assert.rejects(readThreadHistoryIndex(clientWith(async () => ({ data: [], nextCursor: 'repeat' }))), /Repeated Codex history cursor/);
	});

	test('reads legacy active and archived rollouts only when thread/list is unsupported', async () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-history-legacy-'));
		try {
			for (const directory of [path.join(home, 'sessions', '2026', '10', '12'), path.join(home, 'archived_sessions')]) {
				fs.mkdirSync(directory, { recursive: true });
				const events = [
					{ type: 'event_msg', timestamp: '2026-10-12T01:00:00Z', payload: { type: 'task_started', turn_id: 'legacy-turn' } },
					{ type: 'event_msg', timestamp: '2026-10-12T01:00:01Z', payload: { type: 'user_message', message: 'legacy question', turn_id: 'legacy-turn' } },
					{ type: 'event_msg', timestamp: '2026-10-12T01:00:02Z', payload: { type: 'agent_message', message: 'legacy answer', turn_id: 'legacy-turn' } },
				];
				fs.writeFileSync(path.join(directory, `rollout-2026-10-12T01-00-00-${path.basename(directory)}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n'));
			}
			const client = clientWith(async () => { throw new HistoryApiError('Method not found.', -32601); });
			const index = await buildThreadHistoryIndex(home, async () => client);
			assert.strictEqual(index.turns.length, 2);
			assert.ok(index.turns.every((entry) => entry.userMessage === 'legacy question' && entry.agentMessages[0] === 'legacy answer'));
			assert.deepStrictEqual(index, buildLegacyHistoryIndex(home));
			assert.strictEqual(client.disposed, true);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	test('uses legacy for a missing executable and propagates timeout or access errors', async () => {
		for (const code of ['ENOENT', 'EACCES', undefined]) {
			const result = buildThreadHistoryIndex('home', async () => { throw new HistoryApiError('startup failure', code); }, () => ({ days: [], turns: [] }));
			if (code === 'ENOENT') {
				assert.deepStrictEqual(await result, { days: [], turns: [] });
			} else {
				await assert.rejects(result, /startup failure/);
			}
		}
	});

	test('cancellation disposes the client and never invokes legacy', async () => {
		const controller = new AbortController();
		const client = clientWith(async () => {
			controller.abort();
			throw new HistoryApiError('Cancelled request.');
		});
		await assert.rejects(buildThreadHistoryIndex('home', async () => client,
			() => { throw new Error('Legacy must not run.'); }, controller.signal));
		assert.strictEqual(client.disposed, true);
	});
});
