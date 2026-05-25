import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';

type CodexStatusWindow = {
	usedPercent?: unknown;
	windowDurationMins?: unknown;
	resetsAt?: unknown;
};

type CodexStatusRateLimits = {
	primary?: CodexStatusWindow | null;
	secondary?: CodexStatusWindow | null;
};

type JsonRpcEnvelope = {
	id?: unknown;
	method?: unknown;
	result?: unknown;
	params?: unknown;
	error?: unknown;
};

type RateLimitReadState = {
	initializeCompleted: boolean;
	initializedSent: boolean;
	accountReadRequested: boolean;
	accountReadCompleted: boolean;
	rateLimitsRequested: boolean;
};

export type PetRateLimitWindow = {
	label: string;
	windowDurationMins: number;
	usedPercent: number;
	remainingPercent: number;
	resetAtLabel: string;
	isWarning: boolean;
};

export type PetRateLimitSnapshot = {
	windows: PetRateLimitWindow[];
};

function toWindowLabel(windowDurationMins: number): string | undefined {
	if (!Number.isFinite(windowDurationMins) || windowDurationMins <= 0) {
		return undefined;
	}
	if (windowDurationMins % 10080 === 0) {
		return `${windowDurationMins / 10080}w`;
	}
	if (windowDurationMins % 1440 === 0) {
		return `${windowDurationMins / 1440}d`;
	}
	if (windowDurationMins % 60 === 0) {
		return `${windowDurationMins / 60}h`;
	}
	return `${windowDurationMins}m`;
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(100, Math.max(0, value));
}

function formatResetAt(unixSeconds: number): string {
	if (!Number.isFinite(unixSeconds)) {
		return '--/-- --:--';
	}
	const date = new Date(unixSeconds * 1000);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${month}/${day} ${hours}:${minutes}`;
}

function normalizeWindow(
	window: CodexStatusWindow | null | undefined,
): PetRateLimitWindow | undefined {
	if (!window) {
		return undefined;
	}
	const windowDurationMins =
		typeof window.windowDurationMins === 'number'
			? window.windowDurationMins
			: NaN;
	const label = toWindowLabel(windowDurationMins);
	if (!label) {
		return undefined;
	}
	const usedPercent = clampPercent(
		typeof window.usedPercent === 'number' ? window.usedPercent : NaN,
	);
	const remainingPercent = clampPercent(100 - usedPercent);
	const resetsAt =
		typeof window.resetsAt === 'number' ? window.resetsAt : NaN;
	return {
		label,
		windowDurationMins,
		usedPercent,
		remainingPercent,
		resetAtLabel: formatResetAt(resetsAt),
		isWarning: remainingPercent <= 25,
	};
}

export function mapCodexStatusToPetRateLimits(
	payload: unknown,
): PetRateLimitSnapshot | undefined {
	const source =
		payload && typeof payload === 'object' && 'rateLimits' in payload
			? payload
			: payload && typeof payload === 'object' && 'params' in payload
				? (payload as { params?: unknown }).params
				: payload;
	if (!source || typeof source !== 'object') {
		return undefined;
	}
	const rateLimits = (source as { rateLimits?: CodexStatusRateLimits }).rateLimits;
	if (!rateLimits) {
		return undefined;
	}
	const windows = [
		normalizeWindow(rateLimits.primary),
		normalizeWindow(rateLimits.secondary),
	].filter((window): window is PetRateLimitWindow => Boolean(window));

	if (windows.length === 0) {
		return undefined;
	}

	return {
		windows: windows.sort(
			(left, right) => left.windowDurationMins - right.windowDurationMins,
		),
	};
}

function readJsonLines(stdout: string): JsonRpcEnvelope[] {
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as JsonRpcEnvelope];
			} catch {
				return [];
			}
		});
}

function canUseCommandCandidate(candidate: string): boolean {
	return !path.isAbsolute(candidate) || fs.existsSync(candidate);
}

function getCodexCommandCandidates(): string[] {
	const candidates = new Set<string>();
	candidates.add('codex');

	if (process.platform === 'win32') {
		candidates.add('codex.cmd');
		candidates.add('codex.exe');

		const appData = process.env.APPDATA;
		if (appData) {
			candidates.add(path.join(appData, 'npm', 'codex.cmd'));
			candidates.add(path.join(appData, 'npm', 'codex.exe'));
		}
	}

	return [...candidates].filter(canUseCommandCandidate);
}

function shouldUseShell(command: string): boolean {
	if (process.platform !== 'win32') {
		return false;
	}
	const extension = path.extname(command).toLowerCase();
	return extension === '.cmd' || extension === '.bat';
}

function spawnCodexProcess(command: string): ChildProcessWithoutNullStreams {
	return spawn(command, ['app-server'], {
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
		shell: shouldUseShell(command),
	});
}

function writeJsonLine(
	child: ChildProcessWithoutNullStreams,
	payload: Record<string, unknown>,
): void {
	child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function processMessages(
	child: ChildProcessWithoutNullStreams,
	messages: JsonRpcEnvelope[],
	state: RateLimitReadState,
	finish: (snapshot?: PetRateLimitSnapshot) => void,
	stopTimers: () => void,
): boolean {
	for (const message of messages) {
		if (message.id === 1 && message.result && !state.initializeCompleted) {
			state.initializeCompleted = true;
		}

		if (state.initializeCompleted && !state.initializedSent) {
			state.initializedSent = true;
			writeJsonLine(child, {
				method: 'initialized',
				params: {},
			});
		}

		if (state.initializedSent && !state.accountReadRequested) {
			state.accountReadRequested = true;
			writeJsonLine(child, {
				id: 2,
				method: 'account/read',
				params: {
					refreshToken: true,
				},
			});
		}

		if (message.id === 2 && message.result && !state.accountReadCompleted) {
			state.accountReadCompleted = true;
		}

		if (state.accountReadCompleted && !state.rateLimitsRequested) {
			state.rateLimitsRequested = true;
			writeJsonLine(child, {
				id: 3,
				method: 'account/rateLimits/read',
				params: {},
			});
		}

		if (message.method === 'account/rateLimits/updated' && message.params) {
			const snapshot = mapCodexStatusToPetRateLimits(message.params);
			if (snapshot) {
				stopTimers();
				child.kill();
				finish(snapshot);
				return true;
			}
		}

		if (message.id === 3) {
			stopTimers();
			child.kill();
			finish(message.result ? mapCodexStatusToPetRateLimits(message.result) : undefined);
			return true;
		}
	}

	return false;
}

export async function readPetRateLimits(): Promise<PetRateLimitSnapshot | undefined> {
	return new Promise((resolve) => {
		const commandCandidates = getCodexCommandCandidates();

		const launch = (index: number) => {
			const command = commandCandidates[index] ?? 'codex';
			let child: ChildProcessWithoutNullStreams;
			try {
				child = spawnCodexProcess(command);
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if ((code === 'ENOENT' || code === 'EACCES' || code === 'EINVAL') && index + 1 < commandCandidates.length) {
					launch(index + 1);
					return;
				}
				resolve(undefined);
				return;
			}

			let stdout = '';
			let settled = false;
			let abandoned = false;
			const state: RateLimitReadState = {
				initializeCompleted: false,
				initializedSent: false,
				accountReadRequested: false,
				accountReadCompleted: false,
				rateLimitsRequested: false,
			};

			const finish = (snapshot?: PetRateLimitSnapshot) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(snapshot);
			};

			const stopTimers = () => {
				clearTimeout(closeInputTimer);
				clearTimeout(killTimer);
			};

			const closeInputTimer = setTimeout(() => {
				child.stdin.end();
			}, 15000);
			const killTimer = setTimeout(() => {
				child.kill();
				finish(undefined);
			}, 15000);

			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				stdout += chunk;
				processMessages(
					child,
					readJsonLines(stdout),
					state,
					finish,
					stopTimers,
				);
			});

			child.on('error', (error) => {
				stopTimers();
				const code = (error as NodeJS.ErrnoException).code;
				if ((code === 'ENOENT' || code === 'EACCES' || code === 'EINVAL') && index + 1 < commandCandidates.length) {
					abandoned = true;
					launch(index + 1);
					return;
				}
				finish(undefined);
			});

			child.on('close', () => {
				if (abandoned || settled) {
					return;
				}
				stopTimers();
				const messages = readJsonLines(stdout);
				const response = messages.find((message) => message.id === 3);
				finish(
					response?.result
						? mapCodexStatusToPetRateLimits(response.result)
						: undefined,
				);
			});

			writeJsonLine(child, {
				id: 1,
				method: 'initialize',
				params: {
					clientInfo: {
						name: 'PetExplore',
						title: 'Codex Pet Explore',
						version: '0.1.0',
					},
					capabilities: {},
				},
			});
		};

		launch(0);
	});
}
