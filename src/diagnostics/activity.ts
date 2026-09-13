import type { ActivityEntry } from '../state/schema';

export const ACTIVITY_KINDS = [
	'sync-success',
	'sync-partial',
	'sync-failed',
	'account-connected',
	'account-disconnected',
] as const;

export type ActivityKind = typeof ACTIVITY_KINDS[number];

export type RecentActivityEntry = Omit<ActivityEntry, 'kind' | 'data'> & {
	kind: ActivityKind;
	data?: Record<string, unknown>;
};

export type ActivityEntryInput = RecentActivityEntry;

export const MAX_RECENT_ACTIVITY = 50;
export const MAX_ACTIVITY_ENTRIES = MAX_RECENT_ACTIVITY;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function cloneValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (!isObject(value)) return value;
	const existing = seen.get(value);
	if (existing !== undefined) return existing;
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		seen.set(value, result);
		for (const item of value) result.push(cloneValue(item, seen));
		return result;
	}
	const result: Record<string, unknown> = {};
	seen.set(value, result);
	for (const [key, nested] of Object.entries(value)) result[key] = cloneValue(nested, seen);
	return result;
}

function cloneEntry(entry: ActivityEntry): RecentActivityEntry {
	const clone: RecentActivityEntry = {
		id: entry.id,
		createdAt: entry.createdAt,
		kind: entry.kind as ActivityKind,
		message: entry.message,
	};
	if (entry.data !== undefined) clone.data = cloneValue(entry.data, new WeakMap<object, unknown>()) as Record<string, unknown>;
	return clone;
}

export function listRecentActivity(entries: readonly ActivityEntry[]): RecentActivityEntry[] {
	return entries.slice(-MAX_RECENT_ACTIVITY).map(cloneEntry);
}

export function appendRecentActivity(entries: readonly ActivityEntry[], entry: ActivityEntryInput): RecentActivityEntry[] {
	return [...listRecentActivity(entries), cloneEntry(entry)].slice(-MAX_RECENT_ACTIVITY);
}

export class RecentActivityLog {
	private entries: RecentActivityEntry[];

	constructor(entries: readonly ActivityEntry[] = []) {
		this.entries = listRecentActivity(entries);
	}

	append(entry: ActivityEntryInput): RecentActivityEntry[] {
		this.entries = appendRecentActivity(this.entries, entry);
		return this.list();
	}

	list(): RecentActivityEntry[] {
		return listRecentActivity(this.entries);
	}
}
