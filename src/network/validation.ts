/** Helpers for validating third-party API responses at the provider boundary. */

/** APIs often send `null` for absent optional fields; treat it the same as a missing key. */
export function withoutNulls(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutNulls);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, withoutNulls(entry)]));
}

export interface SchemaIssues { issues: readonly { path: readonly PropertyKey[] }[] }
export type SafeParseSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false; error: SchemaIssues } };

/** Field paths of failed checks (list indexes as `#`), never the values, so they are safe in diagnostics. */
export function issuePaths(error: SchemaIssues): string[] {
	return error.issues.map((issue) => issue.path.map((part) => typeof part === 'number' ? '#' : String(part)).join('.') || '(root)');
}

/** A short, value-free description of where a response failed validation. */
export function describeIssues(paths: readonly string[]): string {
	return paths.length === 0 ? '' : ` at ${[...new Set(paths)].slice(0, 5).join(', ')}`;
}

/**
 * Validates a list item by item, so one malformed entry cannot discard the rest. Returns the valid items, the
 * number dropped and their field paths. A list where every item failed means the format changed: the caller
 * decides how to fail.
 */
export function validateItems<T>(schema: SafeParseSchema<T>, list: readonly unknown[]): { items: T[]; dropped: number; paths: string[] } {
	const items: T[] = [];
	const paths: string[] = [];
	for (const item of list) {
		const parsed = schema.safeParse(withoutNulls(item));
		if (parsed.success) items.push(parsed.data);
		else paths.push(...issuePaths(parsed.error));
	}
	return { items, dropped: list.length - items.length, paths };
}
