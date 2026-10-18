const TABLE_HEADER_PATTERN = /^\s*\[(?:[^\]"']|"(?:[^"\\]|\\.)*"|'[^']*')+\]\s*(?:#.*)?$/;
const ARRAY_TABLE_HEADER_PATTERN = /^\s*\[\[(?:[^\]"']|"(?:[^"\\]|\\.)*"|'[^']*')+\]\]\s*(?:#.*)?$/;

/** Locates headers and value lines outside TOML multiline strings. */
export function scanTomlTableLines(lines: string[]): { headers: Set<number>; valueLines: Set<number> } {
	const headers = new Set<number>();
	const valueLines = new Set<number>();
	let quote: '"' | "'" | undefined;
	let multiline = false;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		if (!quote) {
			valueLines.add(lineIndex);
		}
		if (!quote && (TABLE_HEADER_PATTERN.test(line) || ARRAY_TABLE_HEADER_PATTERN.test(line))) {
			headers.add(lineIndex);
		}
		for (let index = 0; index < line.length; index += 1) {
			const char = line[index];
			if (!quote) {
				if (char === '#') {
					break;
				}
				if (char === '"' || char === "'") {
					quote = char;
					multiline = line.slice(index, index + 3) === char.repeat(3);
					if (multiline) {
						index += 2;
					}
				}
				continue;
			}
			if (quote === '"' && char === '\\') {
				index += 1;
				continue;
			}
			if (char === quote) {
				if (multiline) {
					if (line.slice(index, index + 3) === quote.repeat(3)) {
						quote = undefined;
						multiline = false;
						index += 2;
					}
				} else {
					quote = undefined;
				}
			}
		}
		if (!multiline) {
			quote = undefined;
		}
	}
	return { headers, valueLines };
}
