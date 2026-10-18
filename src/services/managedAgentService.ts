import fs from 'fs';
import path from 'path';
import * as toml from 'toml';
import { parse, ValueNode } from 'toml/lib/parser';
import { AgentLocation, getAgentLocations } from './agentLocations';
import { AgentManagerRecord, deleteAgentFile, editAgentFile, getAgentManagerStorePath, listAgentConfigSources, sameAgentPath } from './agentManagerService';
import { CliAgentRecord, listCliAgentRecords, readAgentDefinition, setCliAgentEnabled } from './cliAgentService';
import { appendAgentConfigRawBlock, buildAgentConfigBlockWithPath } from './agentConfigService';
import { listDisabledAgentIds } from './disabledAgentsStore';
import { writeAgentFile } from './agentFileStore';

export type ManagedAgentRecord = AgentManagerRecord & {
	definitionFormat: CliAgentRecord['definitionFormat'] | 'candidate';
	availability: CliAgentRecord['availability'] | 'candidate' | 'missing';
	roleKey?: string;
	reason?: string;
};

/** Both views use this read-only inventory; CLI discovery and validation remain authoritative. */
export function listManagedAgentRecords(configPath: string, locations: AgentLocation[] = getAgentLocations()): ManagedAgentRecord[] {
	const records = listCliAgentRecords(configPath, locations);
	return records.flatMap((record) => {
		let details: Record<string, unknown> = {};
		try { details = toml.parse(fs.readFileSync(record.agentPath, 'utf8')) as Record<string, unknown>; } catch { /* Diagnostics come from discovery. */ }
		const candidate = record.definitionFormat === 'standalone' && !record.agentPath.endsWith('.disabled')
			&& details.name === undefined && !readAgentDefinition(record.agentPath, false).reason;
		if (candidate && records.some((other) => other.definitionFormat === 'declaration' && sameAgentPath(other.agentPath, record.agentPath))) { return []; }
		const missing = !!record.configFile && !fs.existsSync(record.agentPath);
		const text = (key: string) => typeof details[key] === 'string' ? details[key] as string : '継承';
		return [{ ...record, name: record.name || path.basename(record.agentPath, '.toml'),
			definitionFormat: candidate ? 'candidate' : record.definitionFormat,
			availability: missing ? 'missing' : candidate ? 'candidate' : record.availability,
			reason: missing ? `Referenced Agent file does not exist: ${record.agentPath}` : candidate ? undefined : record.reason,
			model: text('model'), reasoningEffort: text('model_reasoning_effort'), sandboxMode: text('sandbox_mode'),
			previewContent: typeof details.developer_instructions === 'string' ? details.developer_instructions : '',
		} satisfies ManagedAgentRecord];
	});
}

/** Resolve again before each operation. Paths alone are accepted only when unambiguous. */
export function resolveManagedAgent(configPath: string, target: { id?: string; agentPath?: string }, locations: AgentLocation[] = getAgentLocations()): ManagedAgentRecord {
	const records = listManagedAgentRecords(configPath, locations);
	const matches = records.filter((record) => target.id ? record.id === target.id : !!target.agentPath && sameAgentPath(record.agentPath, target.agentPath));
	if (matches.length !== 1) { throw new Error('Agent definition changed or is ambiguous. Refresh and select its configuration source.'); }
	return matches[0];
}

export function setManagedAgentEnabled(configPath: string, id: string, enabled: boolean, locations: AgentLocation[] = getAgentLocations()): boolean {
	const record = resolveManagedAgent(configPath, { id }, locations);
	if (record.availability === 'candidate') { throw new Error('Select a configuration source and register this candidate first.'); }
	const result = setCliAgentEnabled(configPath, id, enabled, locations);
	if (!result.supported) { throw new Error(result.reason); }
	return result.changed;
}

/** Explicit registration never restores an unrelated same-name backup or overwrites a declaration. */
export function registerManagedAgent(configPath: string, id: string, sourcePath: string, description: string,
	locations: AgentLocation[] = getAgentLocations()): void {
	const record = resolveManagedAgent(configPath, { id }, locations);
	if (record.definitionFormat !== 'candidate') { throw new Error('Only declaration candidates need registration.'); }
	const source = listAgentConfigSources(configPath, locations).find((item) => sameAgentPath(item.configPath, sourcePath));
	if (!source) { throw new Error('Configuration source no longer exists.'); }
	const contents = fs.existsSync(source.configPath) ? fs.readFileSync(source.configPath, 'utf8') : '';
	const parsed = toml.parse(contents) as { agents?: Record<string, unknown> };
	const role = record.name;
	if (Object.prototype.hasOwnProperty.call(parsed.agents ?? {}, role)
		|| listDisabledAgentIds(getAgentManagerStorePath(source.configPath)).includes(role)) {
		throw new Error(`Agent role already exists in the selected source: ${role}`);
	}
	if (!description.trim()) { throw new Error('A non-empty description is required.'); }
	const next = appendAgentConfigRawBlock(contents, buildAgentConfigBlockWithPath(role, description,
		path.relative(path.dirname(source.configPath), record.agentPath).replace(/\\/g, '/')));
	toml.parse(next);
	fs.mkdirSync(path.dirname(source.configPath), { recursive: true });
	writeAgentFile(source.configPath, next);
}

function requireExclusiveFile(configPath: string, record: ManagedAgentRecord, locations: AgentLocation[]): void {
	if (!record.configFile || !fs.existsSync(record.agentPath)) { throw new Error('Open the configuration source to edit or remove this declaration.'); }
	if (listManagedAgentRecords(configPath, locations).some((other) => other.id !== record.id && sameAgentPath(other.agentPath, record.agentPath))) {
		throw new Error('Another definition uses this file. Open its source to edit references without changing other definitions.');
	}
}

export function deleteManagedAgent(configPath: string, id: string, locations: AgentLocation[] = getAgentLocations()): void {
	const record = resolveManagedAgent(configPath, { id }, locations);
	requireExclusiveFile(configPath, record, locations);
	deleteAgentFile(record.agentPath, configPath, locations);
}

export function editManagedAgent(configPath: string, id: string, nextPath: string, description: string,
	locations: AgentLocation[] = getAgentLocations()): void {
	const record = resolveManagedAgent(configPath, { id }, locations);
	requireExclusiveFile(configPath, record, locations);
	if (!sameAgentPath(record.agentPath, nextPath) && fs.existsSync(nextPath)) { throw new Error('Destination already exists.'); }
	if (record.definitionFormat !== 'standalone') {
		const original = fs.readFileSync(record.agentPath, 'utf8');
		const details = toml.parse(original) as { description?: unknown };
		const contents = typeof details.description === 'string' ? updateStandaloneDescription(original, description) : original;
		if (contents !== original) { writeAgentFile(record.agentPath, contents); }
		try {
			editAgentFile(record.agentPath, nextPath, { configPath: record.configPath, name: record.roleKey ?? record.name }, description, configPath, locations);
		} catch (error) {
			if (contents !== original) { writeAgentFile(record.agentPath, original); }
			throw error;
		}
		return;
	}
	// Preserve the CLI name when changing the filename; only the selected definition's metadata changes.
	const original = fs.readFileSync(record.agentPath, 'utf8');
	const contents = updateStandaloneDescription(original, description);
	toml.parse(contents);
	writeAgentFile(record.agentPath, contents);
	try { if (!sameAgentPath(record.agentPath, nextPath)) { fs.renameSync(record.agentPath, nextPath); } }
	catch (error) { writeAgentFile(record.agentPath, original); throw error; }
}

export function getManagedAgentOpenPath(record: ManagedAgentRecord): string {
	return record.availability === 'missing' ? record.configPath : record.agentPath;
}

/** Replace the root scalar at parser positions, preserving literal/multiline strings and comments elsewhere. */
function updateStandaloneDescription(contents: string, description: string): string {
	if (!description.trim()) { throw new Error('A non-empty description is required.'); }
	for (const node of parse(contents)) {
		if (node.type !== 'Assign') { break; }
		if (node.key !== 'description') { continue; }
		const value = node.value as ValueNode;
		if (value.type !== 'String') { throw new Error('Invalid Agent description.'); }
		const lines = contents.split('\n');
		const start = lines.slice(0, value.line - 1).reduce((length, line) => length + line.length + 1, 0) + value.column - 1;
		const quote = contents[start];
		const delimiter = contents.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
		let end = start + delimiter.length;
		while (end < contents.length) {
			if (quote === '"' && contents[end] === '\\') { end += 2; continue; }
			if (contents.startsWith(delimiter, end)) { end += delimiter.length; break; }
			end += 1;
		}
		return contents.slice(0, start) + JSON.stringify(description).replace(/\u007f/g, '\\u007f') + contents.slice(end);
	}
	throw new Error('Agent description no longer exists. Refresh and open the file.');
}
