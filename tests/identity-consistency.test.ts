import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { NormalizedGame } from '../src/model/game';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { SyncPlanner } from '../src/sync/planner';
import { matchCanonicalVaultNote, matchVaultNote } from '../src/vault/matcher';
import { buildNoteIndex } from '../src/vault/note-index';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { migrateState } from '../src/state/migrations';
import { FakeVaultGateway } from './fake-gateway';
import { createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot } from './fake-provider';
import { CanonicalSyncService } from '../src/sync/canonical-service';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';

const legacy: NormalizedGame = {
	canonicalId: 'game-sync:one', identity: { canonicalId: 'game-sync:one', steamAppId: 1 },
	title: 'One', developers: [], publishers: [], genres: [], platforms: ['pc'],
	providers: { steam: { providerGameId: '1', title: 'One', developers: [], publishers: [], genres: [], platforms: ['pc'], owned: true, freshness: { metadata: true, ownership: true, playtime: true, achievements: true } } },
	owned: true, acquisitionType: 'unknown', playtimeMinutes: 0,
};

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', igdb: 1 } },
		title: 'One',
		metadata: { developers: [], publishers: [], genres: [] },
		platforms: [{ id: 'pc', source: 'gametrack', owned: true }],
		playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'one', schemaSignature: 'test' },
		...overrides,
	};
}

const NO_IDS = { gameSyncId: false, igdbId: false, gametrackId: false, steamId: false, playstationId: false } as const;

function composition(gateway: FakeVaultGateway, value: CanonicalGame, overrides: Record<string, unknown> = {}) {
	const store = { state: migrateState({ settings: { libraryProvider: 'gametrack' }, ...overrides }) };
	const snapshot = { status: 'complete' as const, games: [value], diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unknown' as const, gamesRead: 1, gamesNormalized: 1, diagnostics: [] } };
	const runtime = new GameSyncRuntimeComposition({
		stateStore: { load: async () => structuredClone(store.state), save: async (next) => { store.state = migrateState(structuredClone(next)); } },
		gateway, adapters: [], canonicalProvider: {
			id: 'gametrack', getSnapshot: async () => snapshot, getLibrary: async () => snapshot.games,
			isAvailable: async () => true, getDiagnostics: () => snapshot.diagnostics,
			getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
		},
	});
	return { runtime, store };
}

async function contradictionHarness() {
	const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game')]));
	return createIntegrationHarness({
		initialFiles: { 'Games/A.md': '---\ngame-sync-id: game-sync:example\n---\nA', 'Games/B.md': '---\nsteam-id: "1"\n---\nB' },
		providers: [steam],
		state: { settings: { firstSyncCompleted: true }, identityMappings: [{ canonicalId: 'game-sync:example', provider: 'steam', providerGameId: '1' }] },
	});
}

describe('hand-written note without a year in the file name', () => {
	it('canonical sync offers Games/Returnal.md for review instead of creating Returnal (2021)', async () => {
		const returnal = game({ title: 'Returnal', metadata: { releaseDate: '2021-04-30', developers: [], publishers: [], genres: [] } });
		const gateway = new FakeVaultGateway({ 'Games/Returnal.md': '# Returnal\nMy notes' });
		const plan = await planCanonicalSync([returnal], { gateway, notesFolder: 'Games' });

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]).toMatchObject({ status: 'conflict', path: 'Games/Returnal.md', match: { status: 'review', note: { path: 'Games/Returnal.md' } } });
		expect(await gateway.listMarkdownFiles()).toHaveLength(1);
	});

	it('matches the bare file name loosely (punctuation, trademark) but never by prefix or outside the games folder', async () => {
		const detroit = game({ title: 'Detroit: Become Human™' });
		const loose = new FakeVaultGateway({ 'Games/Detroit - Become Human.md': 'notes' });
		expect(matchCanonicalVaultNote(detroit, await buildNoteIndex(loose), { candidateFolder: 'Games' })).toMatchObject({ status: 'review', method: 'filename-title' });

		const sequelAndFilm = new FakeVaultGateway({ 'Games/One 2.md': 'sequel', 'resources/filmy/One.md': 'film' });
		const plan = await planCanonicalSync([game()], { gateway: sequelAndFilm, notesFolder: 'Games' });
		expect(plan.statuses[0]).toMatchObject({ status: 'create', path: 'Games/One.md' });
	});

	it('does not offer a bare-named note whose release year contradicts the game', async () => {
		const remake = game({ metadata: { releaseDate: '2023-03-24', developers: [], publishers: [], genres: [] } });
		const gateway = new FakeVaultGateway({ 'Games/One.md': '---\nreleased: 2005\n---\noriginal' });
		const plan = await planCanonicalSync([remake], { gateway, notesFolder: 'Games' });
		expect(plan.statuses[0]?.status).toBe('create');
		expect(plan.statuses[0]?.path).not.toBe('Games/One.md');
	});

	it('legacy sync still offers the same bare-named note for review', async () => {
		const gateway = new FakeVaultGateway({ 'Games/One.md': '# One\nMy notes' });
		expect(matchVaultNote(legacy, await buildNoteIndex(gateway), { candidateFolder: 'Games' })).toMatchObject({ status: 'review', note: { path: 'Games/One.md' } });
	});
});

describe('stable identifiers pointing to different notes', () => {
	it('legacy sends the game to review when game-sync-id and steam-id point to different notes', async () => {
		const gateway = new FakeVaultGateway({
			'Games/A.md': '---\ngame-sync-id: game-sync:one\n---\nA',
			'Games/B.md': '---\nsteam-id: "1"\n---\nB',
		});
		const match = matchVaultNote(legacy, await buildNoteIndex(gateway));
		expect(match.status).toBe('conflict');
		expect(match.candidates.map((note) => note.path)).toEqual(['Games/A.md', 'Games/B.md']);
	});

	it('legacy sends the game to review when its note link and steam-id point to different notes', async () => {
		const gateway = new FakeVaultGateway({ 'Games/A.md': 'linked', 'Games/B.md': '---\nsteam-id: "1"\n---\nB' });
		const match = matchVaultNote(legacy, await buildNoteIndex(gateway), { noteLinks: [{ canonicalId: 'game-sync:one', path: 'Games/A.md' }] });
		expect(match.status).toBe('conflict');
		expect(match.candidates.map((note) => note.path)).toEqual(['Games/A.md', 'Games/B.md']);
	});

	it('does not accept a note that carries this game\'s ID and another game\'s ID at once', async () => {
		const both = new FakeVaultGateway({ 'Games/A.md': '---\ngame-sync-id:\n  - game-sync:one\n  - game-sync:other\nsteam-id: "1"\n---\nA' });
		expect(matchVaultNote(legacy, await buildNoteIndex(both)).status).toBe('conflict');
		const cased = new FakeVaultGateway({ 'Games/A.md': '---\ngame-sync-id: gametrack:one\nGAME-SYNC-ID: gametrack:other\nigdb-id: 1\n---\nA' });
		const plan = await planCanonicalSync([game()], { gateway: cased });
		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]?.status).toBe('conflict');
	});

	it('legacy review resolves the contradiction for good when the user picks the note with the game ID', async () => {
		const harness = await contradictionHarness();
		const prepared = await harness.service.prepareAll();
		const status = prepared.plan.statuses.find((entry) => entry.status === 'conflict')!;
		expect(status.match?.candidates.map((note) => note.path)).toEqual(['Games/A.md', 'Games/B.md']);
		await harness.service.applyReviewDecision({ planId: prepared.plan.id, canonicalGameId: status.canonicalGameId, action: 'merge', candidatePath: 'Games/A.md' });

		const next = await harness.service.prepareAll();
		expect(next.plan.statuses.find((entry) => entry.canonicalGameId === status.canonicalGameId)).toMatchObject({ path: 'Games/A.md' });
		expect(next.plan.statuses.some((entry) => entry.status === 'conflict' || entry.status === 'review')).toBe(false);
	});

	it('legacy review resolves the contradiction for good when the user picks the note with the provider ID', async () => {
		const harness = await contradictionHarness();
		const prepared = await harness.service.prepareAll();
		const status = prepared.plan.statuses.find((entry) => entry.status === 'conflict')!;
		await harness.service.applyReviewDecision({ planId: prepared.plan.id, canonicalGameId: status.canonicalGameId, action: 'merge', candidatePath: 'Games/B.md' });

		const next = await harness.service.prepareAll();
		expect(next.plan.statuses.find((entry) => entry.canonicalGameId === status.canonicalGameId)).toMatchObject({ path: 'Games/B.md' });
		expect(next.plan.statuses.some((entry) => entry.status === 'conflict' || entry.status === 'review')).toBe(false);
	});

	it('legacy still matches when all identifiers agree on one note', async () => {
		const gateway = new FakeVaultGateway({ 'Games/A.md': '---\ngame-sync-id: game-sync:one\nsteam-id: "1"\n---\nA' });
		const match = matchVaultNote(legacy, await buildNoteIndex(gateway), { noteLinks: [{ canonicalId: 'game-sync:one', path: 'Games/A.md' }] });
		expect(match).toMatchObject({ status: 'matched', method: 'game-sync-id', note: { path: 'Games/A.md' } });
	});

	it('canonical does not write into the game-sync-id note while an IGDB ID points elsewhere', async () => {
		const gateway = new FakeVaultGateway({
			'Games/A.md': '---\ngame-sync-id: gametrack:one\n---\nA',
			'Games/B.md': '---\nigdb-id: 1\n---\nB',
		});
		const plan = await planCanonicalSync([game()], { gateway });
		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses[0]?.status).toBe('conflict');
		expect(plan.statuses[0]?.match?.candidates.map((note) => note.path)).toEqual(['Games/A.md', 'Games/B.md']);
	});
});

describe('ID properties are case-insensitive', () => {
	it('legacy sees an upper-case GAME-SYNC-ID of another game', async () => {
		const gateway = new FakeVaultGateway({ 'Games/B.md': '---\nGAME-SYNC-ID: game-sync:other\nsteam-id: "1"\n---\nB' });
		expect(matchVaultNote(legacy, await buildNoteIndex(gateway)).status).toBe('conflict');
	});

	it('canonical sees an upper-case GAME-SYNC-ID of another game from the same library', async () => {
		const value = game({ identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', steam: '1' } } });
		const gateway = new FakeVaultGateway({ 'Games/B.md': '---\nGAME-SYNC-ID: gametrack:other\nsteam-id: "1"\n---\nB' });
		expect(matchCanonicalVaultNote(value, await buildNoteIndex(gateway)).status).toBe('conflict');
	});

	it('canonical still adopts a note that carries an older, non-GameTrack game-sync-id', async () => {
		const gateway = new FakeVaultGateway({ 'Games/B.md': '---\nGame-Sync-Id: game-sync:legacy\nigdb-id: 1\n---\nB' });
		expect(matchCanonicalVaultNote(game(), await buildNoteIndex(gateway))).toMatchObject({ status: 'matched', note: { path: 'Games/B.md' } });
	});

	it('legacy updates (not adopts) a note whose own ID is written GAME-SYNC-ID', async () => {
		const gateway = new FakeVaultGateway({ 'Games/One.md': '---\nGAME-SYNC-ID: game-sync:one\nsteam-id: "1"\n---\nnotes' });
		const plan = await new SyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway) }).plan([legacy]);
		expect(plan.operations.map((operation) => operation.kind)).toEqual(['update-properties']);
	});

	it('reads a capitalised Title property as the note title', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Whatever.md': '---\nTitle: One\n---\nnotes' });
		expect(matchVaultNote(legacy, await buildNoteIndex(gateway), { candidateFolder: 'Games' })).toMatchObject({ status: 'review', method: 'exact-title' });
	});
});

describe('canonical sync remembers its notes without ID properties', () => {
	it('follows a persisted note link when every ID property is turned off', async () => {
		const gateway = new FakeVaultGateway({ 'Archive/Renamed.md': '---\ntitle: Renamed\n---\nexisting linked note' });
		const { runtime } = composition(gateway, game(), { propertyMapping: NO_IDS, noteLinks: [{ canonicalId: 'gametrack:one', path: 'Archive/Renamed.md' }] });
		const preview = await (await runtime.createCanonicalService())!.preview();
		expect(preview.plan!.statuses[0]).toMatchObject({ status: 'update', path: 'Archive/Renamed.md' });
	});

	it('records note links on apply, so the note is still recognised after the ID properties are turned off', async () => {
		const gateway = new FakeVaultGateway();
		const first = composition(gateway, game());
		await (await first.runtime.createCanonicalService())!.sync();
		expect(first.store.state.noteLinks).toEqual([{ canonicalId: 'gametrack:one', path: 'Games/One.md' }]);

		const second = composition(gateway, game(), { propertyMapping: NO_IDS, noteLinks: first.store.state.noteLinks });
		const preview = await (await second.runtime.createCanonicalService())!.preview();
		expect(preview.plan!.statuses[0]).toMatchObject({ path: 'Games/One.md', match: { method: 'note-link' } });
		expect(['unchanged', 'update']).toContain(preview.plan!.statuses[0].status);
	});

	it('does not follow a link to a note that now carries another game\'s ID', async () => {
		const gateway = new FakeVaultGateway({ 'Games/One.md': '---\ngame-sync-id: gametrack:two\n---\nother game' });
		const index = await buildNoteIndex(gateway);
		const match = matchCanonicalVaultNote(game(), index, { noteLinks: [{ canonicalId: 'gametrack:one', path: 'Games/One.md' }], candidateFolder: 'Games' });
		expect(match.method).not.toBe('note-link');
	});

	it('does not record links once the plugin stopped during apply', async () => {
		const gateway = new FakeVaultGateway();
		let active = true;
		const record = async () => { throw new Error('must not record'); };
		const snapshot = { status: 'complete' as const, games: [game()], diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unknown' as const, gamesRead: 1, gamesNormalized: 1, diagnostics: [] } };
		const service = new CanonicalSyncService({
			provider: { id: 'gametrack', getSnapshot: async () => snapshot, getLibrary: async () => snapshot.games, isAvailable: async () => true, getDiagnostics: () => snapshot.diagnostics, getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }) },
			planner: { gateway, notesFolder: 'Games' },
			writer: new class extends CanonicalVaultWriter { override async apply(...args: Parameters<CanonicalVaultWriter['apply']>) { const result = await super.apply(...args); active = false; return result; } }(gateway),
			isActive: () => active,
			noteLinks: { load: async () => [], record },
		});
		await expect(service.sync()).rejects.toThrow(/inactive/u);
	});

	it('does not record a link for an operation that was skipped', async () => {
		const gateway = new FakeVaultGateway();
		const { runtime, store } = composition(gateway, game());
		const service = (await runtime.createCanonicalService())!;
		const preview = await service.preview();
		gateway.set('Games/One.md', 'created meanwhile by the user');
		await expect(service.applyPreview(preview)).rejects.toThrow();
		expect(store.state.noteLinks).toEqual([]);
	});
});
