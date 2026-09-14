import { describe, expect, it } from 'vitest';
import type { GameProvider } from '../src/model/provider';
import { createNormalizedGame, createOperation } from '../src/model/operations';
import { matchVaultNote } from '../src/vault/matcher';
import { buildNoteIndex } from '../src/vault/note-index';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { createStateStore } from '../src/state/store';
import { migrateState } from '../src/state/migrations';
import { addNegativeMapping, removeNegativeMapping } from '../src/identity/mappings';
import type { IdentityMapping } from '../src/model/identity';
import type { GameSyncData } from '../src/state/schema';
import type { PreparedSync } from '../src/sync/service';
import { SyncService } from '../src/sync/service';
import { createSyncPlanner } from '../src/sync/planner';
import { VaultWriter } from '../src/vault/writer';
import { createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot, identityMappings } from './fake-provider';

interface PreparedUnmergeLike {
	planId: string;
	plan: { operations: Array<{ risk: string; kind: string }> };
	preview: {
		existingPath: string;
		newPath: string;
		providerToKeep: GameProvider;
		providerToSplit: GameProvider;
		propertiesRemoved: Array<{ name: string }>;
		propertiesAdded: Array<{ name: string }>;
	};
}

interface MatchServiceLike {
	prepareUnmerge(canonicalId: string, providerToKeep: GameProvider): Promise<PreparedUnmergeLike>;
	applyUnmerge(prepared: PreparedUnmergeLike): Promise<void>;
	prepareAll(): Promise<PreparedSync>;
	getState(): Promise<GameSyncData>;
}

const canonicalId = 'game-sync:merged';
const steamOnlyCandidateNote = '---\ngame-sync-id: game-sync:steam\ntitle: Example Game\nsteam-id: "1"\nproviders:\n  - steam\nsteam-playtime: 60\nplaytime: 60\nowned: true\n---\n# Existing user note\n';
const originalNote = '---\ngame-sync-id: game-sync:merged\ntitle: Example Game\nsteam-id: "1"\nplaystation-id: psn-1\nproviders:\n  - steam\n  - playstation\nsteam-playtime: 60\nplaystation-playtime: 30\nplaytime: 90\nowned: true\nstatus: playing\n---\n# User body\n\nKeep this only in the original note.\n';

function mergedHarness() {
	const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game', { playtimeMinutes: 60 })]));
	const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game', { playtimeMinutes: 30 })]));
	return createIntegrationHarness({
		initialFiles: { 'Games/Example Game.md': originalNote },
		providers: [steam, playstation],
		state: {
			settings: { firstSyncCompleted: true },
			identityMappings: identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]),
		},
	});
}

async function prepareUnmerge(providerToKeep: GameProvider = 'steam') {
	const harness = await mergedHarness();
	const prepared = await harness.service.prepareAll();
	const service = harness.service as unknown as MatchServiceLike;
	const unmerge = await service.prepareUnmerge(canonicalId, providerToKeep);
	return { ...harness, service, prepared, unmerge };
}

describe('safe local unmerge', () => {
	it('creates a review-required SyncPlan covering both note changes', async () => {
		const { unmerge } = await prepareUnmerge('steam');

		expect(unmerge.plan.operations).toHaveLength(1);
		expect(unmerge.plan.operations[0]).toMatchObject({ risk: 'review', kind: 'unmerge' });
		expect(unmerge.preview).toMatchObject({
			existingPath: 'Games/Example Game.md',
			newPath: 'Games/Example Game (PlayStation).md',
			providerToKeep: 'steam',
			providerToSplit: 'playstation',
		});
	});

	it('does not write the vault or mappings while preparing the plan', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge();

		expect(gateway.frontMatterProcessCount).toBe(0);
		expect(await gateway.listMarkdownFiles()).toHaveLength(1);
		expect((await service.getState()).identityMappings).toEqual(identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]));
		expect(unmerge.plan.operations[0]?.risk).toBe('review');
	});

	it('keeps the selected provider in the existing note and gives the other provider a new note', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');

		await service.applyUnmerge(unmerge);

		const existing = parseFrontmatter(await gateway.read(unmerge.preview.existingPath));
		const split = parseFrontmatter(await gateway.read(unmerge.preview.newPath));
		expect(existing.frontmatter['steam-id']).toBe(1);
		expect(existing.frontmatter['playstation-id']).toBeUndefined();
		expect(split.frontmatter['playstation-id']).toBe('psn-1');
		expect(split.frontmatter['steam-id']).toBeUndefined();
	});

	it('leaves user-owned body only in the original note without silently cloning it', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');

		await service.applyUnmerge(unmerge);

		expect(parseFrontmatter(await gateway.read(unmerge.preview.existingPath)).body).toContain('Keep this only in the original note.');
		expect(parseFrontmatter(await gateway.read(unmerge.preview.newPath)).body).not.toContain('Keep this only in the original note.');
	});

	it('recomputes common Properties and reports removed and added provider Properties', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');

		expect(unmerge.preview.propertiesRemoved.map((property) => property.name)).toEqual(expect.arrayContaining(['playstation-id', 'playstation-playtime']));
		expect(unmerge.preview.propertiesAdded.map((property) => property.name)).toEqual(expect.arrayContaining(['playstation-id', 'playstation-playtime', 'playtime']));
		await service.applyUnmerge(unmerge);
		const existing = parseFrontmatter(await gateway.read(unmerge.preview.existingPath)).frontmatter;
		expect(existing.playtime).toBe(60);
		expect(existing.providers).toEqual(['steam']);
	});

	it('updates identity mappings only after both writes succeed', async () => {
		const { service, unmerge } = await prepareUnmerge('steam');
		const before = (await service.getState()).identityMappings;

		expect(before).toEqual(identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]));
		await service.applyUnmerge(unmerge);
		const after = (await service.getState()).identityMappings;
		expect(after).toContainEqual({ provider: 'steam', providerGameId: '1', canonicalId });
		expect(after.some((mapping) => mapping.provider === 'playstation' && mapping.providerGameId === 'psn-1' && mapping.canonicalId.startsWith('game-sync:unmerge:'))).toBe(true);
		expect(after).not.toContainEqual({ provider: 'playstation', providerGameId: 'psn-1', canonicalId });
	});

	it('leaves durable mappings unchanged when new-note creation fails', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');
		const before = (await service.getState()).identityMappings;
		gateway.create = async () => { throw new Error('second note creation failed'); };

		await expect(service.applyUnmerge(unmerge)).rejects.toThrow('second note creation failed');
		expect((await service.getState()).identityMappings).toEqual(before);
		expect(await gateway.read(unmerge.preview.existingPath)).toBe(originalNote);
	});

	it('rolls back the new note when updating the existing note fails', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');
		const before = (await service.getState()).identityMappings;
		gateway.failProcessBeforeUpdate = new Error('existing note update failed');

		await expect(service.applyUnmerge(unmerge)).rejects.toThrow('existing note update failed');
		expect(await gateway.exists(unmerge.preview.newPath)).toBe(false);
		const restored = parseFrontmatter(await gateway.read(unmerge.preview.existingPath));
		expect(restored.frontmatter['game-sync-id']).toBe(canonicalId);
		expect(restored.frontmatter['steam-id']).toBe(1);
		expect(restored.frontmatter['playstation-id']).toBe('psn-1');
		expect(restored.body).toContain('Keep this only in the original note.');
		expect((await service.getState()).identityMappings).toEqual(before);
	});

	it('rolls back both notes when durable mapping persistence fails', async () => {
		const seed = migrateState({
			settings: { firstSyncCompleted: true },
			identityMappings: identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]),
		});
		const stateStore = createStateStore(async () => structuredClone(seed), async () => {
			throw new Error('state persistence failed');
		});
		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game', { playtimeMinutes: 60 })]));
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game', { playtimeMinutes: 30 })]));
		const harness = await createIntegrationHarness({
			initialFiles: { 'Games/Example Game.md': originalNote },
			providers: [steam, playstation],
			stateStore,
		});
		await harness.service.prepareAll();
		const unmerge = await harness.service.prepareUnmerge(canonicalId, 'steam');

		await expect(harness.service.applyUnmerge(unmerge)).rejects.toThrow('state persistence failed');
		expect(await harness.gateway.exists(unmerge.preview.newPath)).toBe(false);
		expect(await harness.gateway.read(unmerge.preview.existingPath)).toBe(originalNote);
		expect((await harness.service.getState()).identityMappings).toEqual(seed.identityMappings);
	});

	it('treats a deterministic new-note filename collision as conflict without inventing a suffix', async () => {
		const harness = await mergedHarness();
		harness.gateway.set('Games/Example Game (PlayStation).md', '---\ntitle: Existing\n---\nOwned');
		await harness.service.prepareAll();
		const service = harness.service as unknown as MatchServiceLike;

		const unmerge = await service.prepareUnmerge(canonicalId, 'steam');
		expect(unmerge.plan.operations).toHaveLength(0);
		expect(unmerge.preview).toMatchObject({ newPath: 'Games/Example Game (PlayStation).md' });
	});

	it('produces zero ordinary sync operations on the next sync after a successful unmerge', async () => {
		const { service, unmerge } = await prepareUnmerge('steam');
		await service.applyUnmerge(unmerge);

		const next = await service.prepareAll();
		expect(next.plan.operations).toHaveLength(0);
	});

	it('does not remerge after restart while the split provider mapping is durable', async () => {
		const { gateway, service, unmerge } = await prepareUnmerge('steam');
		await service.applyUnmerge(unmerge);
		const persisted = await service.getState();
		const legacyOperation = createOperation({
			canonicalGameId: canonicalId,
			kind: 'update-properties',
			path: unmerge.preview.existingPath,
			risk: 'safe',
			summary: 'Legacy merge operation.',
			planRevision: 'legacy-plan',
			expectedNoteFingerprint: 'legacy-fingerprint',
		});
		persisted.operationJournal.push({
			operation: legacyOperation,
			game: createNormalizedGame([
				fakeProviderGame('steam', '1', 'Example Game', { playtimeMinutes: 60 }),
				fakeProviderGame('playstation', 'psn-1', 'Example Game', { playtimeMinutes: 30 }),
			], canonicalId),
			noteApplied: true,
			noteFingerprintAfter: 'legacy-after-fingerprint',
			providerStateApplied: true,
			historyApplied: true,
			cacheApplied: true,
		});
		let raw: unknown = persisted;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = structuredClone(value); });
		const restartedState = await stateStore.load();
		expect(restartedState.identityMappings.some((mapping) => mapping.provider === 'playstation' && mapping.providerGameId === 'psn-1' && mapping.canonicalId.startsWith('game-sync:unmerge:'))).toBe(true);

		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game', { playtimeMinutes: 60 })]));
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game', { playtimeMinutes: 30 })]));
		const restarted = new SyncService({
			adapters: [steam.adapter(), playstation.adapter()],
			planner: createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' }),
			writer: new VaultWriter(gateway),
			stateStore,
			now: () => '2026-09-12T12:00:00.000Z',
		});
		const next = await restarted.prepareAll();
		expect(next.plan.operations).toHaveLength(0);
		expect(await gateway.exists(unmerge.preview.newPath)).toBe(true);
	});
});

describe('durable match decisions', () => {
	it('manual merge maps the provider to the reviewed candidate canonical ID', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: { 'Games/Example Game.md': steamOnlyCandidateNote },
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		const prepared = await harness.service.prepareAll();

		expect(prepared.plan.statuses).toContainEqual(expect.objectContaining({ canonicalGameId: 'game-sync:playstation', status: 'review', path: 'Games/Example Game.md' }));
		await harness.service.applyReviewDecision({
			planId: prepared.plan.id,
			canonicalGameId: 'game-sync:playstation',
			action: 'merge',
			candidatePath: 'Games/Example Game.md',
		});

		expect(await harness.service.getState()).toMatchObject({
			identityMappings: [{ provider: 'playstation', providerGameId: 'psn-1', canonicalId: 'game-sync:steam' }],
		});
	});

	it('rejects a review decision that names a note outside the prepared candidates', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: {
				'Games/Example Game.md': steamOnlyCandidateNote,
				'Games/Other.md': '---\ngame-sync-id: game-sync:other\ntitle: Other Game\n---\n',
			},
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		const prepared = await harness.service.prepareAll();

		await expect(harness.service.applyReviewDecision({
			planId: prepared.plan.id,
			canonicalGameId: 'game-sync:playstation',
			action: 'merge',
			candidatePath: 'Games/Other.md',
		})).rejects.toThrow(/candidate/i);
	});

	it('rejects a review decision when the candidate note changed after preview', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: { 'Games/Example Game.md': steamOnlyCandidateNote },
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		const prepared = await harness.service.prepareAll();
		harness.gateway.set('Games/Example Game.md', `${steamOnlyCandidateNote}\nUser changed this note after the preview.\n`);

		await expect(harness.service.applyReviewDecision({
			planId: prepared.plan.id,
			canonicalGameId: 'game-sync:playstation',
			action: 'merge',
			candidatePath: 'Games/Example Game.md',
		})).rejects.toThrow(/changed|stale/i);
	});

	it('Keep separate is durable, Allow matching again removes it, and the candidate returns', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: { 'Games/Example Game.md': steamOnlyCandidateNote },
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		const prepared = await harness.service.prepareAll();

		await harness.service.applyReviewDecision({
			planId: prepared.plan.id,
			canonicalGameId: 'game-sync:playstation',
			action: 'keep-separate',
			candidatePath: 'Games/Example Game.md',
		});
		let state = await harness.service.getState();
		expect(state.negativeMappings).toContainEqual({ leftCanonicalId: 'game-sync:playstation', rightCanonicalId: 'game-sync:steam' });
		expect(state.identityMappings).toContainEqual({ provider: 'playstation', providerGameId: 'psn-1', canonicalId: 'game-sync:playstation' });

		await harness.service.allowMatchingAgain('game-sync:playstation', 'game-sync:steam');
		state = await harness.service.getState();
		expect(state.negativeMappings).toEqual([]);
		const next = await harness.service.prepareAll();
		expect(next.plan.statuses).toContainEqual(expect.objectContaining({ canonicalGameId: 'game-sync:playstation', status: 'review' }));
	});

	it('resolves an unresolved candidate through an explicit manager decision', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: { 'Games/Example Game.md': steamOnlyCandidateNote },
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		const prepared = await harness.service.prepareAll();
		const resolveUnresolved = (harness.service as unknown as {
			resolveUnresolved(canonicalId: string, action: 'merge' | 'keep-separate' | 'skip', candidatePath: string): Promise<void>;
		}).resolveUnresolved.bind(harness.service);

		await resolveUnresolved('game-sync:playstation', 'merge', 'Games/Example Game.md');

		expect(await harness.service.getState()).toMatchObject({
			identityMappings: [{ provider: 'playstation', providerGameId: 'psn-1', canonicalId: 'game-sync:steam' }],
		});
		expect(prepared.plan.statuses.some((status) => status.status === 'review')).toBe(true);
	});

	it('exposes all unresolved candidate paths for explicit review', async () => {
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const harness = await createIntegrationHarness({
			initialFiles: {
				'Games/One.md': '---\ngame-sync-id: game-sync:one\ntitle: Example Game\n---\n',
				'Games/Two.md': '---\ngame-sync-id: game-sync:two\ntitle: Example Game\n---\n',
			},
			providers: [playstation],
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['playstation', 'psn-1', 'game-sync:playstation']),
			},
		});
		await harness.service.prepareAll();

		const rows = await harness.service.getMatchManagerRows();
		expect(rows).toContainEqual(expect.objectContaining({
			category: 'unresolved',
			canonicalId: 'game-sync:playstation',
			candidatePaths: ['Games/One.md', 'Games/Two.md'],
		}));
	});

	it('survives a positive mapping restart through StateStore', async () => {
		let raw: unknown;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = structuredClone(value); });
	const state = { identityMappings: [] as IdentityMapping[], negativeMappings: [] };
		state.identityMappings.push({ provider: 'steam', providerGameId: '1', canonicalId: 'game-sync:one' });

		const migrated = await stateStore.load();
		migrated.identityMappings = state.identityMappings;
		await stateStore.save(migrated);
		expect((await stateStore.load()).identityMappings).toEqual(state.identityMappings);
	});

	it('suppresses a kept-separate suggestion and restores it after Allow matching again', async () => {
		const gateway = (await mergedHarness()).gateway;
		const index = await buildNoteIndex(gateway);
		const game = createNormalizedGame([fakeProviderGame('playstation', 'psn-new', 'Example Game')], 'game-sync:playstation');
		const negative = addNegativeMapping({ identityMappings: [], negativeMappings: [] }, 'game-sync:playstation', canonicalId).negativeMappings;

		const suppressed = matchVaultNote(game, index, { negativeMappings: negative });
		expect(suppressed.status).toBe('none');

		const allowed = matchVaultNote(game, index, { negativeMappings: removeNegativeMapping({ identityMappings: [], negativeMappings: negative }, 'game-sync:playstation', canonicalId).negativeMappings });
		expect(allowed.note?.path).toBe('Games/Example Game.md');
	});
});

describe('unmerge provider choice', () => {
	it('can prepare the PlayStation note as the existing note and Steam as the new note', async () => {
	const { unmerge } = await prepareUnmerge('playstation');

		expect(unmerge.preview.providerToKeep).toBe('playstation');
		expect(unmerge.preview.providerToSplit).toBe('steam');
		expect(unmerge.preview.newPath).toBe('Games/Example Game (Steam).md');
	});
});
