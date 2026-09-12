export interface ParsedFrontmatter {
	frontmatter: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		if (trimmed.startsWith('"')) {
			try {
				return JSON.parse(trimmed) as string;
			} catch {
				return trimmed.slice(1, -1);
			}
		}
		return trimmed.slice(1, -1).replaceAll("''", "'");
	}
	return trimmed;
}

function parseScalar(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === '') return '';
	if (trimmed === 'null' || trimmed === '~') return null;
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		return trimmed
			.slice(1, -1)
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item.length > 0)
			.map(parseScalar);
	}
	return unquote(trimmed);
}

function parseYamlLines(lines: readonly string[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line.trim() === '' || line.trimStart().startsWith('#')) {
			index += 1;
			continue;
		}
		const separator = line.indexOf(':');
		if (separator <= 0) {
			index += 1;
			continue;
		}
		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();
		if (rawValue.length > 0) {
			result[key] = parseScalar(rawValue);
			index += 1;
			continue;
		}
		const items: unknown[] = [];
		let cursor = index + 1;
		while (cursor < lines.length && lines[cursor].trimStart().startsWith('- ')) {
			items.push(parseScalar(lines[cursor].trimStart().slice(2)));
			cursor += 1;
		}
		result[key] = cursor > index + 1 ? items : null;
		index = cursor;
	}
	return result;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
	const normalized = content.replaceAll('\r\n', '\n');
	if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized, hasFrontmatter: false };
	const closing = normalized.indexOf('\n---', 4);
	if (closing < 0) return { frontmatter: {}, body: normalized, hasFrontmatter: false };
	const markerEnd = closing + 4;
	const frontmatterText = normalized.slice(4, closing);
	const body = normalized.slice(markerEnd).replace(/^\n/, '');
	return { frontmatter: parseYamlLines(frontmatterText.split('\n')), body, hasFrontmatter: true };
}

function scalarToYaml(value: unknown): string {
	if (value === null) return 'null';
	if (typeof value === 'string') return /^[A-Za-z0-9_.:/+-]+$/.test(value) ? value : JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

function serializeProperty(key: string, value: unknown): string[] {
	if (Array.isArray(value)) return [key + ':', ...value.map((item) => `  - ${scalarToYaml(item)}`)];
	return [`${key}: ${scalarToYaml(value)}`];
}

export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
	const lines = Object.entries(frontmatter).flatMap(([key, value]) => serializeProperty(key, value));
	return `---\n${lines.join('\n')}\n---\n${body}`;
}

export function applyManagedProperties(content: string, managedProperties: Record<string, unknown>): string {
	const parsed = parseFrontmatter(content);
	const frontmatter = { ...parsed.frontmatter };
	for (const [key, value] of Object.entries(managedProperties)) {
		if (value !== undefined && value !== null) frontmatter[key] = value;
	}
	return serializeNote(frontmatter, parsed.body);
}
