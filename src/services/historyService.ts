import fs from 'fs';
import os from 'os';
import path from 'path';

type RecordLike = Record<string, unknown>;

export type HistoryTurnRecord = {
	turnId: string;
	sessionId: string;
	filePath: string;
	year: string;
	month: string;
	day: string;
	dateKey: string;
	localTime: string;
	sortTimestampMs: number;
	userMessage: string;
	agentMessages: string[];
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

function parseRolloutTurns(
	filePath: string,
	year: string,
	month: string,
	day: string,
): HistoryTurnRecord[] {
	const events = readRolloutEvents(filePath);
	const sessionId = resolveSessionId(filePath);
	const turns: HistoryTurnRecord[] = [];
	let current:
		| {
				userMessage: string;
				sortTimestampMs: number;
				agentMessages: string[];
		  }
		| undefined;
	let currentTurnIndex = 0;

	const isDuplicateUnansweredTurn = (
		lastTurn: HistoryTurnRecord | undefined,
		nextUserMessage: string,
	): boolean =>
		Boolean(
			lastTurn &&
			lastTurn.userMessage === nextUserMessage &&
			lastTurn.agentMessages.length === 0,
		);

	const finalizeCurrent = (): void => {
		if (!current) {
			return;
		}
		const nextTurn: HistoryTurnRecord = {
			turnId: `${sessionId}:${currentTurnIndex}`,
			sessionId,
			filePath,
			year,
			month,
			day,
			dateKey: `${year}/${month}/${day}`,
			localTime: formatLocalTime(current.sortTimestampMs),
			sortTimestampMs: current.sortTimestampMs,
			userMessage: current.userMessage,
			agentMessages: current.agentMessages,
		};
		const lastTurn = turns.at(-1);
		if (
			nextTurn.agentMessages.length === 0 &&
			isDuplicateUnansweredTurn(lastTurn, nextTurn.userMessage)
		) {
			current = undefined;
			return;
		}
		turns.push(nextTurn);
		currentTurnIndex += 1;
		current = undefined;
	};

	for (const event of events) {
		if (event.type !== 'event_msg') {
			continue;
		}
		const payload = event.payload;
		if (!isRecordLike(payload) || typeof payload.type !== 'string') {
			continue;
		}

		if (payload.type === 'user_message') {
			const userMessage = parseUserMessage(payload);
			if (!userMessage) {
				continue;
			}
			const timestampMs = toTimestampMs(event.timestamp);
			if (
				current &&
				current.agentMessages.length === 0 &&
				current.userMessage === userMessage
			) {
				if (timestampMs) {
					current.sortTimestampMs = timestampMs;
				}
				continue;
			}
			finalizeCurrent();
			const fileStat = fs.statSync(filePath);
			current = {
				userMessage,
				sortTimestampMs: timestampMs ?? fileStat.mtimeMs,
				agentMessages: [],
			};
			continue;
		}

		if (payload.type === 'agent_message') {
			const agentMessage = parseAgentMessage(payload);
			if (!agentMessage || !current) {
				continue;
			}
			current.agentMessages.push(agentMessage);
		}
	}

	finalizeCurrent();
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
