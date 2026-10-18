declare module 'toml' {
	export function parse(input: string): Record<string, unknown>;
}

// The installed toml parser exposes source locations before compilation.
declare module 'toml/lib/parser' {
	export type ValueNode = {
		type: string;
		value: unknown;
		key?: string;
		line: number;
		column: number;
	};
	export type StatementNode = {
		type: 'Assign' | 'ObjectPath' | 'ArrayPath';
		value: ValueNode | string[];
		key?: string;
		line: number;
		column: number;
	};
	export function parse(input: string): StatementNode[];
}
