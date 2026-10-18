import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { AgentLocation, getAgentLocations, getCliAgentLocations } from './agentLocations';
import { disableAgentByName, enableAgentByName, getAgentManagerStorePath, listAgentConfigSources, listAgentDeclarationRecords } from './agentManagerService';
import { getDisabledAgentBlock } from './disabledAgentsStore';

export const SUPPORTED_AGENT_CLI_VERSION = '0.163.0';
const DISABLED_SUFFIX = '.disabled';

export type CliAgentRecord = {
	/** Stable identity includes format, configuration source and physical definition path. */
	id: string;
	definitionFormat: 'declaration' | 'standalone';
	configPath: string;
	agentPath: string;
	configFile: string;
	roleKey?: string;
	name: string;
	description: string;
	location: AgentLocation;
	enabled: boolean;
	availability: 'available' | 'disabled' | 'invalid' | 'unverified';
	reason?: string;
};

type AgentDetails = { name?: string; description?: string; developer_instructions?: string };

/** Validate the supported standalone contract without changing user content. */
export function readAgentDefinition(file: string, standalone: boolean): { details: AgentDetails; reason?: string; unverified?: boolean } {
	try {
		const parsed = toml.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
		const details: AgentDetails = {};
		for (const key of ['name', 'description', 'developer_instructions'] as const) {
			if (parsed[key] !== undefined && typeof parsed[key] !== 'string') { return { details, reason: `${key} must be a string.` }; }
			if (typeof parsed[key] === 'string') { details[key] = parsed[key].trim(); }
		}
		for (const key of ['description', 'developer_instructions'] as const) {
			if (parsed[key] !== undefined && !details[key]) { return { details, reason: `${key} cannot be blank.` }; }
		}
		const required = standalone ? ['name', 'description', 'developer_instructions'] as const : [];
		for (const key of required) {
			if (!details[key]) { return { details, reason: `${key} must be a non-empty string.` }; }
		}
		// This is deliberately a bounded contract, not an approximation of all ConfigToml fields.
		const supported = new Set(['name', 'description', 'developer_instructions', 'model', 'model_reasoning_effort', 'sandbox_mode']);
		const unknown = Object.keys(parsed).filter((key) => !supported.has(key));
		if (unknown.length) { return { details, reason: `CLI validation is not implemented for: ${unknown.join(', ')}.`, unverified: true }; }
		for (const key of ['model', 'model_reasoning_effort', 'sandbox_mode']) {
			if (parsed[key] !== undefined && typeof parsed[key] !== 'string') {
				return { details, reason: `${key} must be a string.` };
			}
		}
		if (parsed.model_reasoning_effort === '') {
			return { details, reason: 'model_reasoning_effort must be non-empty.' };
		}
		if (parsed.sandbox_mode !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(String(parsed.sandbox_mode))) {
			return { details, reason: 'Unrecognized sandbox_mode.' };
		}
		return { details };
	} catch (error) {
		return { details: {}, reason: `Cannot read Agent TOML: ${error instanceof Error ? error.message : String(error)}` };
	}
}

/** Sorted recursive discovery, excluding symbolic links so edits cannot escape a managed root. */
function listDefinitionFiles(root: string): string[] {
	if (!fs.existsSync(root)) { return []; }
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const file = path.join(root, entry.name);
		if (entry.isDirectory()) { files.push(...listDefinitionFiles(file)); }
		else if (entry.isFile() && (entry.name.endsWith('.toml') || entry.name.endsWith('.toml.disabled'))) { files.push(file); }
	}
	return files.sort();
}

function getDeclarationValidationReason(configPath: string, roleKey: string, enabled: boolean): string | undefined {
	const contents = enabled ? fs.readFileSync(configPath, 'utf8') : getDisabledAgentBlock(getAgentManagerStorePath(configPath), roleKey) ?? '';
	const parsed = toml.parse(contents) as { agents?: Record<string, Record<string, unknown>> };
	const role = parsed.agents?.[roleKey];
	if (!role) { return 'The role declaration no longer exists.'; }
	for (const key of ['description', 'config_file']) {
		if (role[key] !== undefined && typeof role[key] !== 'string') { return `${key} in the declaration must be a string.`; }
	}
	const unvalidated = Object.keys(role).filter((key) => !['description', 'config_file'].includes(key));
	return unvalidated.length ? `CLI declaration validation is not implemented for: ${unvalidated.join(', ')}.` : undefined;
}

/** Per-definition availability in recognized layers; does not resolve trust, active profiles or precedence. */
export function listCliAgentRecords(configPath: string, locations: AgentLocation[] = getAgentLocations()): CliAgentRecord[] {
	const roots = getCliAgentLocations(configPath, locations);
	const diagnostics: CliAgentRecord[] = [];
	const declarations = listAgentConfigSources(configPath, locations).flatMap((source) => {
		try { return listAgentDeclarationRecords(configPath, locations, false, [source]); }
		catch (error) {
			diagnostics.push({ id: JSON.stringify(['diagnostic', source.configPath]), definitionFormat: 'declaration',
				configPath: source.configPath, agentPath: source.configPath, configFile: '', name: path.basename(source.configPath),
				description: '', location: source.location, enabled: false, availability: 'invalid',
				reason: `Cannot read Agent declarations: ${error instanceof Error ? error.message : String(error)}` });
			return [];
		}
	});
	const records: CliAgentRecord[] = declarations.map((record) => {
		const parsed = record.configFile ? readAgentDefinition(record.agentPath, false) : { details: {} as AgentDetails };
		const name = parsed.details.name || record.name;
		const description = parsed.details.description || record.description;
		const declarationReason = getDeclarationValidationReason(record.configPath, record.name, record.enabled);
		const reason = declarationReason ?? parsed.reason ?? (!description.trim() ? 'A description is required by CLI 0.163.0.' : undefined);
		return {
			id: JSON.stringify(['declaration', record.configPath, record.name, record.agentPath]),
			definitionFormat: 'declaration', configPath: record.configPath, agentPath: record.agentPath,
			configFile: record.configFile, roleKey: record.name, name, description, location: record.location,
			enabled: record.enabled && !reason, availability: reason ? parsed.unverified || declarationReason ? 'unverified' : 'invalid' : record.enabled ? 'available' : 'disabled', reason,
		};
	});
	for (const location of roots) {
		const source = path.join(path.dirname(location.rootPath), 'config.toml');
		for (const file of listDefinitionFiles(location.rootPath)) {
			// A declared file is discovered only through that declaration in its own layer.
			if (declarations.some((item) => item.enabled && path.resolve(item.configPath) === path.resolve(source) && path.resolve(item.agentPath) === file)) { continue; }
			const disabled = file.endsWith(DISABLED_SUFFIX);
			const activePath = disabled ? file.slice(0, -DISABLED_SUFFIX.length) : file;
			const parsed = readAgentDefinition(file, true);
			const valid = !parsed.reason;
			records.push({
				id: JSON.stringify(['standalone', source, activePath]), definitionFormat: 'standalone',
				configPath: source, agentPath: file, configFile: path.relative(path.dirname(source), file),
				name: parsed.details.name ?? '', description: parsed.details.description ?? '', location,
				enabled: !disabled && valid, availability: !valid ? parsed.unverified ? 'unverified' : 'invalid' : disabled ? 'disabled' : 'available', reason: parsed.reason,
			});
		}
	}
	const unique = new Map<string, CliAgentRecord>();
	for (const record of records) {
		const existing = unique.get(record.id);
		if (existing) {
			existing.enabled = false;
			existing.availability = 'unverified';
			existing.reason = 'Both active and disabled paths exist; resolve the file collision before changing state.';
		} else { unique.set(record.id, record); }
	}
	return [...unique.values(), ...diagnostics];
}

export type CliAgentOperationResult = { supported: true; changed: boolean } | { supported: false; reason: string };

/** Re-read identities and reject operations whose CLI availability cannot be guaranteed. */
export function setCliAgentEnabled(
	configPath: string,
	id: string,
	enabled: boolean,
	locations: AgentLocation[] = getAgentLocations(),
	cliVersion: string = SUPPORTED_AGENT_CLI_VERSION,
): CliAgentOperationResult {
	if (cliVersion !== SUPPORTED_AGENT_CLI_VERSION) { return { supported: false, reason: `Unsupported CLI version: ${cliVersion}.` }; }
	const records = listCliAgentRecords(configPath, locations);
	const record = records.find((item) => item.id === id);
	if (!record) { return { supported: false, reason: 'Agent definition no longer exists.' }; }
	if (record.reason) { return { supported: false, reason: record.reason }; }
	if (records.some((item) => item.id !== id && item.name === record.name && item.enabled)) {
		return { supported: false, reason: 'Another definition exposes the same CLI name; layer precedence is not resolved.' };
	}
	if (record.enabled === enabled) { return { supported: true, changed: false }; }
	if (record.definitionFormat === 'declaration') {
		if (!enabled && getCliAgentLocations(configPath, locations).some((root) => {
			const relative = path.relative(root.rootPath, record.agentPath);
			return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
				&& record.agentPath.endsWith('.toml') && !readAgentDefinition(record.agentPath, true).reason;
		})) {
			return { supported: false, reason: 'Removing this declaration would rediscover its standalone file.' };
		}
		if (enabled) { enableAgentByName(path.dirname(record.configPath), record.configPath, record.roleKey!); }
		else { disableAgentByName(path.dirname(record.configPath), record.configPath, record.roleKey!); }
		return { supported: true, changed: true };
	}
	const activePath = record.agentPath.endsWith(DISABLED_SUFFIX) ? record.agentPath.slice(0, -DISABLED_SUFFIX.length) : record.agentPath;
	if (records.some((item) => item.definitionFormat === 'declaration' && path.resolve(item.agentPath) === activePath)) {
		return { supported: false, reason: 'A declaration references this file; renaming it would break that reference.' };
	}
	const target = enabled ? record.agentPath.slice(0, -DISABLED_SUFFIX.length) : `${record.agentPath}${DISABLED_SUFFIX}`;
	if (fs.existsSync(target)) { return { supported: false, reason: 'Destination already exists; user data will not be overwritten.' }; }
	// Reject linked roots/ancestors as well as linked entries before mutating paths.
	if (fs.realpathSync(record.agentPath) !== path.resolve(record.agentPath)) {
		return { supported: false, reason: 'Linked Agent paths cannot be renamed safely.' };
	}
	fs.renameSync(record.agentPath, target);
	return { supported: true, changed: true };
}
