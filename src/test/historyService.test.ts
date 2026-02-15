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

function createTaskStartedEvent(turnId: string, timestamp: string): unknown {
	return {
		type: 'event_msg',
		timestamp,
		payload: {
			type: 'task_started',
			turn_id: turnId,
		},
	};
}

function createTaskCompleteEvent(turnId: string, timestamp: string): unknown {
	return {
		type: 'event_msg',
		timestamp,
		payload: {
			type: 'task_complete',
			turn_id: turnId,
		},
	};
}

function createUserEvent(message: string, timestamp: string, turnId: string): unknown {
	return {
		type: 'event_msg',
		timestamp,
		payload: {
			type: 'user_message',
			message,
			turn_id: turnId,
		},
	};
}

function createUserEventWithoutTurnId(message: string, timestamp: string): unknown {
	return {
		type: 'event_msg',
		timestamp,
		payload: {
			type: 'user_message',
			message,
		},
	};
}

function createAgentEvent(
	message: string,
	turnId: string,
	timestamp?: string,
): unknown {
	const event: Record<string, unknown> = {
		type: 'event_msg',
		payload: {
			type: 'agent_message',
			message,
			turn_id: turnId,
		},
	};
	if (timestamp) {
		event.timestamp = timestamp;
	}
	return event;
}

function createAgentEventWithoutTurnId(message: string, timestamp?: string): unknown {
	const event: Record<string, unknown> = {
		type: 'event_msg',
		payload: {
			type: 'agent_message',
			message,
		},
	};
	if (timestamp) {
		event.timestamp = timestamp;
	}
	return event;
}

function createReasoningEvent(
	message: string,
	turnId: string,
	timestamp?: string,
): unknown {
	const event: Record<string, unknown> = {
		type: 'response_item',
		turn_id: turnId,
		payload: {
			type: 'reasoning',
			summary: [
				{
					type: 'summary_text',
					text: message,
				},
			],
			turn_id: turnId,
		},
	};
	if (timestamp) {
		event.timestamp = timestamp;
	}
	return event;
}

function createReasoningEventWithoutTurnId(message: string, timestamp?: string): unknown {
	const event: Record<string, unknown> = {
		type: 'response_item',
		payload: {
			type: 'reasoning',
			summary: [
				{
					type: 'summary_text',
					text: message,
				},
			],
		},
	};
	if (timestamp) {
		event.timestamp = timestamp;
	}
	return event;
}

function createAssistantMessageResponseItem(message: string, turnId: string): unknown {
	return {
		type: 'response_item',
		turn_id: turnId,
		payload: {
			type: 'message',
			role: 'assistant',
			content: [
				{
					type: 'output_text',
					text: message,
				},
			],
			turn_id: turnId,
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
					createTaskStartedEvent('turn-older', '2026-02-15T10:00:00.000Z'),
					createUserEvent('older user', '2026-02-15T10:00:01.000Z', 'turn-older'),
					createAgentEvent('older answer', 'turn-older'),
					createTaskCompleteEvent('turn-older', '2026-02-15T10:00:02.000Z'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-newer.jsonl'),
				[
					createTaskStartedEvent('turn-newer', '2026-02-15T12:00:00.000Z'),
					createUserEvent('newer user', '2026-02-15T12:00:01.000Z', 'turn-newer'),
					createAgentEvent('newer answer', 'turn-newer'),
					createTaskCompleteEvent('turn-newer', '2026-02-15T12:00:02.000Z'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '14', 'rollout-prevday.jsonl'),
				[
					createTaskStartedEvent('turn-prev', '2026-02-14T09:00:00.000Z'),
					createUserEvent('prev day user', '2026-02-14T09:00:01.000Z', 'turn-prev'),
					createAgentEvent('prev day answer', 'turn-prev'),
					createTaskCompleteEvent('turn-prev', '2026-02-14T09:00:02.000Z'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '2', '15', 'rollout-invalid-path.jsonl'),
				[
					createTaskStartedEvent('turn-invalid', '2026-02-15T01:00:00.000Z'),
					createUserEvent('invalid', '2026-02-15T01:00:01.000Z', 'turn-invalid'),
					createAgentEvent('invalid', 'turn-invalid'),
					createTaskCompleteEvent('turn-invalid', '2026-02-15T01:00:02.000Z'),
				],
			);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'not-rollout.jsonl'),
				[
					createTaskStartedEvent('turn-ignored', '2026-02-15T01:00:00.000Z'),
					createUserEvent('ignored', '2026-02-15T01:00:01.000Z', 'turn-ignored'),
					createAgentEvent('ignored', 'turn-ignored'),
					createTaskCompleteEvent('turn-ignored', '2026-02-15T01:00:02.000Z'),
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

	test('buildHistoryIndex groups messages by task turn_id boundaries', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-one.jsonl'),
				[
					createTaskStartedEvent('turn-1', '2026-02-15T04:31:00.000Z'),
					createUserEvent('user-1', '2026-02-15T04:31:01.000Z', 'turn-1'),
					createReasoningEvent('reasoning-1-a', 'turn-1'),
					createAgentEvent('agent-1-a', 'turn-1'),
					createReasoningEvent('reasoning-1-b', 'turn-1'),
					createAgentEvent('agent-1-b', 'turn-1'),
					createTaskCompleteEvent('turn-1', '2026-02-15T04:31:30.000Z'),
					createTaskStartedEvent('turn-2', '2026-02-15T04:32:00.000Z'),
					createUserEvent('user-2', '2026-02-15T04:32:01.000Z', 'turn-2'),
					createTaskCompleteEvent('turn-2', '2026-02-15T04:32:30.000Z'),
					createTaskStartedEvent('turn-3', '2026-02-15T04:33:00.000Z'),
					createUserEvent('user-3', '2026-02-15T04:33:01.000Z', 'turn-3'),
					createReasoningEvent('reasoning-3-a', 'turn-3'),
					createAgentEvent('agent-3-a', 'turn-3'),
					createAgentEvent('agent-3-b', 'turn-3'),
					createReasoningEvent('ignored-unmatched-turn', 'turn-x'),
					createTaskCompleteEvent('turn-3', '2026-02-15T04:33:30.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 3);
			assert.strictEqual(index.turns[0].taskTurnId, 'turn-3');
			assert.deepStrictEqual(index.turns[0].agentMessages, ['agent-3-a', 'agent-3-b']);
			assert.deepStrictEqual(index.turns[0].reasoningMessages, ['reasoning-3-a']);
			assert.deepStrictEqual(
				index.turns[0].aiTimeline?.map((item) => `${item.kind}:${item.message}`),
				['reasoning:reasoning-3-a', 'assistant:agent-3-a', 'assistant:agent-3-b'],
			);
			assert.strictEqual(index.turns[1].taskTurnId, 'turn-2');
			assert.deepStrictEqual(index.turns[1].agentMessages, []);
			assert.deepStrictEqual(index.turns[1].reasoningMessages, []);
			assert.strictEqual(index.turns[2].taskTurnId, 'turn-1');
			assert.deepStrictEqual(index.turns[2].agentMessages, [
				'agent-1-a',
				'agent-1-b',
			]);
			assert.deepStrictEqual(index.turns[2].reasoningMessages, [
				'reasoning-1-a',
				'reasoning-1-b',
			]);
		});
	});

	test('buildHistoryIndex resolves events without turn_id to the active task', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-missing-turn-id.jsonl'),
				[
					createTaskStartedEvent('turn-1', '2026-02-15T04:31:00.000Z'),
					createUserEventWithoutTurnId('user-1', '2026-02-15T04:31:01.000Z'),
					createReasoningEventWithoutTurnId('reasoning-1-a'),
					createAgentEventWithoutTurnId('agent-1-a'),
					createTaskCompleteEvent('turn-1', '2026-02-15T04:31:30.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.strictEqual(index.turns[0].taskTurnId, 'turn-1');
			assert.strictEqual(index.turns[0].userMessage, 'user-1');
			assert.deepStrictEqual(index.turns[0].agentMessages, ['agent-1-a']);
			assert.deepStrictEqual(index.turns[0].reasoningMessages, ['reasoning-1-a']);
		});
	});

	test('buildHistoryIndex finalizes active task even when task_complete is missing', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-no-task-complete.jsonl'),
				[
					createTaskStartedEvent('turn-1', '2026-02-15T04:31:00.000Z'),
					createUserEvent('user-1', '2026-02-15T04:31:01.000Z', 'turn-1'),
					createReasoningEvent('reasoning-1', 'turn-1', '2026-02-15T04:31:02.000Z'),
					createAgentEvent('agent-1', 'turn-1', '2026-02-15T04:31:03.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.strictEqual(index.turns[0].taskTurnId, 'turn-1');
			assert.strictEqual(index.turns[0].userMessage, 'user-1');
			assert.deepStrictEqual(index.turns[0].reasoningMessages, ['reasoning-1']);
			assert.deepStrictEqual(index.turns[0].agentMessages, ['agent-1']);
		});
	});

	test('buildHistoryIndex does not treat assistant output_text response_item as reasoning', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-no-duplicate-reasoning.jsonl'),
				[
					createTaskStartedEvent('turn-1', '2026-02-15T04:31:00.000Z'),
					createUserEvent('user-1', '2026-02-15T04:31:01.000Z', 'turn-1'),
					createAssistantMessageResponseItem('agent-1-a', 'turn-1'),
					createAgentEvent('agent-1-a', 'turn-1'),
					createReasoningEvent('reasoning-1-a', 'turn-1'),
					createTaskCompleteEvent('turn-1', '2026-02-15T04:31:30.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.deepStrictEqual(index.turns[0].agentMessages, ['agent-1-a']);
			assert.deepStrictEqual(index.turns[0].reasoningMessages, ['reasoning-1-a']);
		});
	});

	test('buildHistoryIndex keeps local time per each message', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-message-times.jsonl'),
				[
					createTaskStartedEvent('turn-1', '2026-02-15T04:31:00.000Z'),
					createUserEvent('user-1', '2026-02-15T04:31:01.000Z', 'turn-1'),
					createReasoningEvent(
						'reasoning-1-a',
						'turn-1',
						'2026-02-15T04:31:02.000Z',
					),
					createAgentEvent('agent-1-a', 'turn-1', '2026-02-15T04:31:03.000Z'),
					createTaskCompleteEvent('turn-1', '2026-02-15T04:31:30.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.strictEqual(
				index.turns[0].userMessageLocalTime,
				formatLocalTime('2026-02-15T04:31:01.000Z'),
			);
			assert.deepStrictEqual(index.turns[0].reasoningMessageLocalTimes, [
				formatLocalTime('2026-02-15T04:31:02.000Z'),
			]);
			assert.deepStrictEqual(index.turns[0].agentMessageLocalTimes, [
				formatLocalTime('2026-02-15T04:31:03.000Z'),
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
				[
					createTaskStartedEvent('turn-no-user', '2026-02-15T05:00:00.000Z'),
					createAgentEvent('orphan', 'turn-no-user'),
					createTaskCompleteEvent('turn-no-user', '2026-02-15T05:00:01.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 0);
			assert.strictEqual(index.days.length, 0);
		});
	});

	test('buildHistoryIndex keeps multiple assistant and reasoning messages in the same task', () => {
		withTempDir((root) => {
			const codexHome = path.join(root, '.codex');
			const sessionsRoot = resolveSessionsRoot(codexHome);
			writeJsonl(
				path.join(sessionsRoot, '2026', '02', '15', 'rollout-multi.jsonl'),
				[
					createTaskStartedEvent('turn-multi', '2026-02-15T10:00:00.000Z'),
					createUserEvent('same message', '2026-02-15T10:00:01.000Z', 'turn-multi'),
					createReasoningEvent('same reasoning', 'turn-multi'),
					createReasoningEvent('same reasoning', 'turn-multi'),
					createAgentEvent('answer', 'turn-multi'),
					createAgentEvent('answer', 'turn-multi'),
					createTaskCompleteEvent('turn-multi', '2026-02-15T10:00:02.000Z'),
				],
			);

			const index = buildHistoryIndex(codexHome);
			assert.strictEqual(index.turns.length, 1);
			assert.deepStrictEqual(index.turns[0].agentMessages, ['answer', 'answer']);
			assert.deepStrictEqual(index.turns[0].reasoningMessages, [
				'same reasoning',
				'same reasoning',
			]);
		});
	});

});
