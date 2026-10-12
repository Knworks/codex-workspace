import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Keep temporary-home fixtures independent of the launching environment.
	env: { CODEX_HOME: '' },
});
