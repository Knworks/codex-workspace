import { spawn } from 'child_process';

type CodexStatusWindow = {
	usedPercent?: unknown;
	windowDurationMins?: unknown;
	resetsAt?: unknown;
};

type CodexStatusRateLimits = {
	primary?: CodexStatusWindow | null;
	secondary?: CodexStatusWindow | null;
};

export type PetRateLimitWindow = {
	label: '5h' | '1w';
	usedPercent: number;
	remainingPercent: number;
	resetAtLabel: string;
	isWarning: boolean;
};

export type PetRateLimitSnapshot = {
	windows: PetRateLimitWindow[];
};

function toWindowLabel(windowDurationMins: number): '5h' | '1w' | undefined {
	if (windowDurationMins === 300) {
		return '5h';
	}
	if (windowDurationMins === 10080) {
		return '1w';
	}
	return undefined;
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

function normalizeWindow(window: CodexStatusWindow | null | undefined): PetRateLimitWindow | undefined {
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
		usedPercent,
		remainingPercent,
		resetAtLabel: formatResetAt(resetsAt),
		isWarning: remainingPercent <= 25,
	};
}

export function mapCodexStatusToPetRateLimits(
	payload: unknown,
): PetRateLimitSnapshot | undefined {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}
	const rateLimits = (payload as { rateLimits?: CodexStatusRateLimits }).rateLimits;
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
		windows: windows.sort((left, right) => left.label.localeCompare(right.label)),
	};
}

function readJsonLines(stdout: string): unknown[] {
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
}

export async function readPetRateLimits(): Promise<PetRateLimitSnapshot | undefined> {
	return new Promise((resolve) => {
		const child = spawn('codex', ['app-server'], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let settled = false;

		const finish = (snapshot?: PetRateLimitSnapshot) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(snapshot);
		};

		const closeInputTimer = setTimeout(() => {
			child.stdin.end();
		}, 800);
		const killTimer = setTimeout(() => {
			child.kill();
			finish(undefined);
		}, 5000);

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
			const messages = readJsonLines(stdout);
			const response = messages.find(
				(message) =>
					typeof message === 'object'
					&& message !== null
					&& (message as { id?: unknown }).id === 3,
			) as { result?: unknown } | undefined;
			if (response?.result) {
				clearTimeout(closeInputTimer);
				clearTimeout(killTimer);
				child.kill();
				finish(mapCodexStatusToPetRateLimits(response.result));
			}
		});

		child.on('error', () => {
			clearTimeout(closeInputTimer);
			clearTimeout(killTimer);
			finish(undefined);
		});

		child.on('close', () => {
			clearTimeout(closeInputTimer);
			clearTimeout(killTimer);
			if (settled) {
				return;
			}
			const messages = readJsonLines(stdout);
			const response = messages.find(
				(message) =>
					typeof message === 'object'
					&& message !== null
					&& (message as { id?: unknown }).id === 3,
			) as { result?: unknown } | undefined;
			finish(response?.result ? mapCodexStatusToPetRateLimits(response.result) : undefined);
		});

		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					clientInfo: {
						name: 'PetExplore',
						version: '0.1.0',
					},
					capabilities: null,
				},
			})}\n`,
		);
		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'account/read',
				params: {
					refreshToken: false,
				},
			})}\n`,
		);
		child.stdin.write(
			`${JSON.stringify({
				jsonrpc: '2.0',
				id: 3,
				method: 'account/rateLimits/read',
				params: {},
			})}\n`,
		);
	});
}
