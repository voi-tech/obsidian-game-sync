import { migrateState } from './migrations';
import type { GameSyncData } from './schema';
import { sanitizePersistedState } from '../auth/sanitize';

/** Changes fresh state in place; return `false` when nothing changed, so nothing is saved. */
export type StateChange = (state: GameSyncData) => void | boolean | Promise<void | boolean>;

export interface StateStore {
	load(): Promise<GameSyncData>;
	save(data: GameSyncData): Promise<void>;
	/**
	 * Load, change and save as one step, queued behind other updates and saves of this store. Use it instead of
	 * load() + save(): two of those running together make the later save overwrite the earlier change.
	 */
	update?(change: StateChange): Promise<void>;
}

/** `store.update()` where available; stores without it (test fakes) get a plain load-change-save. */
export async function updateState(store: StateStore, change: StateChange): Promise<void> {
	if (store.update !== undefined) return store.update(change);
	const state = await store.load();
	if (await change(state) !== false) await store.save(state);
}

/** Replaces the contents of `target` with `next`, for update() callbacks that compute a whole new state. */
export function replaceState(target: GameSyncData, next: GameSyncData): void {
	const record = target as unknown as Record<string, unknown>;
	for (const key of Object.keys(record)) if (!(key in next)) delete record[key];
	Object.assign(target, next);
}

export function createStateStore(
	loadData: () => Promise<unknown>,
	saveData: (data: GameSyncData) => Promise<void>,
	secretValues: readonly string[] = [],
): Required<StateStore> {
	// One queue per store: writes run one at a time, each on the state the previous one saved.
	let queue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
		const result = queue.then(task, task);
		queue = result.catch(() => undefined);
		return result;
	};
	const load = async (): Promise<GameSyncData> => migrateState(await loadData());
	const write = async (data: GameSyncData): Promise<void> => {
		const validated = migrateState(data);
		const sanitized = sanitizePersistedState(validated, secretValues);
		await saveData(migrateState(sanitized));
	};
	return {
		load,
		save: (data) => enqueue(() => write(data)),
		update: (change) => enqueue(async () => {
			const state = await load();
			if (await change(state) !== false) await write(state);
		}),
	};
}
