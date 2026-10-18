import * as assert from 'assert';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HistoryAppServerClient, HistoryApiError, resolveCodexCommand } from '../services/historyAppServerClient';

suite('History App Server transport', () => {
	test('Windows bypasses npm launchers for x64, arm64 and older vendor installations', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'history-command-'));
		try {
			for (const arch of ['x64', 'arm64']) {
				for (const layout of ['optional', 'vendor']) {
					const prefix = path.join(root, `${arch}-${layout} with spaces`);
					const packageRoot = path.join(prefix, 'node_modules', '@openai', 'codex');
					const script = path.join(packageRoot, 'bin', 'codex.js');
					fs.mkdirSync(path.dirname(script), { recursive: true });
					fs.writeFileSync(script, 'throw new Error("The launcher must not run on Windows");');
					const nativeRoot = layout === 'optional'
						? path.join(prefix, 'node_modules', '@openai', `codex-win32-${arch}`) : packageRoot;
					fs.mkdirSync(nativeRoot, { recursive: true });
					fs.writeFileSync(path.join(nativeRoot, 'package.json'), '{}');
					const target = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc';
					const binary = path.join(nativeRoot, 'vendor', target, layout === 'optional' ? 'bin' : 'codex', 'codex.exe');
					fs.mkdirSync(path.dirname(binary), { recursive: true });
					fs.writeFileSync(binary, 'fixture');
					assert.deepStrictEqual(resolveCodexCommand(`"${prefix}"`, 'win32', arch), { command: binary, args: ['app-server'] });
				}
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('prefers a PATH executable and skips incomplete Windows npm installations', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'history-command-'));
		try {
			const script = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
			fs.mkdirSync(path.dirname(script), { recursive: true });
			fs.writeFileSync(script, 'fixture');
			assert.deepStrictEqual(resolveCodexCommand(root, 'win32', 'x64'), { command: 'codex', args: ['app-server'] });
			assert.deepStrictEqual(resolveCodexCommand(root, 'linux', 'x64'), { command: process.execPath, args: [script, 'app-server'] });
			const binary = path.join(root, 'codex.exe');
			fs.writeFileSync(binary, 'fixture');
			assert.deepStrictEqual(resolveCodexCommand(root, 'win32', 'x64'), { command: binary, args: ['app-server'] });
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('initializes experimental APIs and matches fragmented, interleaved JSON-RPC responses', async () => {
		const child = spawn(process.execPath, ['-e', `
			const rl = require('readline').createInterface({input:process.stdin});
			rl.on('line', line => {
				const request = JSON.parse(line);
				if (request.method === 'initialized') return;
				if (request.method === 'initialize' && !request.params.capabilities.experimentalApi) process.exit(2);
				const response = JSON.stringify({id:request.id,result:{method:request.method,text:'会話'}})+'\\n';
				setTimeout(() => {
					process.stdout.write('{"method":"notification"}\\n');
					process.stdout.write(response.slice(0,3));
					setTimeout(() => process.stdout.write(response.slice(3)), 5);
				}, request.method === 'first' ? 60 : 0);
			});
		`], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
		const client = new HistoryAppServerClient(child, 1500);
		try {
			await client.initialize();
			const results = await Promise.all([client.request('first', {}), client.request('second', {})]);
			assert.deepStrictEqual(results, [{ method: 'first', text: '会話' }, { method: 'second', text: '会話' }]);
		} finally {
			client.dispose();
		}
	});

	test('preserves unsupported-method codes for fallback decisions', async () => {
		const child = spawn(process.execPath, ['-e', `
			require('readline').createInterface({input:process.stdin}).on('line', line => {
				process.stdout.write(JSON.stringify({id:JSON.parse(line).id,error:{code:-32601,message:'unsupported'}})+'\\n');
			});
		`], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
		const client = new HistoryAppServerClient(child, 1500);
		try {
			await assert.rejects(client.request('thread/list', {}), (error: unknown) => error instanceof HistoryApiError && error.code === -32601);
		} finally {
			client.dispose();
		}
	});

	test('times out unresponsive requests and rejects pending requests when disposed', async () => {
		const child = spawn(process.execPath, ['-e', 'process.stdin.resume();'], {
			windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		});
		const client = new HistoryAppServerClient(child, 30);
		try {
			await assert.rejects(client.request('thread/list', {}), /timed out/);
			const pending = client.request('thread/list', {});
			client.dispose();
			await assert.rejects(pending, /cancelled/);
			await assert.rejects(client.request('thread/list', {}), /closed/);
		} finally {
			client.dispose();
		}
	});
});
