import { describe, expect, it } from 'vitest';
import { migrateState } from '../src/state/migrations';
import { mergeStateChanges } from '../src/state/merge';
import { createStateStore } from '../src/state/store';
import { removeNoteLinks, renameNoteLinks } from '../src/state/note-links';
import { createSyncPlanner } from '../src/sync/planner';
import { SyncService } from '../src/sync/service';
import { VaultWriter } from '../src/vault/writer';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';
import { FakeProvider, fakeProviderSnapshot, fakeProviderGame, identityMappings } from './fake-provider';
import type { PropertyMapping } from '../src/model/property-mapping';

const mapping: PropertyMapping = { gameSyncId: null, steamId: null, playstationId: null, igdbId: null, gametrackId: null, title: 'aliases' };
async function setup(files: Record<string,string>, providers: FakeProvider[], extra = {}) {
 let raw: unknown = migrateState({settings: {firstSyncCompleted: true}, propertyMapping: mapping, ...extra});
 const store = createStateStore(async()=>structuredClone(raw), async(value)=>{raw=structuredClone(value);});
 const gateway = new FakeVaultGateway(files);
 const service = new SyncService({adapters: providers.map(p=>p.adapter()), planner: createSyncPlanner({gateway, noteIndex: await buildNoteIndex(gateway, mapping), propertyMapping: mapping, notesFolder: 'Games'}), writer: new VaultWriter(gateway, {propertyMapping: mapping}), stateStore: store, now: ()=> '2026-09-12T12:00:00.000Z'});
 return {gateway, service, store};
}
function psn() { return new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation','p1','Example Game')])); }

describe('note links', () => {
	it('follow a renamed note and a renamed folder, and report when nothing changed', () => {
		const state = migrateState({ noteLinks: [{ canonicalId: 'a', path: 'Games/A.md' }, { canonicalId: 'b', path: 'Games/B.md' }, { canonicalId: 'c', path: 'Games Old/C.md' }] });

		expect(renameNoteLinks(state, 'Games/A.md', 'Games/A (2020).md')).toBe(true);
		expect(renameNoteLinks(state, 'Games', 'resources/gry')).toBe(true);
		expect(state.noteLinks).toEqual([{ canonicalId: 'a', path: 'resources/gry/A (2020).md' }, { canonicalId: 'b', path: 'resources/gry/B.md' }, { canonicalId: 'c', path: 'Games Old/C.md' }]);
		expect(renameNoteLinks(state, 'Other.md', 'Else.md')).toBe(false);
	});
});

describe('note links with ID properties turned off', () => {
	it('keeps links added concurrently by two saves', () => {
		const base = migrateState({});
		const local = { ...base, noteLinks: [{ canonicalId: 'a', path: 'Games/A.md' }] };
		const current = { ...base, noteLinks: [{ canonicalId: 'b', path: 'Games/B.md' }] };
		expect(mergeStateChanges(base, local, current).noteLinks).toEqual(expect.arrayContaining([...local.noteLinks, ...current.noteLinks]));
	});

	it('records keep-separate against the note itself when an old game-sync-id is left on it', async () => {
		const { service } = await setup({ 'Games/Example Game (2024).md': '---\ngame-sync-id: old-game\n---\nmanual' }, [psn()]);
		const prepared = await service.prepareAll();
		const status = prepared.plan.statuses[0];
		expect(status.status).toBe('review');
		await service.applyReviewDecision({ planId: prepared.plan.id, canonicalGameId: status.canonicalGameId, candidatePath: status.path, action: 'keep-separate' });
		expect((await service.prepareAll()).plan.statuses[0]?.status).toBe('create');
	});

	it('merges a second provider into the game that already owns the note', async () => {
		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game')]));
		const { service } = await setup({ 'Games/Example Game (2024).md': 'manual' }, [steam, psn()], { identityMappings: identityMappings(['steam', '1', 'a'], ['playstation', 'p1', 'b']) });
		const prepared = await service.prepareAll();
		for (const status of prepared.plan.statuses) {
			expect(status.status).toBe('review');
			await service.applyReviewDecision({ planId: prepared.plan.id, canonicalGameId: status.canonicalGameId, candidatePath: status.path, action: 'merge' });
		}
		const next = await service.prepareAll();
		expect(next.plan.statuses.some((status) => status.status === 'conflict' || status.status === 'review')).toBe(false);
		expect(next.games).toHaveLength(1);
	});

	it('forgets a deleted note, so a new note at the same path is not adopted', async () => {
		const { gateway, service, store } = await setup({ 'Games/Example Game.md': 'original' }, [psn()], { identityMappings: identityMappings(['playstation', 'p1', 'a']), noteLinks: [{ canonicalId: 'a', path: 'Games/Example Game.md' }] });
		await gateway.remove('Games/Example Game.md');
		const state = await store.load();
		expect(removeNoteLinks(state, 'Games/Example Game.md')).toBe(true);
		await store.save(state);
		gateway.set('Games/Example Game.md', '---\ntitle: Unrelated film\n---\nMy film review');
		const next = await service.prepareAll();
		expect(next.plan.operations.filter((operation) => operation.path === 'Games/Example Game.md' && operation.risk === 'safe')).toEqual([]);
	});

	it('drops links to notes that disappeared while the plugin was not running', async () => {
		const { gateway, service } = await setup({ 'Games/Example Game.md': 'original' }, [psn()], { identityMappings: identityMappings(['playstation', 'p1', 'a']), noteLinks: [{ canonicalId: 'a', path: 'Games/Example Game.md' }] });
		await gateway.remove('Games/Example Game.md');
		await service.prepareAll();
		expect((await service.getState()).noteLinks).toEqual([]);
	});

	it('follows a rename for a service that was already loaded', async () => {
		const { gateway, service, store } = await setup({ 'Games/Old.md': 'manual' }, [psn()], { identityMappings: identityMappings(['playstation', 'p1', 'a']), noteLinks: [{ canonicalId: 'a', path: 'Games/Old.md' }] });
		await service.prepareAll();
		await gateway.remove('Games/Old.md');
		gateway.set('Games/Personal name.md', 'manual');
		const state = await store.load();
		renameNoteLinks(state, 'Games/Old.md', 'Games/Personal name.md');
		await store.save(state);
		expect((await service.prepareAll()).plan.statuses[0]?.path).toBe('Games/Personal name.md');
	});

	it('links both notes after an unmerge', async () => {
		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game')]));
		const { service } = await setup({ 'Games/Example Game.md': 'manual' }, [steam, psn()], { identityMappings: identityMappings(['steam', '1', 'a'], ['playstation', 'p1', 'a']), noteLinks: [{ canonicalId: 'a', path: 'Games/Example Game.md' }] });
		await service.prepareAll();
		const unmerge = await service.prepareUnmerge('a', 'steam');
		expect(unmerge.conflict).toBeUndefined();
		await service.applyUnmerge(unmerge);
		const next = await service.prepareAll();
		expect((await service.getState()).noteLinks.some((link) => link.path === unmerge.preview.newPath)).toBe(true);
		expect(next.plan.statuses.some((status) => status.status === 'review' || status.status === 'conflict')).toBe(false);
	});
});
