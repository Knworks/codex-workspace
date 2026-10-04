import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Tests opt into CODEX_HOME explicitly instead of inheriting the user's runtime home.
	env: { CODEX_HOME: '' },
});
