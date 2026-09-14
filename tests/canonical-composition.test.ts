import { describe, expect, it } from 'vitest';
import type { CanonicalLibrarySnapshot, LibraryProvider as GameProvider } from '../src/model/canonical-provider';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { migrateState } from '../src/state/migrations';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import type { GameSyncData } from '../src/state/schema';
import type { StateStore } from '../src/state/store';
import { FakeVaultGateway } from './fake-gateway';

class MemoryStateStore implements StateStore {
	constructor(private readonly state: GameSyncData) {}
	async load(): Promise<GameSyncData> { return structuredClone(this.state); }
	async save(): Promise<void> {}
}

function provider(id: 'steam' | 'playstation'): GameProvider {
	const snapshot: CanonicalLibrarySnapshot = {
		status: 'complete', games: [],
		diagnostics: { provider: id, database: 'unavailable', schema: 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [] },
	};
	return {
		id,
		getCapabilities: () => ({ supported: true, desktop: true, mobile: true, automaticSync: true, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
		isAvailable: async () => true,
		getSnapshot: async () => snapshot,
		getLibrary: async () => [],
		getDiagnostics: () => snapshot.diagnostics,
	};
}

describe('canonical library provider composition', () => {
	it.each(['steam', 'playstation'] as const)('selects %s through the canonical executor', async (id) => {
		const state = migrateState({ settings: { ...DEFAULT_SETTINGS, libraryProvider: id } });
		const composition = new GameSyncRuntimeComposition({
			stateStore: new MemoryStateStore(state),
			gateway: new FakeVaultGateway(),
			canonicalProviderFactories: { [id]: async () => provider(id) },
		});

		const preview = await composition.createSyncExecutor().preview();

		expect(preview.providerStatuses).toEqual([{ id, state: 'success' }]);
		expect(preview.status).toBe('complete');
	});

	it('exposes manual GameTrack ZIP as non-automatic through the neutral executor capability', async () => {
		const state = migrateState({ settings: { ...DEFAULT_SETTINGS, libraryProvider: 'gametrack' } });
		const composition = new GameSyncRuntimeComposition({
			stateStore: new MemoryStateStore(state),
			gateway: new FakeVaultGateway(),
			canonicalProvider: { ...provider('steam'), id: 'gametrack' },
		});

		expect(await composition.createSyncExecutor().canRunAutomatically?.()).toBe(false);
	});
});
