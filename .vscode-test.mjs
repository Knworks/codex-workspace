import { defineConfig } from '@vscode/test-cli';
import net from 'node:net';

// Reserve a local debug port so Playwright can exercise the real Webview.
const debugPort = await new Promise((resolve, reject) => {
	const server = net.createServer();
	server.once('error', reject);
	server.listen(0, '127.0.0.1', () => {
		const port = server.address().port;
		server.close((error) => error ? reject(error) : resolve(port));
	});
});

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Keep temporary-home fixtures independent of the launching environment.
	env: { CODEX_HOME: '', AGENT_WEBVIEW_DEBUG_PORT: String(debugPort) },
	launchArgs: [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'],
});
