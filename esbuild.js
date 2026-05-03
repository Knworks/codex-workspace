const esbuild = require("esbuild");
const path = require('node:path');
const fs = require('node:fs/promises');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const codiconSourceDir = path.resolve(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
const codiconIconSourceDir = path.resolve(__dirname, 'node_modules', '@vscode', 'codicons', 'src', 'icons');
const codiconDistDir = path.resolve(__dirname, 'dist', 'webview', 'codicons');
const codiconAssetNames = ['codicon.css', 'codicon.ttf'];
const codiconIconNames = ['agent', 'history', 'hubot', 'mcp', 'server', 'sparkle', 'terminal'];

async function copyWebviewAssets() {
	await fs.mkdir(codiconDistDir, { recursive: true });
	for (const assetName of codiconAssetNames) {
		const from = path.join(codiconSourceDir, assetName);
		const to = path.join(codiconDistDir, assetName);
		await fs.copyFile(from, to);
	}
	const codiconIconDistDir = path.join(codiconDistDir, 'icons');
	await fs.mkdir(codiconIconDistDir, { recursive: true });
	const themedIconDirs = {
		light: path.join(codiconIconDistDir, 'light'),
		dark: path.join(codiconIconDistDir, 'dark'),
	};
	await fs.mkdir(themedIconDirs.light, { recursive: true });
	await fs.mkdir(themedIconDirs.dark, { recursive: true });
	for (const iconName of codiconIconNames) {
		const from = path.join(codiconIconSourceDir, `${iconName}.svg`);
		const to = path.join(codiconIconDistDir, `${iconName}.svg`);
		await fs.copyFile(from, to);
		const svg = await fs.readFile(from, 'utf8');
		await fs.writeFile(
			path.join(themedIconDirs.light, `${iconName}.svg`),
			svg.replace(/fill="currentColor"/g, 'fill="#000000"'),
			'utf8',
		);
		await fs.writeFile(
			path.join(themedIconDirs.dark, `${iconName}.svg`),
			svg.replace(/fill="currentColor"/g, 'fill="#ffffff"'),
			'utf8',
		);
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
