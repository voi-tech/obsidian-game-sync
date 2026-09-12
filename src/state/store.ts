import { migrateState } from './migrations';
import type { GameSyncData } from './schema';

export interface StateStore {
	load(): Promise<GameSyncData>;
	save(data: GameSyncData): Promise<void>;
}

export function createStateStore(
	loadData: () => Promise<unknown>,
	saveData: (data: GameSyncData) => Promise<void>,
): StateStore {
	return {
		async load(): Promise<GameSyncData> {
			return migrateState(await loadData());
		},
		async save(data: GameSyncData): Promise<void> {
			await saveData(migrateState(data));
		},
	};
}
