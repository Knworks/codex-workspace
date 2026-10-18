/** Generate only new, untemplated definitions for the CLI 0.163.0 contract. */
export function createAgentScaffold(name: string, description: string): string {
	const initialDescription = description.trim()
		? description
		: 'TODO: Describe when to use this agent.';
	const instructions = description.trim()
		? description
		: 'TODO: Add instructions for this agent.';
	return [
		'# =========================================',
		`# name: ${toTomlString(name).slice(1, -1)}`,
		`# description: ${toTomlString(description).slice(1, -1)}`,
		'# =========================================',
		'',
		`name = ${toTomlString(name)}`,
		`description = ${toTomlString(initialDescription)}`,
		`developer_instructions = ${toTomlString(instructions)}`,
		'',
	].join('\n');
}

function toTomlString(value: string): string {
	// JSON basic-string escapes are valid TOML; DEL also needs escaping in TOML.
	return JSON.stringify(value).replace(/\u007f/g, '\\u007f');
}
