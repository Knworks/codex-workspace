import * as toml from 'toml';
import { parse, ValueNode } from 'toml/lib/parser';

/** Extract a complete role using the same grammar as declaration discovery. */
export function extractAgentDeclaration(
	contents: string,
	agentId: string,
): { contents: string; block?: string; removed: boolean } {
	const document = toml.parse(contents);
	const agents = document.agents as Record<string, unknown> | undefined;
	const role = agents?.[agentId];
	if (!role || typeof role !== 'object' || Array.isArray(role)) {
		return { contents, removed: false };
	}
	const nodes = parse(contents);
	const lines = contents.split('\n');
	const offsets = [0];
	for (const line of lines) { offsets.push(offsets[offsets.length - 1] + line.length + 1); }
	let context: string[] = [];
	const edits: { start: number; end: number; replacement: string }[] = [];
	const blocks: string[] = [];
	let remainingAgents = '';
	for (let i = 0; i < nodes.length; i += 1) {
		const node = nodes[i];
		if (node.type !== 'Assign') {
			context = node.value as string[];
			if (context[0] !== 'agents' || context[1] !== agentId) { continue; }
			let next = i + 1;
			while (next < nodes.length && nodes[next].type === 'Assign') { next += 1; }
			const start = offsets[node.line - 1];
			const end = next < nodes.length ? offsets[nodes[next].line - 1] : contents.length;
			blocks.push(contents.slice(start, end));
			edits.push({ start, end, replacement: '' });
			i = next - 1;
			continue;
		}
		const value = node.value as ValueNode;
		const start = offsets[node.line - 1];
		const end = i + 1 < nodes.length ? offsets[nodes[i + 1].line - 1] : contents.length;
		if (context.length === 1 && context[0] === 'agents' && node.key === agentId) {
			blocks.push(renderRole(agentId, value, contents));
			edits.push({ start, end, replacement: '' });
		} else if (context.length === 0 && node.key === 'agents' && value.type === 'InlineTable') {
			const entries = value.value as ValueNode[];
			const target = entries.find((entry) => entry.key === agentId);
			if (!target) { continue; }
			blocks.push(renderRole(agentId, target.value as ValueNode, contents));
			const remaining = entries.filter((entry) => entry !== target);
			// Expand the root inline table so restored role tables can be appended legally.
			remainingAgents = `\n[agents]\n${remaining.map((entry) => renderEntry(entry, contents)).join('\n')}\n`;
			edits.push({ start, end, replacement: '' });
		}
	}
	if (edits.length === 0) { throw new Error(`Cannot extract agent declaration: ${agentId}`); }
	let next = contents;
	for (const edit of edits.reverse()) {
		next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
	}
	next += remainingAgents;
	const block = `${blocks.join('\n').trimEnd()}\n`;
	// Validate both fragments before callers persist either of them.
	toml.parse(next);
	toml.parse(block);
	return { contents: next, block, removed: true };
}

function renderRole(agentId: string, value: ValueNode, source: string): string {
	if (value.type !== 'InlineTable') { throw new Error(`Invalid role: ${agentId}`); }
	return `[agents.${JSON.stringify(agentId)}]\n${(value.value as ValueNode[]).map((entry) => renderEntry(entry, source)).join('\n')}\n`;
}

function renderEntry(entry: ValueNode, source: string): string {
	const key = /^[A-Za-z0-9_-]+$/.test(entry.key ?? '') ? entry.key : JSON.stringify(entry.key);
	return `${key} = ${renderValue(entry.value as ValueNode, source)}`;
}

function renderValue(node: ValueNode, source: string): string {
	if (node.type === 'InlineTable') {
		return `{ ${(node.value as ValueNode[]).map((entry) => renderEntry(entry, source)).join(', ')} }`;
	}
	if (node.type === 'Array') { return `[${(node.value as ValueNode[]).map((value) => renderValue(value, source)).join(', ')}]`; }
	if (typeof node.value === 'string') { return JSON.stringify(node.value); }
	if (node.value instanceof Date || typeof node.value === 'boolean' || typeof node.value === 'number') {
		// Keep numeric types, precision and date offsets exactly as written.
		const offset = source.split('\n').slice(0, node.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + node.column - 1;
		const literal = source.slice(offset).match(/^[^\s,\]}#]+/);
		if (literal) { return literal[0]; }
	}
	throw new Error(`Unsupported TOML value: ${node.type}`);
}
