function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Three-way merge of persisted state. `base` is what this writer loaded, `local` is what it wants to
 * save, `current` is what is persisted now. Only the writer's own changes (local vs base) are applied
 * on top of `current`, so settings, ignore lists or mappings changed elsewhere in the meantime (for
 * example while a preview was open) are not reverted by a stale snapshot. Conflicting scalar edits
 * resolve in favour of `local`; arrays merge as sets of added and removed items.
 */
export function mergeStateChanges<T>(base: T, local: T, current: T): T {
	// Per-call memo: each subtree is serialized once even though equality is checked at every level.
	const keys = new WeakMap<object, string>();
	const stableKey = (value: unknown): string => {
		if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
		const cached = keys.get(value);
		if (cached !== undefined) return cached;
		const key = Array.isArray(value)
			? `[${value.map(stableKey).join(',')}]`
			: `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stableKey((value as Record<string, unknown>)[name])}`).join(',')}}`;
		keys.set(value, key);
		return key;
	};

	const mergeArrays = (base: readonly unknown[], local: readonly unknown[], current: readonly unknown[]): unknown[] => {
		const baseKeys = new Set(base.map(stableKey));
		const localKeys = new Set(local.map(stableKey));
		const removed = new Set([...baseKeys].filter((key) => !localKeys.has(key)));
		const result = current.filter((item) => !removed.has(stableKey(item)));
		const present = new Set(result.map(stableKey));
		for (const item of local) {
			const key = stableKey(item);
			if (baseKeys.has(key) || present.has(key)) continue;
			result.push(item);
			present.add(key);
		}
		return result;
	};

	const merge = (base: unknown, local: unknown, current: unknown): unknown => {
		if (stableKey(local) === stableKey(base)) return current;
		if (stableKey(current) === stableKey(base)) return local;
		if (Array.isArray(base) && Array.isArray(local) && Array.isArray(current)) return mergeArrays(base, local, current);
		if (isRecord(base) && isRecord(local) && isRecord(current)) {
			const result: Record<string, unknown> = {};
			for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(current)])) {
				const merged = merge(base[key], local[key], current[key]);
				if (merged !== undefined) result[key] = merged;
			}
			return result;
		}
		return local;
	};

	return merge(base, local, current) as T;
}
