import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'toml';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';
import { resolveCodexPaths } from './workspaceStatus';

export type PluginStatus = 'enabled' | 'disabled' | 'readonly' | 'needs-review';

export type PluginCapability = {
	name: string;
};

export type PluginMarketplaceSource = {
	path?: string;
	repository?: string;
	url?: string;
	type?: string;
};

export type PluginMarketplaceRecord = {
	name: string;
	marketplace: string;
	marketplacePath: string;
	source?: PluginMarketplaceSource;
};

export type PluginSkillRecord = {
	name: string;
	description: string;
	skillPath: string;
	pluginId: string;
	pluginDisplayName: string;
	enabled: boolean;
	unsafePath: boolean;
};

export type PluginMcpRecord = {
	name: string;
	type: string;
	command?: string;
	url?: string;
	envKeys: string[];
	hasToolFilters: boolean;
	required?: boolean;
	definitionPath: string;
	pluginId: string;
	pluginDisplayName: string;
	enabled: boolean;
	unsafePath: boolean;
	conflict: boolean;
};

export type PluginAppRecord = {
	name: string;
	description: string;
	definitionPath: string;
	pluginId: string;
	pluginDisplayName: string;
	enabled: boolean;
	unsafePath: boolean;
};

export type PluginAgentRecord = {
	name: string;
	description: string;
	model?: string;
	reasoning?: string;
	sandbox?: string;
	mcpServers: string[];
	skillConfigCount: number;
	definitionPath: string;
	pluginId: string;
	pluginDisplayName: string;
	enabled: boolean;
	unsafePath: boolean;
	error?: string;
};

export type PluginRecord = {
	id: string;
	name: string;
	displayName: string;
	description: string;
	longDescription: string;
	version: string;
	developer: string;
	marketplace: string;
	marketplacePath?: string;
	source?: PluginMarketplaceSource;
	homepage?: string;
	repository?: string;
	license?: string;
	keywords: string[];
	capabilities: PluginCapability[];
	defaultPrompt?: string;
	brandColor?: string;
	logoPath?: string;
	manifestPath: string;
	installedPath: string;
	status: PluginStatus;
	enabled: boolean;
	toggleDisabled: boolean;
	errors: string[];
	warnings: string[];
	skills: PluginSkillRecord[];
	mcpServers: PluginMcpRecord[];
	apps: PluginAppRecord[];
	agents: PluginAgentRecord[];
	searchText: string;
};

type DiscoveryOptions = {
	homeDir?: string;
	projectRoot?: string;
	configPath?: string;
	normalMcpIds?: Set<string>;
};

type Manifest = Record<string, unknown>;

const PLUGIN_CONFIG_HEADER_PATTERN =
	/^\s*\[plugins\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_.@/-]+))\]\s*$/;
const ENABLED_PATTERN = /^(\s*enabled\s*=\s*)(true|false)(\s*#.*)?$/i;
const SECRET_KEY_PATTERN = /(secret|token|bearer|oauth|password|passwd|api[_-]?key|access[_-]?key)/i;

export function listPluginRecords(options: DiscoveryOptions = {}): PluginRecord[] {
	const homeDir = options.homeDir ?? os.homedir();
	const projectRoot = options.projectRoot;
	const configPath = options.configPath ?? resolveCodexPaths(homeDir).configPath;
	const configState = readPluginConfigState(configPath);
	const marketplaceRecords = readMarketplaceRecords(homeDir, projectRoot);
	const marketplaceByName = new Map<string, PluginMarketplaceRecord>();
	for (const record of marketplaceRecords) {
		marketplaceByName.set(`${record.marketplace}:${record.name}`, record);
		if (!marketplaceByName.has(record.name)) {
			marketplaceByName.set(record.name, record);
		}
	}

	return findInstalledPluginRoots(homeDir)
		.map((entry) =>
			readPluginRecord(entry, marketplaceByName, configState, options.normalMcpIds ?? new Set()),
		)
		.sort((left, right) =>
			left.displayName.localeCompare(right.displayName, undefined, {
				numeric: true,
				sensitivity: 'base',
			}),
		);
}

export function listPluginSkillRecords(options: DiscoveryOptions = {}): PluginSkillRecord[] {
	return listPluginRecords(options).flatMap((plugin) => plugin.skills);
}

export function listPluginMcpRecords(options: DiscoveryOptions = {}): PluginMcpRecord[] {
	return listPluginRecords(options).flatMap((plugin) => plugin.mcpServers);
}

export function listPluginAgentRecords(options: DiscoveryOptions = {}): PluginAgentRecord[] {
	return listPluginRecords(options).flatMap((plugin) => plugin.agents);
}

export function readPluginConfigEnabledById(configPath: string): Map<string, boolean> {
	return readPluginConfigState(configPath).enabledById;
}

export function canWritePluginConfig(configPath: string): boolean {
	try {
		if (!fs.existsSync(configPath)) {
			return true;
		}
		parseToml(fs.readFileSync(configPath, 'utf8'));
		return true;
	} catch {
		return false;
	}
}

export function setPluginEnabled(configPath: string, pluginId: string, enabled: boolean): void {
	const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	try {
		parseToml(contents || '\n');
	} catch {
		throw new Error('config.toml cannot be parsed.');
	}

	const lines = contents.split(/\r?\n/);
	const blocks = parsePluginConfigBlocks(contents);
	const existing = blocks.find((block) => block.id === pluginId);
	if (!existing) {
		const separator = contents.trim().length > 0 ? '\n\n' : '';
		const nextBlock = [
			`[plugins."${escapeTomlBasicString(pluginId)}"]`,
			`enabled = ${enabled ? 'true' : 'false'}`,
		].join('\n');
		fs.writeFileSync(
			configPath,
			stabilizeManagedConfigToml(`${contents}${separator}${nextBlock}\n`),
			'utf8',
		);
		return;
	}

	if (existing.enabledLineIndex !== undefined) {
		const line = lines[existing.enabledLineIndex];
		const match = line.match(ENABLED_PATTERN);
		if (match) {
			lines[existing.enabledLineIndex] =
				`${match[1]}${enabled ? 'true' : 'false'}${match[3] ?? ''}`;
			fs.writeFileSync(
				configPath,
				stabilizeManagedConfigToml(lines.join('\n')),
				'utf8',
			);
			return;
		}
	}

	lines.splice(existing.endLineIndex + 1, 0, `enabled = ${enabled ? 'true' : 'false'}`);
	fs.writeFileSync(configPath, stabilizeManagedConfigToml(lines.join('\n')), 'utf8');
}

function readPluginRecord(
	entry: { marketplace: string; pluginName: string; version: string; rootPath: string },
	marketplaceByName: Map<string, PluginMarketplaceRecord>,
	configState: { enabledById: Map<string, boolean>; writable: boolean },
	normalMcpIds: Set<string>,
): PluginRecord {
	const manifestPath = path.join(entry.rootPath, '.codex-plugin', 'plugin.json');
	const errors: string[] = [];
	const warnings: string[] = [];
	const marketplace =
		marketplaceByName.get(`${entry.marketplace}:${entry.pluginName}`)
		?? marketplaceByName.get(entry.pluginName);
	let manifest: Manifest = {};
	if (!fs.existsSync(manifestPath)) {
		errors.push('Manifest file is missing.');
	} else {
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
		} catch (error) {
			errors.push(`Manifest JSON parse failed: ${toErrorMessage(error)}`);
		}
	}

	const manifestName = readString(manifest.name) || entry.pluginName;
	const version = readString(manifest.version) || entry.version;
	const pluginId = `${manifestName}@${entry.marketplace}`;
	const interfaceMeta = readRecord(manifest.interface);
	const displayName = readString(interfaceMeta.displayName) || manifestName;
	const shortDescription =
		readString(interfaceMeta.shortDescription) || readString(manifest.description);
	const longDescription =
		readString(manifest.longDescription)
		|| readString(interfaceMeta.longDescription)
		|| shortDescription;
	const developer =
		readString(interfaceMeta.developerName)
		|| readAuthor(manifest.author);
	const enabled = configState.enabledById.get(pluginId) ?? true;
	const requiredMissing = ['name', 'version', 'description'].filter((field) => !readString(manifest[field]));
	for (const field of requiredMissing) {
		errors.push(`Required manifest field is missing: ${field}.`);
	}

	const logoPath = resolveLogoPath(entry.rootPath, interfaceMeta, warnings);
	const capabilities = readStringArray(interfaceMeta.capabilities).map((name) => ({ name }));
	const keywords = readStringArray(manifest.keywords);
	const status: PluginStatus = errors.length > 0 ? 'needs-review' : enabled ? 'enabled' : 'disabled';
	const base = {
		pluginId,
		pluginDisplayName: displayName,
		enabled,
	};
	const skills = readPluginSkills(entry.rootPath, manifest, base, warnings);
	const mcpServers = readPluginMcpServers(entry.rootPath, manifest, base, warnings, normalMcpIds);
	const apps = readPluginApps(entry.rootPath, manifest, base, warnings);
	const agents = readPluginAgents(entry.rootPath, base);
	const searchText = [
		pluginId,
		manifestName,
		displayName,
		shortDescription,
		longDescription,
		developer,
		version,
		entry.marketplace,
		...keywords,
		...skills.map((skill) => skill.name),
		...mcpServers.map((server) => server.name),
		...apps.map((app) => app.name),
		...agents.map((agent) => agent.name),
	].join(' ').toLocaleLowerCase();

	return {
		id: pluginId,
		name: manifestName,
		displayName,
		description: shortDescription,
		longDescription,
		version,
		developer,
		marketplace: entry.marketplace,
		marketplacePath: marketplace?.marketplacePath,
		source: marketplace?.source,
		homepage: readString(manifest.homepage),
		repository: readRepository(manifest.repository),
		license: readString(manifest.license),
		keywords,
		capabilities,
		defaultPrompt: readString(interfaceMeta.defaultPrompt),
		brandColor: sanitizeBrandColor(readString(interfaceMeta.brandColor)),
		logoPath,
		manifestPath,
		installedPath: entry.rootPath,
		status,
		enabled,
		toggleDisabled: status === 'needs-review' || !configState.writable,
		errors,
		warnings,
		skills,
		mcpServers,
		apps,
		agents,
		searchText,
	};
}

function findInstalledPluginRoots(homeDir: string): Array<{
	marketplace: string;
	pluginName: string;
	version: string;
	rootPath: string;
}> {
	const cacheRoot = path.join(homeDir, '.codex', 'plugins', 'cache');
	if (!fs.existsSync(cacheRoot)) {
		return [];
	}
	const results: Array<{ marketplace: string; pluginName: string; version: string; rootPath: string }> = [];
	for (const marketplace of safeReadDir(cacheRoot)) {
		const marketplacePath = path.join(cacheRoot, marketplace.name);
		if (!marketplace.isDirectory()) {
			continue;
		}
		for (const plugin of safeReadDir(marketplacePath)) {
			if (!plugin.isDirectory()) {
				continue;
			}
			const pluginPath = path.join(marketplacePath, plugin.name);
			for (const version of safeReadDir(pluginPath)) {
				if (!version.isDirectory()) {
					continue;
				}
				results.push({
					marketplace: marketplace.name,
					pluginName: plugin.name,
					version: version.name,
					rootPath: path.join(pluginPath, version.name),
				});
			}
		}
	}
	return results;
}

function readMarketplaceRecords(homeDir: string, projectRoot?: string): PluginMarketplaceRecord[] {
	const candidates = [
		path.join(homeDir, '.agents', 'plugins', 'marketplace.json'),
		...(projectRoot
			? [
				path.join(projectRoot, '.agents', 'plugins', 'marketplace.json'),
				path.join(projectRoot, '.claude-plugin', 'marketplace.json'),
			]
			: []),
	];
	const records: PluginMarketplaceRecord[] = [];
	for (const marketplacePath of candidates) {
		if (!fs.existsSync(marketplacePath)) {
			continue;
		}
		try {
			const parsed = JSON.parse(fs.readFileSync(marketplacePath, 'utf8')) as unknown;
			records.push(...normalizeMarketplaceRecords(parsed, marketplacePath));
		} catch {
			continue;
		}
	}
	return records;
}

function normalizeMarketplaceRecords(parsed: unknown, marketplacePath: string): PluginMarketplaceRecord[] {
	const records = Array.isArray(parsed)
		? parsed
		: Array.isArray(readRecord(parsed).plugins)
			? readRecord(parsed).plugins as unknown[]
			: [];
	const marketplaceName =
		readString(readRecord(parsed).name)
		|| path.basename(path.dirname(marketplacePath));
	return records
		.map((value) => readRecord(value))
		.map((value) => ({
			name: readString(value.name) || readString(value.id),
			marketplace: readString(value.marketplace) || marketplaceName,
			marketplacePath,
			source: normalizeSource(value.source),
		}))
		.filter((record) => record.name.length > 0);
}

function normalizeSource(source: unknown): PluginMarketplaceSource | undefined {
	const value = readRecord(source);
	const result: PluginMarketplaceSource = {
		path: readString(value.path),
		repository: readString(value.repository),
		url: readString(value.url),
		type: readString(value.type),
	};
	return Object.values(result).some(Boolean) ? result : undefined;
}

function readPluginSkills(
	rootPath: string,
	manifest: Manifest,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
	warnings: string[],
): PluginSkillRecord[] {
	const skillPaths = [
		...readPathList(manifest.skills),
		...findFiles(path.join(rootPath, 'skills'), 'SKILL.md'),
	];
	return unique(skillPaths.map((skillPath) => resolvePluginPath(rootPath, skillPath, warnings)))
		.filter((resolved) => fs.existsSync(resolved.path) && path.basename(resolved.path) === 'SKILL.md')
		.map((resolved) => {
			const metadata = readSkillMetadataSafe(resolved.path);
			return {
				name: metadata.name || path.basename(path.dirname(resolved.path)),
				description: metadata.description,
				skillPath: resolved.path,
				unsafePath: !resolved.safe,
				...base,
			};
		});
}

function readPluginMcpServers(
	rootPath: string,
	manifest: Manifest,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
	warnings: string[],
	normalMcpIds: Set<string>,
): PluginMcpRecord[] {
	return readPathList(manifest.mcpServers)
		.map((mcpPath) => resolvePluginPath(rootPath, mcpPath, warnings))
		.filter((resolved) => fs.existsSync(resolved.path))
		.flatMap((resolved) => parseMcpDefinitionFile(resolved.path, resolved.safe, base, normalMcpIds));
}

function readPluginApps(
	rootPath: string,
	manifest: Manifest,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
	warnings: string[],
): PluginAppRecord[] {
	return readPathList(manifest.apps)
		.map((appPath) => resolvePluginPath(rootPath, appPath, warnings))
		.filter((resolved) => fs.existsSync(resolved.path))
		.map((resolved) => {
			const parsed = readJsonSafe(resolved.path);
			const display = readRecord(readRecord(parsed).display);
			return {
				name: readString(readRecord(parsed).name) || readString(display.name) || path.basename(resolved.path),
				description: readString(readRecord(parsed).description) || readString(display.description),
				definitionPath: resolved.path,
				unsafePath: !resolved.safe,
				...base,
			};
		});
}

function readPluginAgents(
	rootPath: string,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
): PluginAgentRecord[] {
	const agentsRoot = path.join(rootPath, 'agents');
	return findFiles(agentsRoot, '.toml')
		.map((definitionPath) => parseAgentDefinition(definitionPath, base));
}

function parseMcpDefinitionFile(
	definitionPath: string,
	safe: boolean,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
	normalMcpIds: Set<string>,
): PluginMcpRecord[] {
	const parsed = readJsonSafe(definitionPath);
	const root = readRecord(parsed);
	const servers = readRecord(root.mcp_servers ?? root.mcpServers ?? root.servers ?? root);
	return Object.entries(servers).map(([name, value]) => {
		const server = readRecord(value);
		const type = readString(server.type) || (readString(server.url) ? 'streamable_http' : readString(server.command) ? 'stdio' : 'unknown');
		const env = readRecord(server.env);
		return {
			name,
			type,
			command: SECRET_KEY_PATTERN.test('command') ? undefined : readString(server.command),
			url: redactIfSecret('url', readString(server.url)),
			envKeys: Object.keys(env),
			hasToolFilters: Array.isArray(server.enabled_tools) || Array.isArray(server.disabled_tools),
			required: typeof server.required === 'boolean' ? server.required : undefined,
			definitionPath,
			unsafePath: !safe,
			conflict: normalMcpIds.has(name),
			...base,
		};
	});
}

function parseAgentDefinition(
	definitionPath: string,
	base: { pluginId: string; pluginDisplayName: string; enabled: boolean },
): PluginAgentRecord {
	try {
		const parsed = readRecord(parseToml(fs.readFileSync(definitionPath, 'utf8')));
		const skills = readRecord(parsed.skills);
		const skillConfig = Array.isArray(skills.config) ? skills.config : [];
		return {
			name: readString(parsed.name) || path.basename(definitionPath, path.extname(definitionPath)),
			description: readString(parsed.description),
			model: readString(parsed.model),
			reasoning: readString(parsed.model_reasoning_effort),
			sandbox: readString(parsed.sandbox_mode),
			mcpServers: Object.keys(readRecord(parsed.mcp_servers)),
			skillConfigCount: skillConfig.length,
			definitionPath,
			unsafePath: false,
			...base,
		};
	} catch (error) {
		return {
			name: path.basename(definitionPath, path.extname(definitionPath)),
			description: '',
			mcpServers: [],
			skillConfigCount: 0,
			definitionPath,
			unsafePath: false,
			error: toErrorMessage(error),
			...base,
		};
	}
}

function parsePluginConfigBlocks(contents: string): Array<{
	id: string;
	startLineIndex: number;
	endLineIndex: number;
	enabledValue?: boolean;
	enabledLineIndex?: number;
}> {
	const lines = contents.split(/\r?\n/);
	const blocks: Array<{
		id: string;
		startLineIndex: number;
		endLineIndex: number;
		enabledValue?: boolean;
		enabledLineIndex?: number;
	}> = [];
	let current: typeof blocks[number] | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const headerMatch = lines[index].match(/^\s*\[[^\]]+\]\s*$/);
		if (headerMatch) {
			if (current) {
				current.endLineIndex = index - 1;
				current = undefined;
			}
			const pluginMatch = lines[index].match(PLUGIN_CONFIG_HEADER_PATTERN);
			if (pluginMatch) {
				current = {
					id: unescapeTomlBasicString(pluginMatch[1] ?? pluginMatch[2] ?? ''),
					startLineIndex: index,
					endLineIndex: lines.length - 1,
				};
				blocks.push(current);
			}
			continue;
		}
		if (!current) {
			continue;
		}
		const enabledMatch = lines[index].match(ENABLED_PATTERN);
		if (enabledMatch) {
			current.enabledValue = enabledMatch[2].toLowerCase() === 'true';
			current.enabledLineIndex = index;
		}
	}
	return blocks;
}

function readPluginConfigState(configPath: string): {
	enabledById: Map<string, boolean>;
	writable: boolean;
} {
	if (!fs.existsSync(configPath)) {
		return { enabledById: new Map(), writable: true };
	}
	const contents = fs.readFileSync(configPath, 'utf8');
	const enabledById = new Map<string, boolean>();
	for (const block of parsePluginConfigBlocks(contents)) {
		enabledById.set(block.id, block.enabledValue ?? true);
	}
	return { enabledById, writable: canWritePluginConfig(configPath) };
}

function resolvePluginPath(rootPath: string, candidate: string, warnings: string[]): { path: string; safe: boolean } {
	const normalizedCandidate = candidate.startsWith('./') ? candidate.slice(2) : candidate;
	if (candidate && !candidate.startsWith('./')) {
		warnings.push(`Path does not start with ./ and was resolved relative to plugin root: ${candidate}`);
	}
	const resolved = path.resolve(rootPath, normalizedCandidate);
	const resolvedRoot = path.resolve(rootPath);
	return {
		path: resolved,
		safe: resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`),
	};
}

function resolveLogoPath(rootPath: string, interfaceMeta: Record<string, unknown>, warnings: string[]): string | undefined {
	const candidates = [
		readString(interfaceMeta.logo),
		readString(interfaceMeta.composerIcon),
		'assets/logo.png',
		'assets/icon.png',
	].filter(Boolean);
	for (const candidate of candidates) {
		const resolved = resolvePluginPath(rootPath, candidate, warnings);
		if (!resolved.safe) {
			continue;
		}
		const extension = path.extname(resolved.path).toLowerCase();
		if (!['.png', '.svg', '.webp'].includes(extension)) {
			continue;
		}
		if (fs.existsSync(resolved.path)) {
			return resolved.path;
		}
	}
	return undefined;
}

function readPathList(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) =>
			typeof item === 'string'
				? [item]
				: [readString(readRecord(item).path)].filter(Boolean),
		);
	}
	if (value && typeof value === 'object') {
		return Object.values(value as Record<string, unknown>)
			.flatMap((item) =>
				typeof item === 'string'
					? [item]
					: [readString(readRecord(item).path)].filter(Boolean),
			);
	}
	return [];
}

function readSkillMetadataSafe(skillPath: string): { name: string; description: string } {
	try {
		const contents = fs.readFileSync(skillPath, 'utf8');
		const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!match) {
			return { name: '', description: '' };
		}
		return {
			name: readFrontmatterString(match[1], 'name'),
			description: readFrontmatterString(match[1], 'description'),
		};
	} catch {
		return { name: '', description: '' };
	}
}

function readFrontmatterString(frontmatter: string, key: string): string {
	const pattern = new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|(.+))\\s*$`, 'm');
	const match = frontmatter.match(pattern);
	return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function findFiles(rootPath: string, nameOrExtension: string): string[] {
	if (!fs.existsSync(rootPath)) {
		return [];
	}
	const results: string[] = [];
	const traverse = (currentPath: string): void => {
		for (const entry of safeReadDir(currentPath)) {
			if (entry.name.startsWith('.')) {
				continue;
			}
			const entryPath = path.join(currentPath, entry.name);
			if (entry.isDirectory()) {
				traverse(entryPath);
				continue;
			}
			const matches = nameOrExtension.startsWith('.')
				? path.extname(entry.name).toLowerCase() === nameOrExtension
				: entry.name === nameOrExtension;
			if (entry.isFile() && matches) {
				results.push(entryPath);
			}
		}
	};
	traverse(rootPath);
	return results.sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }),
	);
}

function safeReadDir(targetPath: string): fs.Dirent[] {
	try {
		return fs.readdirSync(targetPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

function readJsonSafe(targetPath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(targetPath, 'utf8')) as unknown;
	} catch {
		return {};
	}
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function readString(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}
	return '';
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
}

function readAuthor(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	return readString(readRecord(value).name);
}

function readRepository(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	const record = readRecord(value);
	return readString(record.url) || readString(record.repository);
}

function sanitizeBrandColor(value: string): string | undefined {
	return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function redactIfSecret(key: string, value: string): string | undefined {
	if (!value) {
		return undefined;
	}
	return SECRET_KEY_PATTERN.test(key) ? undefined : value;
}

function unique<T extends { path: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = path.resolve(item.path);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function escapeTomlBasicString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeTomlBasicString(value: string): string {
	return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
