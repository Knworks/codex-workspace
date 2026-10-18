import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { listProfileConfigFilesInDirectory } from './profileConfigService';
import { AgentLocation, getAgentLocations } from './agentLocations';
import {
	buildAgentConfigBlockWithPath,
	appendAgentConfigRawBlock,
	extractAgentConfigBlock,
	replaceAgentConfigRawBlock,
	upsertAgentConfigMetadata,
} from './agentConfigService';
import { renameAgentDeclaration } from './agentDeclarationService';
import {
	getDisabledAgentBlock,
	listDisabledAgentIds,
	getDisabledAgentsStorePath,
	saveDisabledAgentBlock,
	takeDisabledAgentBlock,
} from './disabledAgentsStore';
import { stabilizeManagedConfigToml } from './configTomlOrganizerService';
import { resolveCodexPaths } from './workspaceStatus';
import { writeAgentFile } from './agentFileStore';

export type AgentManagerRecord = {
	id: string;
	name: string;
	description: string;
	model: string;
	reasoningEffort: string;
	sandboxMode: string;
	agentPath: string;
	configFile: string;
	configPath: string;
	location: AgentLocation;
	enabled: boolean;
	previewContent: string;
};

const INHERITED = '継承';

export function refreshAgentManagerRecords(configPath: string, locations: AgentLocation[] = getAgentLocations()): AgentManagerRecord[] {
	pruneMissingAgentBackups(configPath, locations);
	return listAgentManagerRecords(configPath, locations);
}

/** Enumerate declarations without UI file filtering or undeclared-file synthesis. */
export function listAgentDeclarationRecords(
	configPath: string,
	locations: AgentLocation[] = getAgentLocations(),
	includeDetails: boolean = true,
	sources = listAgentConfigSources(configPath, locations),
): AgentManagerRecord[] {
	const records = sources.flatMap((source) => {
		const contents = fs.existsSync(source.configPath) ? fs.readFileSync(source.configPath, 'utf8') : '';
		const roles = parseAgentRoleDeclarations(contents);
		const storePath = getAgentManagerStorePath(source.configPath);
		const details = includeDetails ? undefined : {};
		const declared = roles.map((role) => createRecord(role, source.configPath, source.location, true, details));
		for (const key of listDisabledAgentIds(storePath)) {
			if (roles.some((role) => role.name === key)) { continue; }
			const role = parseAgentRoleDeclarations(getDisabledAgentBlock(storePath, key) ?? '').find((item) => item.name === key);
			if (role) { declared.push(createRecord(role, source.configPath, source.location, false, details)); }
		}
		return declared;
	});
	return records;
}

export function listAgentManagerRecords(configPath: string, locations: AgentLocation[] = getAgentLocations()): AgentManagerRecord[] {
	const sources = listAgentConfigSources(configPath, locations);
	const records = listAgentDeclarationRecords(configPath, locations)
		.filter((record) => record.configFile && isAgentFile(record.agentPath));
	// Files without a declaration are available but OFF. A backup alone never creates a row.
	for (const location of locations) {
		if (!fs.existsSync(location.rootPath)) { continue; }
		const source = sources.find((item) => item.location.kind === location.kind && sameAgentPath(item.location.rootPath, location.rootPath));
		if (!source) { continue; }
		const files = fs.readdirSync(location.rootPath, { withFileTypes: true })
			.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.toml')
			.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
		for (const file of files) {
			const fullPath = path.join(location.rootPath, file.name);
			if (records.some((record) => sameAgentPath(record.agentPath, fullPath))) { continue; }
			const details = readAgentTomlDetails(fullPath);
			const role = { name: path.basename(file.name, path.extname(file.name)), description: details.description ?? '',
				configFile: path.relative(path.dirname(source.configPath), fullPath).replace(/\\/g, '/') };
			const record = createRecord(role, source.configPath, location, false, details);
			if (records.some((item) => item.id === record.id)) { record.id = JSON.stringify([source.configPath, role.name, fullPath]); }
			records.push(record);
		}
	}
	return records;
}

export function listAgentConfigSources(configPath: string, locations: AgentLocation[] = getAgentLocations()): { configPath: string; location: AgentLocation }[] {
	const baseDir = path.dirname(configPath);
	const workspaceLocation = locations.find((location) => location.kind === 'workspace') ?? {
		kind: 'workspace' as const, label: 'Workspace Agents', rootPath: path.join(baseDir, 'agents'), priority: 2,
	};
	const sources = [
		{ configPath, location: workspaceLocation },
		...listProfileConfigFilesInDirectory(baseDir).map((profile) => ({
			configPath: profile.configPath,
			location: { ...workspaceLocation, label: `Profile: ${profile.name}` },
		})),
		...locations.filter((location) => location.kind === 'project').map((location) => ({
			configPath: path.join(path.dirname(location.createPath ?? location.rootPath), 'config.toml'), location,
		})),
	];
	const seenSources = new Set<string>();
	return sources.flatMap((source) => {
		const sourcePath = path.resolve(source.configPath);
		const key = normalizeAgentPath(sourcePath);
		if (seenSources.has(key)) { return []; }
		seenSources.add(key);
		return [{ ...source, configPath: sourcePath }];
	});
}

function isAgentFile(filePath: string): boolean {
	return path.extname(filePath).toLowerCase() === '.toml' && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function normalizeAgentPath(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function sameAgentPath(left: string, right: string): boolean {
	return normalizeAgentPath(left) === normalizeAgentPath(right);
}

/** Remove only disabled declarations whose referenced Agent file no longer exists. */
export function pruneMissingAgentBackups(configPath: string, locations: AgentLocation[] = getAgentLocations()): void {
	const sources = listAgentConfigSources(configPath, locations);
	const stores = new Map(sources.map((source) => [getAgentManagerStorePath(source.configPath), source.configPath]));
	// Profile configuration files may have been removed while their stores remained.
	const stateDir = path.dirname(getAgentManagerStorePath(configPath));
	if (fs.existsSync(stateDir)) {
		const suffix = '.agents-disabled.json';
		for (const file of fs.readdirSync(stateDir)) {
			if (file.endsWith('.config.toml' + suffix)) {
				stores.set(path.join(stateDir, file), path.join(path.dirname(configPath), file.slice(0, -suffix.length)));
			}
		}
	}
	for (const [storePath, sourcePath] of stores) {
		const keys = listDisabledAgentIds(storePath);
		for (const key of keys) {
			const role = parseAgentRoleDeclarations(getDisabledAgentBlock(storePath, key) ?? '').find((item) => item.name === key);
			if (!role?.configFile || !isAgentFile(resolveAgentConfigFile(sourcePath, role.configFile)) || !fs.existsSync(sourcePath)) {
				takeDisabledAgentBlock(storePath, key);
			}
		}
		if (keys.length === 0 && fs.existsSync(storePath)) { fs.rmSync(storePath); }
	}
}

/** Delete a file and all active/disabled references to that path, never by role name alone. */
export function deleteAgentFile(agentPath: string, configPath: string, locations: AgentLocation[] = getAgentLocations()): void {
	const writes = new Map<string, { before: string; after: string | undefined }>();
	for (const source of listAgentConfigSources(configPath, locations)) {
		const before = fs.existsSync(source.configPath) ? fs.readFileSync(source.configPath, 'utf8') : '';
		let after = before;
		for (const role of parseAgentRoleDeclarations(before)) {
			if (role.configFile && sameAgentPath(resolveAgentConfigFile(source.configPath, role.configFile), agentPath)) {
				after = extractAgentConfigBlock(after, role.name).contents;
			}
		}
		if (before !== after) { writes.set(source.configPath, { before, after }); }
		const storePath = getAgentManagerStorePath(source.configPath);
		const keys = listDisabledAgentIds(storePath);
		const removed = keys.filter((key) => parseAgentRoleDeclarations(getDisabledAgentBlock(storePath, key) ?? '')
			.some((role) => role.name === key && role.configFile && sameAgentPath(resolveAgentConfigFile(source.configPath, role.configFile), agentPath)));
		if (removed.length > 0) {
			const storeBefore = fs.readFileSync(storePath, 'utf8');
			const store = JSON.parse(storeBefore) as { disabledAgents: Record<string, unknown> };
			for (const key of removed) { delete store.disabledAgents[key]; }
			writes.set(storePath, { before: storeBefore,
				after: Object.keys(store.disabledAgents).length ? `${JSON.stringify(store, null, 2)}\n` : undefined });
		}
	}
	// Parse every affected source before changing anything, and retain the file until saves succeed.
	const applied: string[] = [];
	try {
		for (const [file, change] of writes) {
			applied.push(file);
			if (change.after === undefined) { fs.rmSync(file); }
			else { writeAgentFile(file, change.after); }
		}
		fs.rmSync(agentPath, { force: true });
	} catch (error) {
		for (const file of applied.reverse()) { writeAgentFile(file, writes.get(file)!.before); }
		throw error;
	}
}

/** Keep all references in step when Explorer renames a shared physical file. */
export function editAgentFile(agentPath: string, nextPath: string, selected: { configPath: string; name: string }, description: string,
	configPath: string, locations: AgentLocation[] = getAgentLocations()): void {
	const writes = new Map<string, string>();
	const before = new Map<string, string>();
	const oldName = path.basename(agentPath, path.extname(agentPath));
	const newName = path.basename(nextPath, path.extname(nextPath));
	for (const source of listAgentConfigSources(configPath, locations)) {
		const original = fs.existsSync(source.configPath) ? fs.readFileSync(source.configPath, 'utf8') : '';
		let contents = original;
		const roles = parseAgentRoleDeclarations(original);
		const update = (block: string, role: AgentRoleDeclaration): { name: string; block: string } => {
			const isSelected = sameAgentPath(source.configPath, selected.configPath) && role.name === selected.name;
			const name = isSelected && role.name === oldName ? newName : role.name;
			if (name !== role.name && roles.some((item) => item.name === name)) { throw new Error(`Agent role already exists: ${name}`); }
			const renamed = renameAgentDeclaration(block, role.name, name);
			return { name, block: upsertAgentConfigMetadata(renamed, name, isSelected ? description : role.description,
				path.relative(path.dirname(source.configPath), nextPath).replace(/\\/g, '/')) };
		};
		for (const role of roles) {
			if (!role.configFile || !sameAgentPath(resolveAgentConfigFile(source.configPath, role.configFile), agentPath)) { continue; }
			const extracted = extractAgentConfigBlock(contents, role.name);
			contents = appendAgentConfigRawBlock(extracted.contents, update(extracted.block!, role).block);
		}
		if (contents !== original) { before.set(source.configPath, original); writes.set(source.configPath, contents); }
		const storePath = getAgentManagerStorePath(source.configPath);
		if (!fs.existsSync(storePath)) { continue; }
		const storeBefore = fs.readFileSync(storePath, 'utf8');
		const store = JSON.parse(storeBefore) as { disabledAgents: Record<string, { block: string }> };
		store.disabledAgents = Object.assign(Object.create(null), store.disabledAgents);
		let storeChanged = false;
		for (const key of listDisabledAgentIds(storePath)) {
			const entry = store.disabledAgents[key];
			const role = parseAgentRoleDeclarations(entry.block).find((item) => item.name === key);
			if (!role?.configFile || !sameAgentPath(resolveAgentConfigFile(source.configPath, role.configFile), agentPath)) { continue; }
			const result = update(entry.block, role);
			if (result.name !== key && store.disabledAgents[result.name]) { throw new Error(`Disabled Agent role already exists: ${result.name}`); }
			delete store.disabledAgents[key];
			store.disabledAgents[result.name] = { ...entry, block: result.block };
			storeChanged = true;
		}
		const nextStore = `${JSON.stringify(store, null, 2)}\n`;
		if (storeChanged) { before.set(storePath, storeBefore); writes.set(storePath, nextStore); }
	}
	const applied: string[] = [];
	try {
		for (const [file, contents] of writes) { applied.push(file); writeAgentFile(file, contents); }
		if (!sameAgentPath(agentPath, nextPath)) { fs.renameSync(agentPath, nextPath); }
	} catch (error) {
		for (const file of applied.reverse()) { writeAgentFile(file, before.get(file)!); }
		throw error;
	}
}

export type AgentRoleDeclaration = { name: string; description: string; configFile: string };

/** Read role keys from TOML tables, independently of role file names. */
export function parseAgentRoleDeclarations(contents: string): AgentRoleDeclaration[] {
	const parsed = toml.parse(contents) as { agents?: Record<string, unknown> };
	return Object.entries(parsed.agents ?? {}).flatMap(([name, value]) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) { return []; }
		const role = value as Record<string, unknown>;
		return [{ name, description: typeof role.description === 'string' ? role.description : '',
			configFile: typeof role.config_file === 'string' ? role.config_file : '' }];
	});
}

function createRecord(role: AgentRoleDeclaration, configPath: string, location: AgentLocation, enabled: boolean, details?: Record<string, string>): AgentManagerRecord {
	const agentPath = role.configFile ? resolveAgentConfigFile(configPath, role.configFile) : configPath;
	const detail = details ?? (role.configFile ? readAgentTomlDetails(agentPath) : {});
	return {
		id: JSON.stringify([configPath, role.name]), name: role.name, description: role.description,
		model: detail.model ?? INHERITED, reasoningEffort: detail.model_reasoning_effort ?? INHERITED,
		sandboxMode: detail.sandbox_mode ?? INHERITED, agentPath, configFile: role.configFile,
		configPath, location, enabled, previewContent: detail.developer_instructions?.trim() ?? '',
	};
}

/** Keep the legacy Base store; isolate Profile stores even when sharing a directory. */
export function getAgentManagerStorePath(configPath: string): string {
	const storePath = getDisabledAgentsStorePath(path.dirname(configPath));
	return path.basename(configPath) === 'config.toml' ? storePath
		: path.join(path.dirname(storePath), `${path.basename(configPath)}.agents-disabled.json`);
}

export function disableAgentByName(_codexDir: string, configPath: string, agentName: string): { changed: boolean } {
	const contents = fs.readFileSync(configPath, 'utf8');
	const role = parseAgentRoleDeclarations(contents).find((item) => item.name === agentName);
	if (role?.configFile) {
		const agentPath = resolveAgentConfigFile(configPath, role.configFile);
		const relative = path.relative(path.join(path.dirname(configPath), 'agents'), agentPath);
		if (relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && agentPath.endsWith('.toml') && fs.existsSync(agentPath)) {
			const definition = toml.parse(fs.readFileSync(agentPath, 'utf8')) as Record<string, unknown>;
			if (['name', 'description', 'developer_instructions'].every((key) => typeof definition[key] === 'string' && definition[key].trim())) {
				throw new Error('Cannot disable this declaration: CLI 0.163.0 would rediscover its standalone Agent file.');
			}
		}
	}
	const extracted = extractAgentConfigBlock(contents, agentName);
	if (!extracted.removed || !extracted.block) {
		return { changed: false };
	}
	saveDisabledAgentBlock(
		getAgentManagerStorePath(configPath),
		agentName,
		extracted.block,
	);
	writeAgentFile(
		configPath,
		extracted.contents,
	);
	return { changed: true };
}

export function enableAgentByName(
	_codexDir: string,
	configPath: string,
	agentName: string,
	configFile?: string,
): { overwritten: boolean; changed: boolean } {
	const storePath = getAgentManagerStorePath(configPath);
	const candidateBlock = getDisabledAgentBlock(storePath, agentName);
	const stashedRole = candidateBlock ? parseAgentRoleDeclarations(candidateBlock).find((role) => role.name === agentName) : undefined;
	if (candidateBlock && !stashedRole) { throw new Error(`Disabled agent backup does not contain role: ${agentName}`); }
	const stashedBlock = !configFile || (stashedRole && sameAgentPath(resolveAgentConfigFile(configPath, stashedRole.configFile), resolveAgentConfigFile(configPath, configFile)))
		? candidateBlock : undefined;
	const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
	const existing = parseAgentRoleDeclarations(contents).find((role) => role.name === agentName);
	if (configFile && existing && (!existing.configFile || !sameAgentPath(resolveAgentConfigFile(configPath, existing.configFile), resolveAgentConfigFile(configPath, configFile)))) {
		throw new Error(`Agent role ${agentName} already refers to another file in ${configPath}`);
	}
	const alreadyExists = Boolean(existing);
	const targetConfigFile = configFile ?? (stashedRole?.configFile || `agents/${agentName}.toml`);
	const fileDescription = readAgentTomlDetails(resolveAgentConfigFile(configPath, targetConfigFile)).description ?? '';
	if (stashedBlock) {
		const restoredBlock = !stashedRole?.description && fileDescription
			? upsertAgentConfigMetadata(stashedBlock, agentName, fileDescription, targetConfigFile)
			: stashedBlock;
		const nextContents = alreadyExists
			? replaceAgentConfigRawBlock(contents, agentName, restoredBlock)
			: appendAgentConfigRawBlock(contents, restoredBlock);
		toml.parse(nextContents);
		writeAgentFile(
			configPath,
			nextContents,
		);
		takeDisabledAgentBlock(storePath, agentName);
		return { overwritten: alreadyExists, changed: true };
	}
	if (!alreadyExists) {
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		writeAgentFile(
			configPath,
			stabilizeManagedConfigToml(
				appendAgentConfigRawBlock(contents, buildAgentConfigBlockWithPath(agentName, fileDescription, targetConfigFile)),
			),
		);
	}
	return { overwritten: false, changed: !alreadyExists };
}

export function resolveAgentManagerPaths(): { codexDir: string; configPath: string } {
	return resolveCodexPaths();
}

function resolveAgentConfigFile(configPath: string, configFile: string): string {
	if (path.isAbsolute(configFile)) {
		return path.normalize(configFile);
	}
	return path.resolve(path.dirname(configPath), configFile);
}

function readAgentTomlDetails(agentPath: string): Record<string, string> {
	if (!fs.existsSync(agentPath)) { return {}; }
	let parsed: Record<string, unknown>;
	try { parsed = toml.parse(fs.readFileSync(agentPath, 'utf8')) as Record<string, unknown>; }
	catch { return {}; } // Keep malformed files available for editing in both views.
	const result: Record<string, string> = {};
	for (const key of ['description', 'model', 'model_reasoning_effort', 'sandbox_mode', 'developer_instructions']) {
		if (typeof parsed[key] === 'string') { result[key] = parsed[key]; }
	}
	return result;
}
