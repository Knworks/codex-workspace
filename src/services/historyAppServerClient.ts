import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createRequire } from 'module';

export interface HistoryThreadClient {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	dispose(): void;
}

export class HistoryApiError extends Error {
	constructor(message: string, readonly code?: number | string) {
		super(message);
	}
}

export function isHistoryApiUnsupported(error: unknown): boolean {
	return error instanceof HistoryApiError && error.code === -32601;
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

/** npm's launcher spawns its native child without windowsHide. Bypass it on Windows. */
export function resolveCodexCommand(
	searchPath = process.env.PATH ?? '',
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): { command: string; args: string[] } {
	for (const entry of searchPath.split(platform === 'win32' ? ';' : path.delimiter)) {
		const directory = entry.replace(/^"(.*)"$/, '$1');
		if (!directory) { continue; }
		const native = path.join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
		if (fs.existsSync(native)) {
			return { command: native, args: ['app-server'] };
		}
		const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
		if (fs.existsSync(script)) {
			if (platform === 'win32') {
				const target = arch === 'x64' ? 'x86_64-pc-windows-msvc'
					: arch === 'arm64' ? 'aarch64-pc-windows-msvc' : undefined;
				if (!target) { continue; }
				let vendorRoot: string;
				try {
					const manifest = createRequire(script).resolve(`@openai/codex-win32-${arch}/package.json`);
					vendorRoot = path.join(path.dirname(manifest), 'vendor');
				} catch {
					vendorRoot = path.resolve(path.dirname(script), '..', 'vendor');
				}
				// Current packages use bin/; older packages used codex/.
				for (const subdirectory of ['bin', 'codex']) {
					const binary = path.join(vendorRoot, target, subdirectory, 'codex.exe');
					if (fs.existsSync(binary)) {
						return { command: binary, args: ['app-server'] };
					}
				}
				continue;
			}
			return { command: process.execPath, args: [script, 'app-server'] };
		}
	}
	return { command: 'codex', args: ['app-server'] };
}

export class HistoryAppServerClient implements HistoryThreadClient {
	private readonly pending = new Map<number, PendingRequest>();
	private nextId = 1;
	private closed = false;
	private readonly lines: readline.Interface;

	constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly timeoutMs = 15000) {
		this.lines = readline.createInterface({ input: child.stdout });
		this.lines.on('line', (line) => this.receive(line));
		// Drain diagnostics without retaining potentially sensitive config or message content.
		child.stderr.resume();
		child.stdin.on('error', () => this.close(new HistoryApiError('Codex App Server input closed.')));
		child.on('error', (error: NodeJS.ErrnoException) => {
			this.close(new HistoryApiError('Unable to start Codex App Server.', error.code));
		});
		child.on('close', () => this.close(new HistoryApiError('Codex App Server exited.')));
	}

	async initialize(): Promise<void> {
		await this.request('initialize', {
			clientInfo: { name: 'codex_workspace_history', version: '1.0.0' },
			capabilities: { experimentalApi: true },
		});
		this.child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
	}

	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (this.closed) {
			return Promise.reject(new HistoryApiError('Codex App Server is closed.'));
		}
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new HistoryApiError(`Codex App Server timed out: ${method}`));
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
				if (error) {
					this.close(new HistoryApiError('Unable to write to Codex App Server.'));
				}
			});
		});
	}

	private receive(line: string): void {
		let envelope: { id?: number; result?: unknown; error?: { code?: number; message?: string } };
		try {
			envelope = JSON.parse(line);
		} catch {
			this.close(new HistoryApiError('Invalid JSON from Codex App Server.'));
			return;
		}
		if (!envelope || typeof envelope !== 'object' || typeof envelope.id !== 'number') {
			return;
		}
		const pending = this.pending.get(envelope.id);
		if (!pending) {
			return;
		}
		this.pending.delete(envelope.id);
		clearTimeout(pending.timer);
		if (envelope.error) {
			pending.reject(new HistoryApiError(envelope.error.message ?? 'Codex App Server request failed.', envelope.error.code));
		} else if ('result' in envelope) {
			pending.resolve(envelope.result);
		} else {
			pending.reject(new HistoryApiError('Invalid response from Codex App Server.'));
		}
	}

	private close(error: Error): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.lines.close();
	}

	dispose(): void {
		this.close(new HistoryApiError('Codex history request cancelled.'));
		// EOF shuts down app-server and its npm launcher; killing only the launcher can orphan it.
		this.child.stdin.end();
		const timer = setTimeout(() => this.child.kill(), 1000);
		timer.unref();
		this.child.once('close', () => clearTimeout(timer));
	}
}

export async function createHistoryThreadClient(codexHomeDir: string): Promise<HistoryThreadClient> {
	const { command, args } = resolveCodexCommand();
	const child = spawn(command, args, {
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
		env: { ...process.env, CODEX_HOME: codexHomeDir, ELECTRON_RUN_AS_NODE: '1' },
	});
	const client = new HistoryAppServerClient(child);
	try {
		await client.initialize();
		return client;
	} catch (error) {
		client.dispose();
		throw error;
	}
}
