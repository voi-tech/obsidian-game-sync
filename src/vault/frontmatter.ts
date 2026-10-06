import { isMap, isNode, isScalar, parseDocument, visit, type Document } from 'yaml';

export interface ParsedFrontmatter {
	frontmatter: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
}

export class InvalidFrontmatterError extends Error {
	constructor() {
		super('Invalid or ambiguous YAML frontmatter; repair the note before syncing.');
		this.name = 'InvalidFrontmatterError';
	}
}

function splitFrontmatter(content: string): { prefix: string; yaml: string; suffix: string; body: string; newline: string } | undefined {
	const opening = /^\uFEFF?---[^\S\r\n]*\r?\n/.exec(content);
	if (opening === null) return undefined;
	const rest = content.slice(opening[0].length);
	const closing = /^---[^\S\r\n]*(?:\r?\n|$)/m.exec(rest);
	if (closing === null) throw new InvalidFrontmatterError();
	return { prefix: opening[0], yaml: rest.slice(0, closing.index), suffix: rest.slice(closing.index), body: rest.slice(closing.index + closing[0].length), newline: opening[0].endsWith('\r\n') ? '\r\n' : '\n' };
}

function readYaml(text: string): Document {
	const document: Document = parseDocument(text, { prettyErrors: false });
	if (document.errors.length > 0 || document.warnings.length > 0) throw new InvalidFrontmatterError();
	if (document.contents === null) document.contents = document.createNode({});
	if (!isMap(document.contents)) throw new InvalidFrontmatterError();
	return document;
}

function propertiesOf(document: Document): Record<string, unknown> {
	try {
		return document.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
	} catch {
		throw new InvalidFrontmatterError();
	}
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
	const parts = splitFrontmatter(content);
	if (parts === undefined) return { frontmatter: {}, body: content, hasFrontmatter: false };
	return { frontmatter: propertiesOf(readYaml(parts.yaml)), body: parts.body, hasFrontmatter: true };
}

function scalarToYaml(value: unknown): string {
	if (value === null) return 'null';
	if (typeof value === 'string') {
		const plainString = /^[A-Za-z_][A-Za-z0-9_.:/+-]*$/.test(value) && !/^(?:true|false|null|yes|no|on|off|y|n)$/i.test(value);
		return plainString ? value : JSON.stringify(value);
	}
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

function serializeProperty(key: string, value: unknown): string[] {
	key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
	if (Array.isArray(value)) return value.length === 0 ? [`${key}: []`] : [key + ':', ...value.map((item) => `  - ${scalarToYaml(item)}`)];
	return [`${key}: ${scalarToYaml(value)}`];
}

export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
	const lines = Object.entries(frontmatter).flatMap(([key, value]) => serializeProperty(key, value));
	return `---\n${lines.join('\n')}\n---\n${body}`;
}

export function applyManagedProperties(content: string, managedProperties: Record<string, unknown>): string {
	return updateFrontmatter(content, (frontmatter) => applyManagedFrontmatter(frontmatter, managedProperties));
}

/** Called inside Vault.process so preview validation and mutation share one atomic read. */
export function updateFrontmatter(content: string, updater: (frontmatter: Record<string, unknown>) => void): string {
	const parts = splitFrontmatter(content);
	if (parts === undefined) {
		const frontmatter: Record<string, unknown> = {};
		updater(frontmatter);
		return serializeNote(frontmatter, content);
	}
	const document = readYaml(parts.yaml);
	const before = propertiesOf(document);
	const after = structuredClone(before);
	updater(after);
	const changed = new Set<string>();
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (Object.hasOwn(before, key) === Object.hasOwn(after, key) && JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
		changed.add(key);
		if (Object.hasOwn(after, key)) document.set(key, after[key]);
		else {
			if (isMap(document.contents)) {
				const pair = document.contents.items.find((item) => isScalar(item.key) && item.key.value === key);
				const comments = [document.commentBefore, ...[pair?.key, pair?.value].flatMap((node) => isNode(node) ? [node.commentBefore, node.comment] : [])];
				document.commentBefore = comments.filter(Boolean).join('\n') || null;
			}
			document.delete(key);
		}
		const node = document.get(key, true);
		if (isNode(node)) visit(node, { Scalar: (_key, scalar) => {
			if (typeof scalar.value === 'string' && scalarToYaml(scalar.value).startsWith('"')) scalar.type = 'QUOTE_DOUBLE';
		} });
	}
	if (changed.size === 0) return content;
	// Anchors must not let a managed change alter an unrelated user property.
	const written = propertiesOf(document);
	for (const key of Object.keys(before)) {
		if (!changed.has(key) && JSON.stringify(before[key]) !== JSON.stringify(written[key])) throw new InvalidFrontmatterError();
	}
	const yaml = document.toString({ lineWidth: 0 }).replaceAll('\n', parts.newline);
	return `${parts.prefix}${yaml}${parts.suffix}`;
}

export function applyManagedFrontmatter(frontmatter: Record<string, unknown>, managedProperties: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(managedProperties)) {
		if (value !== undefined && value !== null) frontmatter[key] = value;
	}
}

export interface ManagedFrontmatterSnapshot {
	present: boolean;
	value?: unknown;
}

function copyValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(copyValue);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, copyValue(nested)]));
	}
	return value;
}

export function captureManagedFrontmatter(
	frontmatter: Record<string, unknown>,
	managedProperties: Record<string, unknown>,
): Record<string, ManagedFrontmatterSnapshot> {
	return Object.fromEntries(Object.keys(managedProperties).map((key) => [key, {
		present: Object.prototype.hasOwnProperty.call(frontmatter, key),
		value: copyValue(frontmatter[key]),
	}]));
}

export function restoreManagedFrontmatter(
	frontmatter: Record<string, unknown>,
	snapshot: Readonly<Record<string, ManagedFrontmatterSnapshot>>,
): void {
	for (const [key, previous] of Object.entries(snapshot)) {
		if (previous.present) frontmatter[key] = copyValue(previous.value);
		else delete frontmatter[key];
	}
}
