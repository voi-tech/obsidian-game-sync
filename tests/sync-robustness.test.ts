import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { NormalizedGame } from '../src/model/game';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { CanonicalPartialApplyError, CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { SyncPlanner } from '../src/sync/planner';
import { SyncExecutor } from '../src/sync/executor';
import { VaultWriter } from '../src/vault/writer';
import { buildNoteIndex } from '../src/vault/note-index';
import { migrateState } from '../src/state/migrations';
import { mergeStateChanges } from '../src/state/merge';
import { createStateStore } from '../src/state/store';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { FakeVaultGateway } from './fake-gateway';

function game(id = 'one', overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: { canonicalKey: `gametrack:${id}`, externalIds: { gametrack: id } },
		title: id === 'one' ? 'One' : 'Two',
		metadata: { developers: [], publishers: [], genres: [] },
		platforms: [{ id: 'pc', source: 'gametrack', owned: true }],
		playtime: { canonical: { minutes: 30, source: 'gametrack', confidence: 'high' }, observations: [] },
		provenance: { provider: 'gametrack', sourceId: id, schemaSignature: 'test' },
		...overrides,
	};
}

const filters = { includeUnplayed: true, includeFreeToPlay: true, includePreviouslyPlayedNoLongerOwned: true };

function gameTrackComposition(state: ReturnType<typeof migrateState>, games: CanonicalGame[], gateway = new FakeVaultGateway()) {
	const snapshot = { status: 'complete' as const, games, diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unknown' as const, gamesRead: games.length, gamesNormalized: games.length, diagnostics: [] } };
	return new GameSyncRuntimeComposition({
		stateStore: { load: async () => structuredClone(state), save: async () => undefined },
		gateway,
		adapters: [],
		canonicalProvider: {
			id: 'gametrack', getSnapshot: async () => snapshot, getLibrary: async () => snapshot.games,
			isAvailable: async () => true, getDiagnostics: () => snapshot.diagnostics,
			getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
		},
	});
}

describe('GameTrack sync honours the ignore list and library filters like Steam/PlayStation sync', () => {
	it('skips a game on the ignored list instead of proposing a note for it', async () => {
		const plan = await planCanonicalSync([game()], { gateway: new FakeVaultGateway(), ignoredCanonicalIds: ['gametrack:one'] });

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]).toMatchObject({ canonicalKey: 'gametrack:one', status: 'skip' });
	});

	it('skips a game whose Steam app is ignored', async () => {
		const value = game('one', { identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', steam: '10' } } });
		const plan = await planCanonicalSync([value], { gateway: new FakeVaultGateway(), ignoredProviderRefs: ['steam:10'] });

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]?.status).toBe('skip');
	});

	it('does not create a note for an unplayed game when unplayed games are excluded, but keeps updating an existing note', async () => {
		const unplayed = (id: string) => game(id, { playtime: { canonical: { minutes: 0, source: 'gametrack', confidence: 'high' }, observations: [] } });
		const gateway = new FakeVaultGateway({ 'Games/Two.md': '---\ngametrack-id: two\n---\nNotes' });
		const plan = await planCanonicalSync([unplayed('one'), unplayed('two')], { gateway, libraryFilters: { ...filters, includeUnplayed: false } });

		expect(plan.statuses.find((status) => status.canonicalKey === 'gametrack:one')?.status).toBe('skip');
		expect(plan.operations.map((operation) => [operation.kind, operation.path])).toEqual([['update', 'Games/Two.md']]);
	});

	it('the GameTrack import reads the ignore list and filters from the saved state', async () => {
		const state = migrateState({ settings: { libraryProvider: 'gametrack', includeUnplayed: false }, ignoredCanonicalIds: ['gametrack:one'] });
		const games = [game('one'), game('two', { playtime: { canonical: { minutes: 0, source: 'gametrack', confidence: 'high' }, observations: [] } })];
		const snapshot = { status: 'complete' as const, games, diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unknown' as const, gamesRead: 2, gamesNormalized: 2, diagnostics: [] } };
		const service = await new GameSyncRuntimeComposition({
			stateStore: { load: async () => structuredClone(state), save: async () => undefined },
			gateway: new FakeVaultGateway(),
			adapters: [],
			canonicalProvider: {
				id: 'gametrack', getSnapshot: async () => snapshot, getLibrary: async () => snapshot.games,
				isAvailable: async () => true, getDiagnostics: () => snapshot.diagnostics,
				getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
			},
		}).createCanonicalService();

		const preview = await service!.preview();
		expect(preview.plan!.operations).toHaveLength(0);
		expect(preview.plan!.statuses.map((status) => status.status)).toEqual(['skip', 'skip']);
	});

	it('a game ignored in Steam sync stays ignored in the GameTrack import', async () => {
		const value = game('one', { identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', steam: '10' } } });
		const state = migrateState({ settings: { libraryProvider: 'gametrack' }, ignoredCanonicalIds: ['game-sync:old'], identityIndex: [{ canonicalId: 'game-sync:old', steamAppId: 10 }] });
		const service = await gameTrackComposition(state, [value]).createCanonicalService();

		expect((await service!.preview()).plan!.statuses.map((status) => status.status)).toEqual(['skip']);
	});

	it('ignoring a game after the preview invalidates that preview', async () => {
		const value = game('one', { identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', steam: '10' } } });
		const state = migrateState({ settings: { libraryProvider: 'gametrack' } });
		const gateway = new FakeVaultGateway();
		const service = await gameTrackComposition(state, [value], gateway).createCanonicalService();
		const preview = await service!.preview();
		expect(preview.plan!.operations).toHaveLength(1);

		state.ignoredProviderRefs.push('steam:10');
		await expect(service!.applyPreview(preview)).rejects.toThrow('Sync configuration changed');
		expect(await gateway.listMarkdownFiles()).toHaveLength(0);
	});

	it('does not treat a game without playtime data as unplayed', async () => {
		const unknown = game('one', { playtime: { observations: [] } });
		const plan = await planCanonicalSync([unknown], { gateway: new FakeVaultGateway(), libraryFilters: { ...filters, includeUnplayed: false } });

		expect(plan.operations.map((operation) => operation.kind)).toEqual(['create']);
	});

	it('does not create a note for a game no longer owned when such games are excluded', async () => {
		const gone = game('one', { platforms: [{ id: 'pc', source: 'gametrack', owned: false }] });
		const plan = await planCanonicalSync([gone], { gateway: new FakeVaultGateway(), libraryFilters: { ...filters, includePreviouslyPlayedNoLongerOwned: false } });

		expect(plan.operations).toHaveLength(0);
	});
});

describe('one broken note does not stop the rest of the batch', () => {
	it('GameTrack: a note with unsupported YAML is skipped and the other notes are written', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Bad.md': '---\ngametrack-id: one\ntitle: &name Old\ncustom: *name\n---\nBody',
			'Games/Healthy.md': '---\ngametrack-id: two\n---\nHealthy',
		});
		const plan = await planCanonicalSync([game('one'), game('two')], { gateway });
		expect(plan.operations).toHaveLength(2);

		const error = await new CanonicalVaultWriter(gateway).apply(plan).then(() => undefined, (caught: unknown) => caught);

		expect(error).toBeInstanceOf(CanonicalPartialApplyError);
		const partial = error as CanonicalPartialApplyError;
		expect(partial.appliedOperationIds).toEqual([plan.operations.find((operation) => operation.path === 'Games/Healthy.md')!.id]);
		expect(partial.failedOperationIds).toEqual([plan.operations.find((operation) => operation.path === 'Games/Bad.md')!.id]);
		expect(await gateway.read('Games/Healthy.md')).toContain('title: Two');
	});

	it('Steam/PlayStation: a note edited after the preview is skipped and the other notes are written', async () => {
		const legacy = (id: string, title: string): NormalizedGame => ({
			canonicalId: `game-sync:${id}`, identity: { canonicalId: `game-sync:${id}`, steamAppId: Number(id === 'one' ? 1 : 2) },
			title, developers: [], publishers: [], genres: [], platforms: ['pc'],
			providers: { steam: { providerGameId: id === 'one' ? '1' : '2', title, developers: [], publishers: [], genres: [], platforms: ['pc'], owned: true, freshness: { metadata: true, ownership: true, playtime: true, achievements: true } } },
			owned: true, acquisitionType: 'unknown', playtimeMinutes: 0,
		});
		const gateway = new FakeVaultGateway();
		const writer = new VaultWriter(gateway);
		await writer.createNote({ path: 'Games/One.md', game: legacy('one', 'One'), expectedNoteFingerprint: null });
		await writer.createNote({ path: 'Games/Two.md', game: legacy('two', 'Two'), expectedNoteFingerprint: null });
		const updated = [legacy('one', 'New One'), legacy('two', 'New Two')];
		const planner = new SyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway) });
		const plan = await planner.plan(updated);
		expect(plan.operations).toHaveLength(2);
		gateway.set('Games/One.md', `${await gateway.read('Games/One.md')}\nUser edit`);

		const result = await new SyncExecutor({ writer, games: updated, currentNoteFingerprints: () => planner.currentNoteFingerprints() }).apply(plan);

		const one = plan.operations.find((operation) => operation.path === 'Games/One.md')!;
		const two = plan.operations.find((operation) => operation.path === 'Games/Two.md')!;
		expect(result.appliedOperationIds).toEqual([two.id]);
		expect(result.failedOperationIds).toEqual([one.id]);
		expect(await gateway.read('Games/One.md')).toContain('User edit');
		expect(await gateway.read('Games/One.md')).not.toContain('New One');
		expect(await gateway.read('Games/Two.md')).toContain('New Two');
	});
});

describe('state is never overwritten with a stale copy', () => {
	it('a merge keeps one note link per game: the saving side wins a concurrent move', () => {
		const base = migrateState({ noteLinks: [{ canonicalId: 'game-sync:one', path: 'Games/A.md' }] });
		const local = migrateState({ noteLinks: [{ canonicalId: 'game-sync:one', path: 'Games/B.md' }] });
		const current = migrateState({ noteLinks: [{ canonicalId: 'game-sync:one', path: 'Games/C.md' }] });

		expect(migrateState(mergeStateChanges(base, local, current)).noteLinks).toEqual([{ canonicalId: 'game-sync:one', path: 'Games/B.md' }]);
	});

	it('concurrent updates are applied one after another on fresh state, so none is lost', async () => {
		let persisted: unknown = {};
		const store = createStateStore(async () => structuredClone(persisted), async (data) => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			persisted = structuredClone(data);
		});

		await Promise.all([
			store.update((state) => { state.ignoredCanonicalIds.push('game-sync:a'); }),
			store.update((state) => { state.settings.notesFolder = 'Library'; }),
			store.update((state) => { state.ignoredProviderRefs.push('steam:1'); }),
		]);

		const state = await store.load();
		expect(state.ignoredCanonicalIds).toEqual(['game-sync:a']);
		expect(state.settings.notesFolder).toBe('Library');
		expect(state.ignoredProviderRefs).toEqual(['steam:1']);
	});

	it('an update that returns false saves nothing', async () => {
		let saves = 0;
		const store = createStateStore(async () => ({}), async () => { saves += 1; });

		await store.update(() => false);
		expect(saves).toBe(0);
	});
});
