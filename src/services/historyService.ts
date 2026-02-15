import fs from 'fs';
import os from 'os';
import path from 'path';

type RecordLike = Record<string, unknown>;

export type HistorySessionRecord = {
	sessionId: string;
	filePath: string;
	year: string;
	month: string;
	day: string;
	dateKey: string;
	title: string;
	localTime: string;
	sortTimestampMs: number;
	userMessages: string[];
	finalAgentMessage: string;
};

export type HistoryDayNode = {
	day: string;
	dateKey: string;
	sessions: HistorySessionRecord[];
};

export type HistoryMonthNode = {
	month: string;
	days: HistoryDayNode[];
};

export type HistoryYearNode = {
	year: string;
	months: HistoryMonthNode[];
};

export type HistoryIndex = {
	years: HistoryYearNode[];
	sessions: HistorySessionRecord[];
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

function compareSessionDesc(
	left: HistorySessionRecord,
	right: HistorySessionRecord,
): number {
	if (right.sortTimestampMs !== left.sortTimestampMs) {
		return right.sortTimestampMs - left.sortTimestampMs;
	}
	return right.filePath.localeCompare(left.filePath);
}

function collectRolloutFileEntries(
	sessionsRoot: string,
): Array<{ filePath: string; year: string; month: string; day: string }> {
	if (!fs.existsSync(sessionsRoot)) {
		return [];
	}

	const entries: Array<{
		filePath: string;
		year: string;
		month: string;
		day: string;
	}> = [];

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

function parseRolloutSessionRecord(
	filePath: string,
	year: string,
	month: string,
	day: string,
): HistorySessionRecord | undefined {
	const events = readRolloutEvents(filePath);
	const userMessages: string[] = [];
	let title: string | undefined;
	let firstUserTimestampMs: number | undefined;
	let finalAgentMessage = '';

	for (const event of events) {
		if (event.type !== 'event_msg') {
			continue;
		}
		const payload = event.payload;
		if (!isRecordLike(payload) || typeof payload.type !== 'string') {
			continue;
		}

		if (payload.type === 'user_message' && typeof payload.message === 'string') {
			userMessages.push(payload.message);
			if (!title) {
				title = payload.message;
				firstUserTimestampMs = toTimestampMs(event.timestamp);
			}
			continue;
		}

		if (
			payload.type === 'task_complete' &&
			typeof payload.last_agent_message === 'string'
		) {
			finalAgentMessage = payload.last_agent_message;
		}
	}

	if (!title) {
		return undefined;
	}

	const fileStat = fs.statSync(filePath);
	const sortTimestampMs = firstUserTimestampMs ?? fileStat.mtimeMs;
	return {
		sessionId: resolveSessionId(filePath),
		filePath,
		year,
		month,
		day,
		dateKey: `${year}/${month}/${day}`,
		title,
		localTime: formatLocalTime(sortTimestampMs),
		sortTimestampMs,
		userMessages,
		finalAgentMessage,
	};
}

function toHistoryTree(records: HistorySessionRecord[]): HistoryYearNode[] {
	const tree = new Map<
		string,
		Map<string, Map<string, HistorySessionRecord[]>>
	>();

	for (const record of records) {
		const byMonth = tree.get(record.year) ?? new Map<string, Map<string, HistorySessionRecord[]>>();
		const byDay = byMonth.get(record.month) ?? new Map<string, HistorySessionRecord[]>();
		const sessions = byDay.get(record.day) ?? [];
		sessions.push(record);
		byDay.set(record.day, sessions);
		byMonth.set(record.month, byDay);
		tree.set(record.year, byMonth);
	}

	return [...tree.entries()]
		.sort(([left], [right]) => compareLabelDesc(left, right))
		.map(([year, byMonth]) => ({
			year,
			months: [...byMonth.entries()]
				.sort(([left], [right]) => compareLabelDesc(left, right))
				.map(([month, byDay]) => ({
					month,
					days: [...byDay.entries()]
						.sort(([left], [right]) => compareLabelDesc(left, right))
						.map(([day, sessions]) => ({
							day,
							dateKey: `${year}/${month}/${day}`,
							sessions: [...sessions].sort(compareSessionDesc),
						})),
				})),
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
	const sessions = fileEntries
		.map((entry) =>
			parseRolloutSessionRecord(
				entry.filePath,
				entry.year,
				entry.month,
				entry.day,
			),
		)
		.filter((entry): entry is HistorySessionRecord => Boolean(entry))
		.sort(compareSessionDesc);

	return {
		years: toHistoryTree(sessions),
		sessions,
	};
}
