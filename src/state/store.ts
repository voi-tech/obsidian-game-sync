import { migrateState } from './migrations';
import type { GameSyncData } from './schema';
import { sanitizeDiagnosticData } from '../auth/sanitize';

export interface StateStore {
	load(): Promise<GameSyncData>;
	save(data: GameSyncData): Promise<void>;
}

export function createStateStore(
	loadData: () => Promise<unknown>,
	saveData: (data: GameSyncData) => Promise<void>,
	secretValues: readonly string[] = [],
): StateStore {
	return {
		async load(): Promise<GameSyncData> {
			return migrateState(await loadData());
		},
		async save(data: GameSyncData): Promise<void> {
			const validated = migrateState(data);
			const sanitized = sanitizeDiagnosticData(validated, secretValues);
			await saveData(migrateState(sanitized));
		},
	};
}
