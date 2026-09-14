import { describe, expect, it, vi } from 'vitest';
import type { CanonicalLibrarySnapshot, LibraryProvider as GameProvider } from '../src/model/canonical-provider';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import type { GameSyncData } from '../src/state/schema';
import type { StateStore } from '../src/state/store';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { FakeVaultGateway } from './fake-gateway';
import type { GameEnricher } from '../src/model/enrichment';

class MemoryStateStore implements StateStore {
	constructor(public state: GameSyncData) {}
	async load(): Promise<GameSyncData> { return structuredClone(this.state); }
	async save(state: GameSyncData): Promise<void> { this.state = structuredClone(state); }
}

const snapshot: CanonicalLibrarySnapshot = {
	status: 'complete',
	games: [],
	diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 0, gamesNormalized: 0, diagnostics: [] },
};

const provider: GameProvider = {
	id: 'gametrack',
	getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: true, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
	isAvailable: async () => true,
	getSnapshot: async () => snapshot,
	getLibrary: async () => [],
	getDiagnostics: () => snapshot.diagnostics,
};

function state(): GameSyncData {
	return migrateState({ settings: { ...DEFAULT_SETTINGS, libraryProvider: 'gametrack' } });
}

describe('provider-neutral background composition', () => {
	it('requires explicit GameTrack approval and invalidates it when the source changes', async () => {
		const store = new MemoryStateStore(state());
		store.state.settings.gametrackExportPath = '/private/tmp/GameTrack_Export.zip';
		store.state.settings.gametrackExportSize = 42;
		store.state.settings.gametrackExportModifiedAt = 100;
		const composition = new GameSyncRuntimeComposition({ stateStore: store, gateway: new FakeVaultGateway(), canonicalProvider: provider });
		const executor = composition.createSyncExecutor();

		const first = await executor.preview();
		expect(first.approvalRequired).toBe(true);
		await expect(executor.apply(first, [])).rejects.toThrow('explicit preview approval');

		await composition.approveCanonicalBackgroundSync();
		const approved = await executor.preview();
		expect(approved.approvalRequired).toBe(false);

		store.state.settings.gametrackExportModifiedAt = 101;
		await expect(executor.apply(approved, [])).rejects.toThrow('source changed');
	});

	it('uses the last imported GameTrack snapshot for background enrichment without rereading the export', async () => {
		const store = new MemoryStateStore(state());
		store.state.settings.gametrackExportPath = '/private/tmp/GameTrack_Export.zip';
		const getSnapshot = vi.fn(async () => snapshot);
		const enrich = vi.fn(async () => ({ source: 'steam', status: 'success' as const, retrievedAt: '2026-09-14T12:00:00.000Z', patches: [], diagnostics: [] }));
		const enricher: GameEnricher = { id: 'steam', getCapabilities: () => ({ playtime: true, activity: true, achievementSummary: true, achievementDetails: true }), enrich };
		const composition = new GameSyncRuntimeComposition({ stateStore: store, gateway: new FakeVaultGateway(), canonicalProvider: { ...provider, getSnapshot }, createEnrichers: () => [enricher] });

		await composition.createSyncExecutor().preview();
		await composition.createSyncExecutor({ background: true }).preview();

		expect(getSnapshot).toHaveBeenCalledOnce();
		expect(enrich).toHaveBeenCalledTimes(2);
	});
});
