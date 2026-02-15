const esbuild = require("esbuild");
const path = require('node:path');
const fs = require('node:fs/promises');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const codiconSourceDir = path.resolve(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
const codiconDistDir = path.resolve(__dirname, 'dist', 'webview', 'codicons');
const codiconAssetNames = ['codicon.css', 'codicon.ttf'];

async function copyWebviewAssets() {
	await fs.mkdir(codiconDistDir, { recursive: true });
	for (const assetName of codiconAssetNames) {
		const from = path.join(codiconSourceDir, assetName);
		const to = path.join(codiconDistDir, assetName);
		await fs.copyFile(from, to);
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd(async (result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			if (result.errors.length === 0) {
				try {
					await copyWebviewAssets();
				} catch (error) {
					console.error('✘ [ERROR] Failed to copy webview assets');
					console.error(error);
				}
			}
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
