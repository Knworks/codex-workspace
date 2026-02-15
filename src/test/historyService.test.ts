import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	buildHistoryIndex,
	formatLocalTime,
	resolveSessionsRoot,
} from '../services/historyService';

function withTempDir(run: (root: string) => void): void {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-'));
	try {
		run(tempDir);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

function writeJsonl(filePath: string, events: unknown[]): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const lines = events.map((event) => JSON.stringify(event));
	fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function createUserEvent(message: string, timestamp: string): unknown {
	return {
		type: 'event_msg',
		timestamp,
		payload: {
			type: 'user_message',
			message,
		},
	};
}

function createAgentEvent(message: string): unknown {
	return {
		type: 'event_msg',
		payload: {
			type: 'agent_message',
			message,
		},
	};
}

suite('History service', () => {
	test('buildHistoryIndex scans rollout files and builds day list with newest-first turns', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-older.jsonl'),
				[
					createUserEvent('older user', '2026-02-15T10:00:00.000Z'),
					createAgentEvent('older answer'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-newer.jsonl'),
				[
					createUserEvent('newer user', '2026-02-15T12:00:00.000Z'),
					createAgentEvent('newer answer'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '14', 'rollout-prevday.jsonl'),
				[
					createUserEvent('prev day user', '2026-02-14T09:00:00.000Z'),
					createAgentEvent('prev day answer'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '2', '15', 'rollout-invalid-path.jsonl'),
				[
					createUserEvent('invalid', '2026-02-15T01:00:00.000Z'),
					createAgentEvent('invalid'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'not-rollout.jsonl'),
				[
					createUserEvent('ignored', '2026-02-15T01:00:00.000Z'),
					createAgentEvent('ignored'),
				],
			);

			const index = buildHistoryIndex(codexHome);

			assert.strictEqual(index.turns.length, 3);
			assert.deepStrictEqual(index.days.map((day) => day.dateKey), [
				'2026/02/15',
				'2026/02/14',
			]);
			assert.deepStrictEqual(
				index.days[0].turns.map((turn) => turn.userMessage),
				['newer user', 'older user'],
			);
		});
	});

	test('buildHistoryIndex links agent_message blocks until next user_message', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-one.jsonl'),
				[
					createUserEvent('user-1', '2026-02-15T04:31:00.000Z'),
					createAgentEvent('agent-1-a'),
					createAgentEvent('agent-1-b'),
					createUserEvent('user-2', '2026-02-15T04:32:00.000Z'),
					{
						type: 'event_msg',
						payload: {
							type: 'task_complete',
							last_agent_message: 'ignored for mapping',
						},
					},
					createUserEvent('user-3', '2026-02-15T04:33:00.000Z'),
					createAgentEvent('agent-3-a'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 3);
			assert.deepStrictEqual(index.turns[0].agentMessages, ['agent-3-a']);
			assert.deepStrictEqual(index.turns[1].agentMessages, []);
			assert.deepStrictEqual(index.turns[2].agentMessages, [
				'agent-1-a',
				'agent-1-b',
			]);
		});
	});

	test('formatLocalTime provides [H:mm:ss] format', () => {
		const formatted = formatLocalTime('2026-02-15T00:00:00.000Z');
		assert.match(formatted, /^\[\d{1,2}:\d{2}:\d{2}\]$/);
	});

	test('buildHistoryIndex excludes sessions without user_message', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-no-user.jsonl'),
				[createAgentEvent('orphan')],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 0);
			assert.strictEqual(index.days.length, 0);
		});
	});

	test('buildHistoryIndex deduplicates consecutive unanswered duplicate user messages', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-dup.jsonl'),
				[
					createUserEvent('same message', '2026-02-15T10:00:00.000Z'),
					createUserEvent('same message', '2026-02-15T10:00:01.000Z'),
					createAgentEvent('answer'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.deepStrictEqual(index.turns[0].agentMessages, ['answer']);
		});
	});
});
