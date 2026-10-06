import { describe, expect, it } from 'vitest';
import type { CanonicalLibrarySnapshot, LibraryProvider as GameProvider } from '../src/model/canonical-provider';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { migrateState } from '../src/state/migrations';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import type { GameSyncData } from '../src/state/schema';
import type { StateStore } from '../src/state/store';
import type { GameProviderAdapter } from '../src/providers/provider';
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

function adapter(id: 'steam' | 'playstation'): GameProviderAdapter {
	return {
		id,
		getConnectionStatus: async () => ({ provider: id, state: 'connected', connected: true }),
		testConnection: async () => ({ provider: id, displayName: id, accountId: `${id}-account` }),
		fetchLibrary: async () => ({ provider: id, status: 'complete', games: [], fetchedAt: '2026-09-30T00:00:00.000Z', pagination: { complete: true, pagesFetched: 1 }, paginationComplete: true }),
		disconnect: async () => undefined,
	};
}

describe('direct library provider composition', () => {
	it('fetches every enabled direct provider through the legacy executor', async () => {
		const state = migrateState({ settings: { ...DEFAULT_SETTINGS, enabledProviders: { steam: true, playstation: true } } });
		const composition = new GameSyncRuntimeComposition({
			stateStore: new MemoryStateStore(state),
			gateway: new FakeVaultGateway(),
			adapters: [adapter('steam'), adapter('playstation')],
		});

		const preview = await composition.createSyncExecutor().preview();

		expect(preview.providerStatuses).toEqual([{ id: 'steam', state: 'success' }, { id: 'playstation', state: 'success' }]);
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

	it('requires explicit GameTrack approval before a background apply can write', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState({ settings: { ...DEFAULT_SETTINGS, libraryProvider: 'gametrack' } });
		const composition = new GameSyncRuntimeComposition({
			stateStore: new MemoryStateStore(state),
			gateway,
			canonicalProvider: { ...provider('steam'), id: 'gametrack' },
		});
		const manualService = await composition.createCanonicalService();
		if (manualService === undefined) throw new Error('Expected a canonical service.');
		const manualPreview = await manualService.preview();
		const background = composition.createSyncExecutor({ background: true });
		const backgroundPreview = await background.preview();

		expect(backgroundPreview.approvalRequired).toBe(true);
		await expect(background.apply(backgroundPreview, [])).rejects.toThrow(/explicit preview approval/i);
		expect(await gateway.listMarkdownFiles()).toEqual([]);

		await manualService.applyPreview(manualPreview, { operationIds: [], fieldIdsByOperation: {} });
		await composition.approveCanonicalBackgroundSync();
		const approvedPreview = await background.preview();
		expect(approvedPreview.approvalRequired).toBe(false);
		await expect(background.apply(approvedPreview, [])).resolves.toEqual(expect.objectContaining({ appliedOperationIds: [] }));
	});
});
