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

function createTaskCompleteEvent(lastMessage: string): unknown {
	return {
		type: 'event_msg',
		payload: {
			type: 'task_complete',
			last_agent_message: lastMessage,
		},
	};
}

suite('History service', () => {
	test('buildHistoryIndex scans rollout files and builds date tree with newest-first sessions', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-older.jsonl'),
				[
					createUserEvent('older title', '2026-02-15T10:00:00.000Z'),
					createTaskCompleteEvent('older final'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-newer.jsonl'),
				[
					createUserEvent('newer title', '2026-02-15T12:00:00.000Z'),
					createTaskCompleteEvent('newer final'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '14', 'rollout-prevday.jsonl'),
				[
					createUserEvent('prev day', '2026-02-14T09:00:00.000Z'),
					createTaskCompleteEvent('prev final'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '2', '15', 'rollout-invalid-path.jsonl'),
				[
					createUserEvent('invalid', '2026-02-15T01:00:00.000Z'),
					createTaskCompleteEvent('invalid'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'not-rollout.jsonl'),
				[
					createUserEvent('ignored', '2026-02-15T01:00:00.000Z'),
					createTaskCompleteEvent('ignored'),
				],
			);

			const index = buildHistoryIndex(codexHome);

			assert.strictEqual(index.sessions.length, 3);
			assert.strictEqual(index.years.length, 1);
			assert.strictEqual(index.years[0].months.length, 1);
			assert.deepStrictEqual(
				index.years[0].months[0].days.map((day) => day.day),
				['15', '14'],
			);
			assert.deepStrictEqual(
				index.years[0].months[0].days[0].sessions.map((session) => session.title),
				['newer title', 'older title'],
			);
		});
	});

	test('buildHistoryIndex uses first user_message as title and last task_complete as final message', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-one.jsonl'),
				[
					{
						type: 'event_msg',
						timestamp: '2026-02-15T04:30:00.000Z',
						payload: {
							type: 'developer_message',
							message: 'ignore me',
						},
					},
					createUserEvent('first user message', '2026-02-15T04:31:00.000Z'),
					createUserEvent('second user message', '2026-02-15T04:32:00.000Z'),
					createTaskCompleteEvent('first final'),
					createTaskCompleteEvent('last final'),
					{
						type: 'event_msg',
						payload: {
							type: 'tool_result',
							value: 'ignore me too',
						},
					},
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.sessions.length, 1);
			assert.strictEqual(index.sessions[0].title, 'first user message');
			assert.strictEqual(index.sessions[0].finalAgentMessage, 'last final');
			assert.deepStrictEqual(index.sessions[0].userMessages, [
				'first user message',
				'second user message',
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
				[createTaskCompleteEvent('only final')],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.sessions.length, 0);
			assert.strictEqual(index.years.length, 0);
		});
	});
});
