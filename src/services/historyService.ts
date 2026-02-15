import fs from 'fs';
import os from 'os';
import path from 'path';

type RecordLike = Record<string, unknown>;

export type HistoryAiTimelineItem = {
	kind: 'assistant' | 'reasoning';
	message: string;
	localTime: string;
	sortTimestampMs: number;
	sequence: number;
};

export type HistoryTurnRecord = {
	turnId: string;
	sessionId: string;
	filePath: string;
	taskTurnId?: string;
	year: string;
	month: string;
	day: string;
	dateKey: string;
	localTime: string;
	sortTimestampMs: number;
	userMessage: string;
	userMessageLocalTime?: string;
	agentMessages: string[];
	agentMessageLocalTimes?: string[];
	agentMessageTimestampMs?: number[];
	reasoningMessages: string[];
	reasoningMessageLocalTimes?: string[];
	reasoningMessageTimestampMs?: number[];
	aiTimeline?: HistoryAiTimelineItem[];
};

export type HistoryDayNode = {
	dateKey: string;
	year: string;
	month: string;
	day: string;
	turns: HistoryTurnRecord[];
};

export type HistoryIndex = {
	days: HistoryDayNode[];
	turns: HistoryTurnRecord[];
};

const ROLLOUT_FILE_PATTERN = /^rollout-.*\.jsonl$/;

function isRecordLike(value: unknown): value is RecordLike {
	return typeof value === 'object' && value !== null;
}

function toTimestampMs(input: unknown): number | undefined {
	if (typeof input === 'number' && Number.isFinite(input)) {
		return input;
	}
	if (typeof input !== 'string') {
		return undefined;
	}
	const parsed = Date.parse(input);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function compareLabelDesc(a: string, b: string): number {
	return b.localeCompare(a, undefined, { numeric: true });
}

function compareTurnDesc(left: HistoryTurnRecord, right: HistoryTurnRecord): number {
	if (right.sortTimestampMs !== left.sortTimestampMs) {
		return right.sortTimestampMs - left.sortTimestampMs;
	}
	return right.turnId.localeCompare(left.turnId);
}

function collectRolloutFileEntries(
	sessionsRoot: string,
): Array<{ filePath: string; year: string; month: string; day: string }> {
	if (!fs.existsSync(sessionsRoot)) {
		return [];
	}

	const entries: Array<{ filePath: string; year: string; month: string; day: string }> = [];

	const walk = (currentDir: string): void => {
		for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (!entry.isFile() || !ROLLOUT_FILE_PATTERN.test(entry.name)) {
				continue;
			}
			const relative = path.relative(sessionsRoot, fullPath);
			const segments = relative.split(path.sep);
			if (segments.length !== 4) {
				continue;
			}
			const [year, month, day] = segments;
			if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
				continue;
			}
			entries.push({ filePath: fullPath, year, month, day });
		}
	};

	walk(sessionsRoot);
	return entries;
}

function readRolloutEvents(filePath: string): Array<RecordLike> {
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const events: Array<RecordLike> = [];
	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as unknown;
			if (isRecordLike(parsed)) {
				events.push(parsed);
			}
		} catch {
			// ignore malformed lines
		}
	}
	return events;
}

function resolveSessionId(filePath: string): string {
	const baseName = path.basename(filePath, '.jsonl');
	return baseName.startsWith('rollout-')
		? baseName.slice('rollout-'.length)
		: baseName;
}

function extractText(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		const texts = value
			.map((entry) => extractText(entry))
			.filter((text): text is string => Boolean(text && text.length > 0));
		return texts.length > 0 ? texts.join('\n') : undefined;
	}
	if (!isRecordLike(value)) {
		return undefined;
	}
	if (typeof value.text === 'string') {
		return value.text;
	}
	if (typeof value.message === 'string') {
		return value.message;
	}
	if (typeof value.content === 'string') {
		return value.content;
	}
	if (Array.isArray(value.content)) {
		return extractText(value.content);
	}
	if (Array.isArray(value.parts)) {
		return extractText(value.parts);
	}
	return undefined;
}

function parseUserMessage(payload: RecordLike): string | undefined {
	return extractText(payload.message);
}

function parseAgentMessage(payload: RecordLike): string | undefined {
	return extractText(payload.message) ?? extractText(payload.content);
}

function parseReasoningMessage(payload: RecordLike): string | undefined {
	return (
		extractText(payload.summary) ??
		extractText(payload.content) ??
		extractText(payload.message)
	);
}

type TaskAccumulator = {
	taskTurnId: string;
	startTimestampMs: number;
	userMessage?: string;
	userMessageLocalTime?: string;
	agentMessages: string[];
	agentMessageLocalTimes: string[];
	agentMessageTimestampMs: number[];
	reasoningMessages: string[];
	reasoningMessageLocalTimes: string[];
	reasoningMessageTimestampMs: number[];
	aiTimeline: HistoryAiTimelineItem[];
	nextTimelineSequence: number;
};

function extractTurnId(event: RecordLike, payload: RecordLike | undefined): string | undefined {
	const fromEvent = event.turn_id;
	if (typeof fromEvent === 'string' && fromEvent.trim()) {
		return fromEvent;
	}
	if (payload) {
		const fromPayload = payload.turn_id;
		if (typeof fromPayload === 'string' && fromPayload.trim()) {
			return fromPayload;
		}
	}
	return undefined;
}

function parseRolloutTurns(
	filePath: string,
	year: string,
	month: string,
	day: string,
): HistoryTurnRecord[] {
	const events = readRolloutEvents(filePath);
	const sessionId = resolveSessionId(filePath);
	const turns: HistoryTurnRecord[] = [];
	const activeTasks = new Map<string, TaskAccumulator>();
	const fileStat = fs.statSync(filePath);
	let latestTurnContextId: string | undefined;

	const finalizeTask = (task: TaskAccumulator): void => {
		if (!task.userMessage) {
			return;
		}
		const sortedAiTimeline = [...task.aiTimeline].sort((left, right) => {
			if (left.sortTimestampMs !== right.sortTimestampMs) {
				return left.sortTimestampMs - right.sortTimestampMs;
			}
			return left.sequence - right.sequence;
		});
		const nextTurn: HistoryTurnRecord = {
			turnId: `${sessionId}:${task.taskTurnId}`,
			sessionId,
			filePath,
			taskTurnId: task.taskTurnId,
			year,
			month,
			day,
			dateKey: `${year}/${month}/${day}`,
			localTime: formatLocalTime(task.startTimestampMs),
			sortTimestampMs: task.startTimestampMs,
			userMessage: task.userMessage,
			userMessageLocalTime: task.userMessageLocalTime,
			agentMessages: task.agentMessages,
			agentMessageLocalTimes: task.agentMessageLocalTimes,
			agentMessageTimestampMs: task.agentMessageTimestampMs,
			reasoningMessages: task.reasoningMessages,
			reasoningMessageLocalTimes: task.reasoningMessageLocalTimes,
			reasoningMessageTimestampMs: task.reasoningMessageTimestampMs,
			aiTimeline: sortedAiTimeline,
		};
		turns.push(nextTurn);
	};

	const resolveTaskTurnId = (eventTurnId: string | undefined): string | undefined => {
		if (eventTurnId) {
			return eventTurnId;
		}
		if (latestTurnContextId && activeTasks.has(latestTurnContextId)) {
			return latestTurnContextId;
		}
		if (activeTasks.size === 1) {
			const onlyTask = activeTasks.values().next().value as TaskAccumulator | undefined;
			return onlyTask?.taskTurnId;
		}
		return undefined;
	};

	for (const event of events) {
		const payload = isRecordLike(event.payload) ? event.payload : undefined;
		const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
		const eventTurnId = extractTurnId(event, payload);

		if (event.type === 'turn_context' && eventTurnId) {
			latestTurnContextId = eventTurnId;
			continue;
		}

		if (event.type === 'event_msg' && payloadType === 'task_started' && eventTurnId) {
			const timestampMs = toTimestampMs(event.timestamp) ?? fileStat.mtimeMs;
			activeTasks.set(eventTurnId, {
				taskTurnId: eventTurnId,
				startTimestampMs: timestampMs,
				userMessage: undefined,
				userMessageLocalTime: undefined,
				agentMessages: [],
				agentMessageLocalTimes: [],
				agentMessageTimestampMs: [],
				reasoningMessages: [],
				reasoningMessageLocalTimes: [],
				reasoningMessageTimestampMs: [],
				aiTimeline: [],
				nextTimelineSequence: 0,
			});
			latestTurnContextId = eventTurnId;
			continue;
		}

		const taskTurnId = resolveTaskTurnId(eventTurnId);

		if (payloadType === 'task_complete' && taskTurnId) {
			const task = activeTasks.get(taskTurnId);
			if (task) {
				finalizeTask(task);
				activeTasks.delete(taskTurnId);
			}
			continue;
		}

		if (!taskTurnId) {
			continue;
		}
		const task = activeTasks.get(taskTurnId);
		if (!task) {
			continue;
		}

		if (event.type === 'event_msg' && payloadType === 'user_message') {
			const userMessage = parseUserMessage(payload!);
			if (userMessage && !task.userMessage) {
				task.userMessage = userMessage;
				const userTimestampMs = toTimestampMs(event.timestamp) ?? task.startTimestampMs;
				task.userMessageLocalTime = formatLocalTime(userTimestampMs);
			}
			continue;
		}

		if (event.type === 'event_msg' && payloadType === 'agent_message') {
			const agentMessage = parseAgentMessage(payload!);
			if (agentMessage) {
				task.agentMessages.push(agentMessage);
				const agentTimestampMs = toTimestampMs(event.timestamp) ?? task.startTimestampMs;
				task.agentMessageLocalTimes.push(formatLocalTime(agentTimestampMs));
				task.agentMessageTimestampMs.push(agentTimestampMs);
				task.aiTimeline.push({
					kind: 'assistant',
					message: agentMessage,
					localTime: formatLocalTime(agentTimestampMs),
					sortTimestampMs: agentTimestampMs,
					sequence: task.nextTimelineSequence,
				});
				task.nextTimelineSequence += 1;
			}
			continue;
		}

		if (event.type === 'response_item' && payloadType === 'reasoning') {
			const reasoningMessage = parseReasoningMessage(payload!);
			if (reasoningMessage) {
				task.reasoningMessages.push(reasoningMessage);
				const reasoningTimestampMs = toTimestampMs(event.timestamp) ?? task.startTimestampMs;
				task.reasoningMessageLocalTimes.push(formatLocalTime(reasoningTimestampMs));
				task.reasoningMessageTimestampMs.push(reasoningTimestampMs);
				task.aiTimeline.push({
					kind: 'reasoning',
					message: reasoningMessage,
					localTime: formatLocalTime(reasoningTimestampMs),
					sortTimestampMs: reasoningTimestampMs,
					sequence: task.nextTimelineSequence,
				});
				task.nextTimelineSequence += 1;
			}
		}
	}

	for (const task of activeTasks.values()) {
		finalizeTask(task);
	}

	return turns.sort(compareTurnDesc);
}

function toDays(turns: HistoryTurnRecord[]): HistoryDayNode[] {
	const grouped = new Map<string, HistoryTurnRecord[]>();
	for (const turn of turns) {
		const dayTurns = grouped.get(turn.dateKey) ?? [];
		dayTurns.push(turn);
		grouped.set(turn.dateKey, dayTurns);
	}

	return [...grouped.entries()]
		.sort(([left], [right]) => compareLabelDesc(left, right))
		.map(([dateKey, dayTurns]) => ({
			dateKey,
			year: dayTurns[0].year,
			month: dayTurns[0].month,
			day: dayTurns[0].day,
			turns: [...dayTurns].sort(compareTurnDesc),
		}));
}

export function resolveCodexHomeDir(homeDir: string = os.homedir()): string {
	const codexHome = process.env.CODEX_HOME;
	if (typeof codexHome === 'string' && codexHome.trim()) {
		return codexHome;
	}
	return path.join(homeDir, '.codex');
}

export function resolveSessionsRoot(codexHomeDir?: string): string {
	const baseDir = codexHomeDir ?? resolveCodexHomeDir();
	return path.join(baseDir, 'sessions');
}

export function formatLocalTime(input: string | number | Date): string {
	const date = new Date(input);
	if (Number.isNaN(date.getTime())) {
		return '[0:00:00]';
	}
	const hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `[${hours}:${minutes}:${seconds}]`;
}

export function buildHistoryIndex(codexHomeDir?: string): HistoryIndex {
	const fileEntries = collectRolloutFileEntries(resolveSessionsRoot(codexHomeDir));
	const turns = fileEntries
		.flatMap((entry) =>
			parseRolloutTurns(entry.filePath, entry.year, entry.month, entry.day),
		)
		.sort(compareTurnDesc);

	return {
		days: toDays(turns),
		turns,
	};
}
