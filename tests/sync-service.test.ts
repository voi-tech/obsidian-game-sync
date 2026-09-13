import { describe, expect, it } from 'vitest';
import { createSyncPlanner } from '../src/sync/planner';
import { SyncService } from '../src/sync/service';
import { VaultWriter } from '../src/vault/writer';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';
import type { GameProviderAdapter } from '../src/providers/provider';
import type { ProviderGame, ProviderSnapshot } from '../src/model/provider';
import { migrateState } from '../src/state/migrations';
import { createStateStore } from '../src/state/store';
import { createCacheStore } from '../src/sync/cache';
import { VaultConflictError } from '../src/network/errors';
import { createNormalizedGame, createOperation, createSyncPlan } from '../src/model/operations';

function providerGame(id: string, playtimeMinutes = 60, achievements?: ProviderGame['achievements']): ProviderGame {
	return {
		provider: 'steam', providerGameId: id, title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], owned: true, playtimeMinutes, achievements,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: achievements !== undefined }, identity: { provider: 'steam', appId: Number(id) || 1 },
	};
}

function playstationGame(id: string, playtimeMinutes = 60): ProviderGame {
	return {
		provider: 'playstation', providerGameId: id, title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['ps5'], owned: true, playtimeMinutes,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false }, identity: { provider: 'playstation', conceptId: `concept-${id}`, titleIds: [`title-${id}`], npCommunicationIds: [`comm-${id}`] },
	};
}

function snapshot(status: ProviderSnapshot['status'], games: ProviderGame[]): ProviderSnapshot {
	return { provider: 'steam', status, games, fetchedAt: '2026-09-12T12:00:00.000Z', pagination: { complete: status === 'complete', pagesFetched: 1 }, paginationComplete: status === 'complete' };
}

function adapter(fetchLibrary: GameProviderAdapter['fetchLibrary']): GameProviderAdapter {
	return {
		id: 'steam', getConnectionStatus: async () => ({ provider: 'steam', state: 'connected', connected: true }), testConnection: async () => ({ provider: 'steam', displayName: 'Steam', accountId: 'account' }), fetchLibrary, disconnect: async () => undefined,
	};
}

describe('provider-isolated SyncService', () => {
	it('propagates prepare options to every provider during prepareAll', async () => {
		const gateway = new FakeVaultGateway();
		const receivedForce: boolean[] = [];
		const steam = adapter(async (options) => {
			receivedForce.push(options.force === true);
			return snapshot('complete', [providerGame('1')]);
		});
		const playstation = {
			...adapter(async (options) => {
				receivedForce.push(options.force === true);
				return { ...snapshot('complete', [playstationGame('2')]), provider: 'playstation' as const };
			}),
			id: 'playstation' as const,
		};
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam, playstation], planner, writer: new VaultWriter(gateway) });

		await service.prepareAll({ force: true });

		expect(receivedForce).toEqual([true, true]);
	});

	it('records only complete explicit applies as the last successful provider state', async () => {
		const gateway = new FakeVaultGateway();
		let mode: 'complete' | 'partial' | 'failed' = 'complete';
		const steam = adapter(async () => {
			if (mode === 'failed') throw new Error('Steam unavailable');
			return snapshot(mode, [providerGame('1', mode === 'partial' ? 90 : 60)]);
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		const successful = (await service.getState()).lastSuccessfulProviderStates.steam;
		expect(successful).toEqual({
			provider: 'steam',
			fetchedAt: '2026-09-12T12:00:00.000Z',
			gameIds: ['1'],
			status: 'complete',
			paginationComplete: true,
		});

		mode = 'partial';
		const partial = await service.prepareAll();
		await service.applySelection(partial, partial.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).lastSuccessfulProviderStates.steam).toEqual(successful);

		mode = 'failed';
		const failed = await service.prepareAll();
		await service.applySelection(failed, failed.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).lastSuccessfulProviderStates.steam).toEqual(successful);
	});

	it('keeps a successful provider plan when another provider fails', async () => {
		const gateway = new FakeVaultGateway();
		const steam = adapter(async () => { throw new Error('Steam unavailable'); });
		const playstation = { ...adapter(async () => snapshot('complete', [providerGame('2')])), id: 'playstation' as const };
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam, playstation], planner, writer: new VaultWriter(gateway) });

		const result = await service.prepareAll();
		expect(result.providerStatuses.steam.state).toBe('failed');
		expect(result.providerStatuses.playstation.state).toBe('success');
		expect(result.gamesFetched).toBe(1);
		expect(result.operationsCreated).toBe(1);
		expect(result.warnings.some((warning) => warning.includes('Steam'))).toBe(true);
	});

	it('passes current ignored canonical IDs, provider references and identity mappings to provider and all plans', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState({
			identityMappings: [
				{ canonicalId: 'game-sync:one', provider: 'steam', providerGameId: '1' },
				{ canonicalId: 'game-sync:two', provider: 'steam', providerGameId: '2' },
			],
			ignoredCanonicalIds: ['game-sync:one'],
			ignoredProviderRefs: ['steam:2'],
		});
		const steam = adapter(async () => snapshot('complete', [providerGame('1'), providerGame('2')]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), state });

		const providerPlan = await service.prepareProvider('steam');
		expect(providerPlan.plan.statuses.map((status) => status.status)).toEqual(['ignored', 'ignored']);

		const allPlan = await service.prepareAll();
		expect(allPlan.plan.statuses.map((status) => status.status)).toEqual(['ignored', 'ignored']);
		expect(allPlan.plan.operations).toHaveLength(0);
	});

	it('retains previous achievements when the next provider snapshot is partial', async () => {
		const gateway = new FakeVaultGateway();
		const earned = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] };
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60, earned)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		await service.prepareProvider('steam');
		next = snapshot('partial', [providerGame('1', 90)]);

		const result = await service.prepareProvider('steam');
		expect(result.games[0]?.providers.steam?.playtimeMinutes).toBe(90);
		expect(result.games[0]?.providers.steam?.achievements).toEqual(earned);
		expect(result.games[0]?.providers.steam?.freshness.achievements).toBe(false);
	});

	it('retains stale partial playtime and metadata fields from the approved snapshot', async () => {
		const gateway = new FakeVaultGateway();
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		next = snapshot('partial', [{
			...providerGame('1', 90),
			title: 'Transient title',
			releaseDate: '2025-01-01',
			description: 'Transient description',
			cover: 'transient-cover',
			developers: ['Transient studio'],
			publishers: ['Transient publisher'],
			genres: ['Transient genre'],
			platforms: ['transient-platform'],
			owned: false,
			acquisitionType: 'free',
			playtimeMinutes: undefined,
			lastPlayed: undefined,
			freshness: { metadata: false, ownership: false, playtime: false, achievements: false },
		}]);

		const partial = await service.prepareProvider('steam');
		const current = partial.games[0]?.providers.steam;
		expect(current?.title).toBe('Example Game');
		expect(current?.releaseDate).toBe('2024-01-01');
		expect(current?.description).toBeUndefined();
		expect(current?.playtimeMinutes).toBe(60);
		expect(current?.owned).toBe(true);
		expect(current?.freshness.playtime).toBe(false);
	});

	it('forces first sync into preview and marks completion only after explicit apply', async () => {
		const gateway = new FakeVaultGateway();
		const steam = adapter(async () => snapshot('complete', [providerGame('1')]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const prepared = await service.prepareAll();

		expect(prepared.previewRequired).toBe(true);
		const previewOnly = await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id));
		expect(previewOnly.operationsApplied).toBe(0);
		expect(previewOnly.warnings.some((warning) => warning.includes('explicit'))).toBe(true);

		const applied = await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(applied.operationsApplied).toBe(1);
		expect((await service.getState()).settings.firstSyncCompleted).toBe(true);
	});

	it('blocks background apply during the first sync without saving or invoking the executor', async () => {
		const gateway = new FakeVaultGateway();
		let rawState: unknown;
		let saves = 0;
		const stateStore = createStateStore(async () => rawState, async (value) => { saves += 1; rawState = value; });
		const steam = adapter(async () => snapshot('complete', [providerGame('1')]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const prepared = await service.prepareAll();

		const result = await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { background: true });

		expect(result.operationsApplied).toBe(0);
		expect(result.pendingOperationIds).toEqual(prepared.plan.operations.map((operation) => operation.id));
		expect(result.warnings.some((warning) => warning.includes('preview'))).toBe(true);
		expect(saves).toBe(0);
		expect(await gateway.exists('Games/Example Game.md')).toBe(false);
	});

	it('background applies safe operations while queuing review operations and ignoring unknown IDs', async () => {
		const gateway = new FakeVaultGateway();
		let next = snapshot('complete', [providerGame('1', 60)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		next = snapshot('complete', [providerGame('1', 90)]);
		const prepared = await service.prepareAll();
		const safeOperation = prepared.plan.operations[0];
		if (safeOperation === undefined || prepared.games[0] === undefined) throw new Error('Expected a safe operation.');
		const reviewOperation = createOperation({
			canonicalGameId: prepared.games[0].canonicalId,
			kind: 'create-note',
			path: 'Games/Review.md',
			risk: 'review',
			summary: 'Review operation.',
			planRevision: prepared.plan.planRevision,
			expectedNoteFingerprint: null,
		});
		prepared.plan = {
			...createSyncPlan(prepared.plan.planRevision, [safeOperation, reviewOperation]),
			statuses: [...prepared.plan.statuses, { canonicalGameId: prepared.games[0].canonicalId, status: 'review', path: 'Games/Review.md' }],
			games: prepared.games,
		};
		prepared.operationsCreated = prepared.plan.operations.length;
		prepared.reviewRequiredCount = 1;

		const result = await service.applySelection(prepared, [safeOperation.id, reviewOperation.id, 'operation:unknown'], { background: true });

		expect(result.operationsAppliedIds).toEqual([safeOperation.id]);
		expect(result.pendingOperationIds).toContain(reviewOperation.id);
		expect(result.deselectedOperationIds).toContain(reviewOperation.id);
		expect(result.warnings.some((warning) => warning.includes('review'))).toBe(true);
		expect(result.warnings.some((warning) => warning.includes('unknown'))).toBe(true);
		expect(await gateway.exists('Games/Review.md')).toBe(false);
		expect((await service.getState()).lastAppliedProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(90);
	});

	it('does not recover a review operation from the journal in background mode', async () => {
		const gateway = new FakeVaultGateway();
		const canonicalId = 'game-sync:review';
		const game = createNormalizedGame([providerGame('1')], canonicalId);
		const writer = new VaultWriter(gateway);
		await writer.createNote({ path: 'Games/Example Game.md', game, expectedNoteFingerprint: null });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const fingerprints = await planner.currentNoteFingerprints();
		const fingerprint = fingerprints['Games/Example Game.md'];
		if (fingerprint === undefined || fingerprint === null) throw new Error('Expected a note fingerprint.');
		const reviewOperation = createOperation({
			canonicalGameId: canonicalId,
			kind: 'update-properties',
			path: 'Games/Example Game.md',
			risk: 'review',
			summary: 'Review operation.',
			planRevision: 'revision:old',
			expectedNoteFingerprint: fingerprint,
		});
		const state = migrateState({
			settings: { firstSyncCompleted: true },
			identityMappings: [{ canonicalId, provider: 'steam', providerGameId: '1' }],
			operationJournal: [{
				operation: reviewOperation,
				game,
				noteApplied: true,
				noteFingerprintAfter: fingerprint,
				providerStateApplied: false,
				historyApplied: false,
				cacheApplied: false,
			}],
		});
		const service = new SyncService({ adapters: [adapter(async () => snapshot('complete', [providerGame('1')]))], planner, writer, state });
		const prepared = await service.prepareAll();
		const result = await service.applySelection(prepared, [], { background: true });

		expect(result.operationsApplied).toBe(0);
		expect(result.pendingOperationIds).toContain(reviewOperation.id);
		expect(result.warnings.some((warning) => warning.includes('review'))).toBe(true);
		expect((await service.getState()).operationJournal[0]?.operation.risk).toBe('review');
	});

	it('marks an explicit zero-operation first sync complete and preserves it after restart', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState({ identityMappings: [{ canonicalId: 'game-sync:zero', provider: 'steam', providerGameId: '1' }] });
		let rawState: unknown = state;
		const stateStore = createStateStore(async () => rawState, async (value) => { rawState = value; });
		await new VaultWriter(gateway).createNote({ path: 'Games/Example Game.md', game: createNormalizedGame([providerGame('1')], 'game-sync:zero'), expectedNoteFingerprint: null, updatedAt: '2026-09-12T12:00:00.000Z' });
		const steam = adapter(async () => snapshot('complete', [providerGame('1')]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const prepared = await service.prepareAll();
		expect(prepared.previewRequired).toBe(true);
		expect(prepared.plan.operations).toHaveLength(0);
		await service.applySelection(prepared, [], { explicit: true });
		expect((await service.getState()).settings.firstSyncCompleted).toBe(true);

		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		expect((await restarted.prepareAll()).previewRequired).toBe(false);
	});

	it('retains a failed provider in the combined game instead of removing its playtime or fields', async () => {
		const gateway = new FakeVaultGateway();
		let steamFailed = false;
		const steam = adapter(async () => {
			if (steamFailed) throw new Error('Steam unavailable');
			return snapshot('complete', [providerGame('1', 60)]);
		});
		const playstation = { ...adapter(async () => snapshot('complete', [playstationGame('2', 30)])), id: 'playstation' as const };
		const state = migrateState({ identityMappings: [
			{ canonicalId: 'game-sync:one', provider: 'steam', providerGameId: '1' },
			{ canonicalId: 'game-sync:one', provider: 'playstation', providerGameId: '2' },
		] });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam, playstation], planner, writer: new VaultWriter(gateway), state });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		steamFailed = true;

		const afterFailure = await service.prepareAll();
		const combined = afterFailure.games.find((item) => item.canonicalId === 'game-sync:one');
		expect(afterFailure.providerStatuses.steam.state).toBe('failed');
		expect(combined?.providers.steam?.providerGameId).toBe('1');
		expect(combined?.providers.playstation?.providerGameId).toBe('2');
		expect(combined?.playtimeMinutes).toBe(90);
	});

	it('requires two complete misses and never reduces ownership after partial or failed snapshots', async () => {
		const gateway = new FakeVaultGateway();
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		next = snapshot('partial', []);
		const partial = await service.prepareAll();
		await service.applySelection(partial, partial.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(0);
		expect(partial.games[0]?.owned).toBe(true);

		next = snapshot('complete', []);
		const firstMiss = await service.prepareAll();
		await service.applySelection(firstMiss, firstMiss.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(1);
		expect(firstMiss.games[0]?.owned).toBe(true);

		next = snapshot('failed', []);
		const failed = await service.prepareAll();
		await service.applySelection(failed, failed.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(1);
		expect(failed.games[0]?.owned).toBe(true);

		next = snapshot('complete', []);
		const secondMiss = await service.prepareAll();
		await service.applySelection(secondMiss, secondMiss.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(2);
		expect(secondMiss.games[0]?.owned).toBe(false);
	});

	it('preserves valid presence through failed and partial snapshots across restart', async () => {
		const gateway = new FakeVaultGateway();
		let mode: 'present' | 'missing' | 'failed' | 'partial' = 'present';
		let raw: unknown;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = value; });
		const steam = adapter(async () => {
			if (mode === 'failed') throw new Error('Steam unavailable');
			return mode === 'partial'
				? snapshot('partial', [])
				: snapshot('complete', mode === 'present' ? [providerGame('1')] : []);
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const initial = await firstService.prepareAll();
		await firstService.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		mode = 'missing';
		const firstMiss = await firstService.prepareAll();
		await firstService.applySelection(firstMiss, [], { explicit: true });
		const beforeFailure = (await firstService.getState()).presence[0];
		expect(beforeFailure).toMatchObject({ consecutiveMissing: 1, lastSnapshotStatus: 'complete', paginationComplete: true });

		mode = 'failed';
		const failed = await firstService.prepareAll();
		await firstService.applySelection(failed, [], { explicit: true });
		mode = 'partial';
		const partial = await firstService.prepareAll();
		await firstService.applySelection(partial, [], { explicit: true });
		expect((await firstService.getState()).presence[0]).toEqual(beforeFailure);

		mode = 'missing';
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const secondMiss = await restarted.prepareAll();
		await restarted.applySelection(secondMiss, secondMiss.plan.operations.map((operation) => operation.id), { explicit: true });
		const finalState = await stateStore.load();
		expect(finalState.presence[0]).toMatchObject({ consecutiveMissing: 2, lastSnapshotStatus: 'complete', paginationComplete: true });
		expect(() => migrateState(raw)).not.toThrow();
	});

	it('rejects an older preview after a changed source was prepared and writes nothing', async () => {
		const gateway = new FakeVaultGateway();
		let next = snapshot('complete', [providerGame('1', 60)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const oldPrepared = await service.prepareAll();
		const identicalPrepared = await service.prepareAll();
		expect(identicalPrepared.plan.id).toBe(oldPrepared.plan.id);
		expect(identicalPrepared.plan.planRevision).toBe(oldPrepared.plan.planRevision);
		next = snapshot('complete', [providerGame('1', 90)]);
		await service.prepareAll();

		await expect(service.applySelection(oldPrepared, oldPrepared.plan.operations.map((operation) => operation.id), { explicit: true })).rejects.toThrow(VaultConflictError);
		expect(await gateway.exists('Games/Example Game.md')).toBe(false);
	});

	it('does not complete first sync when a mixed plan contains a conflict', async () => {
		const gateway = new FakeVaultGateway({
			'Games/One.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nOne',
			'Games/Two.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nTwo',
		});
		const steam = adapter(async () => snapshot('complete', [
			{ ...providerGame('1'), title: 'New Game', identity: { provider: 'steam', appId: 1 } },
			{ ...providerGame('2'), identity: { provider: 'steam', appId: 2 } },
		]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const prepared = await service.prepareAll();
		expect(prepared.plan.statuses.some((status) => status.status === 'conflict')).toBe(true);
		expect(prepared.plan.operations).toHaveLength(1);
		const applied = await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(applied.warnings.some((warning) => warning.includes('not committed'))).toBe(true);
		expect((await service.getState()).settings.firstSyncCompleted).toBe(false);
	});

	it('redacts provider errors from statuses and warnings', async () => {
		const gateway = new FakeVaultGateway();
		const secretValue = 'registered-secret-value';
		const steam = adapter(async () => { throw new Error('Bearer bearer-secret api_key=api-key-secret token=token-secret registered-secret-value'); });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const result = await new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), secretValues: [secretValue] }).prepareAll();
		const serialized = JSON.stringify({ statuses: result.providerStatuses, warnings: result.warnings });
		expect(serialized).not.toContain('bearer-secret');
		expect(serialized).not.toContain('api-key-secret');
		expect(serialized).not.toContain('token-secret');
		expect(serialized).not.toContain(secretValue);
		expect(serialized).toContain('[REDACTED]');
	});

	it('redacts an unregistered provider API key query parameter without consuming the URL', async () => {
		const gateway = new FakeVaultGateway();
		const steam = adapter(async () => { throw new Error('Request failed: https://api.example/?key=steam-key-secret&format=json'); });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const result = await new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) }).prepareAll();
		const serialized = JSON.stringify({ statuses: result.providerStatuses, warnings: result.warnings });
		expect(serialized).not.toContain('steam-key-secret');
		expect(serialized).toContain('https://api.example/?key=[REDACTED]&format=json');
	});

	it('records history only when recordHistory is enabled and only after note success', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState(undefined);
		state.settings.recordHistory = true;
		const events: unknown[] = [];
		const history = { record: async (event: unknown, noteApplied: boolean) => { if (noteApplied) events.push(event); return noteApplied; } };
		const steam = adapter(async () => snapshot('complete', [providerGame('1')]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), state, history });
		const prepared = await service.prepareAll();
		await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(events).toHaveLength(1);

		const failedGateway = new FakeVaultGateway();
		failedGateway.create = async () => { throw new Error('writer failed'); };
		const failedPlanner = createSyncPlanner({ gateway: failedGateway, noteIndex: await buildNoteIndex(failedGateway), notesFolder: 'Games' });
		const failedService = new SyncService({ adapters: [steam], planner: failedPlanner, writer: new VaultWriter(failedGateway), state, history });
		const failedPrepared = await failedService.prepareAll();
		await failedService.applySelection(failedPrepared, failedPrepared.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(events).toHaveLength(1);
	});

	it('reloads approved provider snapshots and presence after a service restart', async () => {
		const gateway = new FakeVaultGateway();
		let raw: unknown;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = value; });
		let mode: 'complete' | 'failed' | 'empty' = 'complete';
		const steam = adapter(async () => {
			if (mode === 'failed') throw new Error('Steam unavailable');
			return mode === 'empty' ? snapshot('complete', []) : snapshot('complete', [providerGame('1', 60)]);
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const initial = await firstService.prepareAll();
		await firstService.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await firstService.getState()).lastSuccessfulProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(60);

		mode = 'failed';
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const failed = await restarted.prepareAll();
		expect(failed.providerStatuses.steam.state).toBe('failed');
		expect(failed.games[0]?.providers.steam?.playtimeMinutes).toBe(60);

		mode = 'empty';
		const firstMiss = await restarted.prepareAll();
		await restarted.applySelection(firstMiss, firstMiss.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await restarted.getState()).presence[0]?.consecutiveMissing).toBe(1);
		const secondMiss = await restarted.prepareAll();
		await restarted.applySelection(secondMiss, secondMiss.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await restarted.getState()).presence[0]?.consecutiveMissing).toBe(2);
		expect(secondMiss.games[0]?.owned).toBe(false);
	});

	it('passes persisted PlayStation identity to a restarted partial adapter', async () => {
		const gateway = new FakeVaultGateway();
		let raw: unknown;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = value; });
		let mode: 'complete' | 'partial' = 'complete';
		let previousAtFetch: readonly ProviderGame[] = [];
		const completeGame = playstationGame('2', 60);
		const playstation = {
			...adapter(async (options) => {
				previousAtFetch = options.previousGames ?? [];
				if (mode === 'complete') return { provider: 'playstation' as const, status: 'complete' as const, games: [completeGame], fetchedAt: '2026-09-12T12:00:00.000Z', pagination: { complete: true, pagesFetched: 1 }, paginationComplete: true };
				const previous = options.previousGames?.[0];
				return {
					provider: 'playstation' as const,
					status: 'partial' as const,
					games: [{ ...completeGame, playtimeMinutes: 90, identity: previous?.identity ?? { provider: 'playstation' as const, conceptId: 'concept-2', titleIds: [], npCommunicationIds: [] }, freshness: { metadata: true, ownership: false, playtime: true, achievements: false } }],
					fetchedAt: '2026-09-12T13:00:00.000Z',
					pagination: { complete: false, pagesFetched: 1 },
					paginationComplete: false,
				};
			}),
			id: 'playstation' as const,
			getConnectionStatus: async () => ({ provider: 'playstation' as const, state: 'connected' as const, connected: true }),
			testConnection: async () => ({ provider: 'playstation' as const, displayName: 'PlayStation', accountId: 'account' }),
		};
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstService = new SyncService({ adapters: [playstation], planner, writer: new VaultWriter(gateway), stateStore });
		const initial = await firstService.prepareAll();
		await firstService.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		mode = 'partial';
		const restarted = new SyncService({ adapters: [playstation], planner, writer: new VaultWriter(gateway), stateStore });
		const partial = await restarted.prepareAll();
		const persistedIdentity = previousAtFetch[0]?.identity;
		expect(persistedIdentity?.provider).toBe('playstation');
		if (persistedIdentity?.provider !== 'playstation') throw new Error('Expected a persisted PlayStation identity.');
		expect(persistedIdentity.titleIds).toEqual(['title-2']);
		expect(persistedIdentity.npCommunicationIds).toEqual(['comm-2']);
		expect(partial.providerStatuses.playstation.state).toBe('partial');
		expect(partial.providerResults.playstation?.providerGames?.[0]?.identity).toEqual(persistedIdentity);
	});

	it('recovers missing history and cache hooks after a new service instance without rewriting the note', async () => {
		const gateway = new FakeVaultGateway();
		let writes = 0;
		const originalCreate = gateway.create.bind(gateway);
		gateway.create = async (path, content) => { writes += 1; await originalCreate(path, content); };
		let raw: unknown;
		const state = migrateState(undefined);
		state.settings.recordHistory = true;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = value; });
		await stateStore.save(state);
		let failHistory = true;
		let historyCalls = 0;
		const history = { record: async (_event: unknown, noteApplied: boolean) => { historyCalls += 1; if (failHistory) { failHistory = false; throw new Error('history temporarily unavailable'); } return noteApplied; } };
		let sourceUrl = 'https://steam.example/games/1?revision=old';
		const steam = adapter(async () => snapshot('complete', [{ ...providerGame('1'), sourceUrl }]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		let providerStateCalls = 0;
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, history, onProviderState: async () => { providerStateCalls += 1; } });
		const first = await firstService.prepareAll();
		const failed = await firstService.applySelection(first, first.plan.operations.map((operation) => operation.id), { explicit: true });
		const journalAfterFailure = await firstService.getState();
		expect(failed.operationsApplied).toBe(0);
		expect(journalAfterFailure.operationJournal[0]?.noteApplied).toBe(true);
		expect(journalAfterFailure.operationJournal[0]?.historyApplied).toBe(false);

		const cacheCalls: string[] = [];
		sourceUrl = 'https://steam.example/games/1?revision=new';
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, history, onProviderState: async () => { providerStateCalls += 1; }, onCache: async () => { cacheCalls.push('cache'); } });
		const prepared = await restarted.prepareAll();
		expect(prepared.plan.planRevision).not.toBe(first.plan.planRevision);
		expect(prepared.plan.operations).toHaveLength(0);
		const recovered = await restarted.applySelection(prepared, [], { explicit: true });
		expect(recovered.operationsApplied).toBe(1);
		expect(writes).toBe(1);
		expect(providerStateCalls).toBe(1);
		expect(historyCalls).toBe(2);
		expect(cacheCalls).toEqual(['cache']);
		const recoveredState = await restarted.getState();
		expect(recoveredState.operationJournal[0]?.operation.planRevision).toBe(prepared.plan.planRevision);
		expect(recoveredState.operationJournal[0]?.providerStateApplied).toBe(true);
		expect(recoveredState.operationJournal[0]?.historyApplied).toBe(true);
		expect(recoveredState.operationJournal[0]?.cacheApplied).toBe(true);
		expect(() => migrateState(raw)).not.toThrow();
	});

	it('removes stale achievement cache after a partial snapshot so the next sync refetches it', async () => {
		const gateway = new FakeVaultGateway();
		const cache = createCacheStore();
		const earned = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] };
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60, earned)]);
		const cacheInputs: Array<Readonly<Record<string, unknown>>> = [];
		const steam = adapter(async (options) => {
			cacheInputs.push(options.achievementCache ?? {});
			return next;
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), cache });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		next = snapshot('partial', [providerGame('1', 90)]);
		const partial = await service.prepareAll();
		await service.applySelection(partial, partial.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(await cache.get('1', 'steam', 'achievements')).toBeUndefined();

		next = snapshot('complete', [providerGame('1', 90, earned)]);
		await service.prepareAll();
		expect(cacheInputs.at(-1)).toEqual({});
	});

	it('stores achievement cache freshness at provider fetch time and refetches after TTL', async () => {
		const gateway = new FakeVaultGateway();
		let clock = '2026-09-12T12:00:00.000Z';
		const cache = createCacheStore({ now: () => Date.parse(clock) });
		let playtime = 60;
		const cacheInputs: Array<Readonly<Record<string, unknown>>> = [];
		const steam = adapter(async (options) => {
			cacheInputs.push(options.achievementCache ?? {});
			return { ...snapshot('complete', [providerGame('1', playtime, { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] })]), fetchedAt: options.now ?? clock };
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), cache, now: () => clock });
		const prepared = await service.prepareAll();
		await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });

		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe('2026-09-12T12:00:00.000Z');
		clock = '2026-09-20T12:00:00.000Z';
		playtime = 90;
		const afterTtl = await service.prepareAll();
		expect(cacheInputs[1]).toEqual({});
		await service.applySelection(afterTtl, afterTtl.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe('2026-09-20T12:00:00.000Z');
	});

	it('refreshes achievement cache after a fresh zero-diff sync', async () => {
		const gateway = new FakeVaultGateway();
		let clock = '2026-09-12T12:00:00.000Z';
		const cache = createCacheStore({ now: () => Date.parse(clock) });
		const earned = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] };
		const inputs: Array<Readonly<Record<string, unknown>>> = [];
		const steam = adapter(async (options) => {
			inputs.push(options.achievementCache ?? {});
			return {
				...snapshot('complete', [providerGame('1', 60, earned)]),
				fetchedAt: options.now ?? clock,
				achievementProvenance: { '1': { source: 'network', fetchedAt: options.now ?? clock } },
			};
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), cache, now: () => clock });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		clock = '2026-09-13T12:00:00.000Z';
		const unchanged = await service.prepareAll();
		expect(unchanged.plan.operations).toHaveLength(0);
		await service.applySelection(unchanged, [], { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe(clock);

		clock = '2026-09-20T12:00:00.000Z';
		const afterTtl = await service.prepareAll();
		expect(afterTtl.providerStatuses.steam.state).toBe('success');
		expect(inputs.at(-1)).toEqual({});
		await service.applySelection(afterTtl, [], { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe(clock);
	});

	it('caches fresh achievements for unchanged games in a mixed committed sync', async () => {
		const gateway = new FakeVaultGateway();
		let clock = '2026-09-12T12:00:00.000Z';
		let changedPlaytime = 60;
		const cache = createCacheStore({ now: () => Date.parse(clock) });
		const earned = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] };
		const makeGame = (id: string, title: string, playtime: number): ProviderGame => ({ ...providerGame(id, playtime, earned), title, identity: { provider: 'steam', appId: Number(id) } });
		const steam = adapter(async (options) => ({
			provider: 'steam', status: 'complete', games: [makeGame('1', 'Changed Game', changedPlaytime), makeGame('2', 'Stable Game', 60)], fetchedAt: clock,
			achievementProvenance: {
				'1': { source: 'network' as const, fetchedAt: options.now ?? clock },
				'2': { source: 'network' as const, fetchedAt: options.now ?? clock },
			},
			pagination: { complete: true, pagesFetched: 1 }, paginationComplete: true,
		}));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), cache, now: () => clock });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		clock = '2026-09-13T12:00:00.000Z';
		changedPlaytime = 90;
		const mixed = await service.prepareAll();
		expect(mixed.plan.operations).toHaveLength(1);
		await service.applySelection(mixed, mixed.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await cache.getRaw('2', 'steam'))?.createdAt).toBe(clock);
	});

	it('preserves cached achievement provenance during Steam and PlayStation updates', async () => {
		const gateway = new FakeVaultGateway();
		let clock = '2026-09-12T12:00:00.000Z';
		let playtime = 60;
		const cache = createCacheStore({ now: () => Date.parse(clock) });
		const earned = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false }] };
		const steamCacheInputs: Array<Readonly<Record<string, unknown>>> = [];
		const playstationCacheInputs: Array<Readonly<Record<string, unknown>>> = [];
		const steam = adapter(async (options) => {
			steamCacheInputs.push(options.achievementCache ?? {});
			const cached = options.achievementCache?.['1'];
			return {
				...snapshot('complete', [{ ...providerGame('1', playtime, earned), description: clock === '2026-09-12T12:00:00.000Z' ? undefined : 'Updated metadata' }]),
				fetchedAt: clock,
				achievementProvenance: { '1': { source: cached === undefined ? 'network' as const : 'cache' as const, fetchedAt: cached?.fetchedAt ?? clock } },
			};
		});
		const playstation = {
			...adapter(async (options) => {
				playstationCacheInputs.push(options.achievementCache ?? {});
					const cached = options.achievementCache?.['2'];
					return {
					provider: 'playstation' as const,
					status: 'complete' as const,
					games: [{ ...playstationGame('2', playtime), title: 'PlayStation Example', description: clock === '2026-09-12T12:00:00.000Z' ? undefined : 'Updated metadata', achievements: earned, freshness: { metadata: true, ownership: true, playtime: true, achievements: true } }],
						fetchedAt: clock,
						achievementProvenance: { '2': { source: cached === undefined ? 'network' as const : 'cache' as const, fetchedAt: cached?.fetchedAt ?? clock } },
					pagination: { complete: true, pagesFetched: 1 },
					paginationComplete: true,
				};
			}),
			id: 'playstation' as const,
			getConnectionStatus: async () => ({ provider: 'playstation' as const, state: 'connected' as const, connected: true }),
			testConnection: async () => ({ provider: 'playstation' as const, displayName: 'PlayStation', accountId: 'account' }),
		};
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam, playstation], planner, writer: new VaultWriter(gateway), cache });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe('2026-09-12T12:00:00.000Z');
		expect((await cache.getRaw('2', 'playstation'))?.createdAt).toBe('2026-09-12T12:00:00.000Z');

		clock = '2026-09-13T12:00:00.000Z';
		playtime = 90;
		const beforeTtl = await service.prepareAll();
		expect(steamCacheInputs[1]?.['1']).toBeDefined();
		expect(playstationCacheInputs[1]?.['2']).toBeDefined();
		await service.applySelection(beforeTtl, beforeTtl.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe('2026-09-12T12:00:00.000Z');
		expect((await cache.getRaw('2', 'playstation'))?.createdAt).toBe('2026-09-12T12:00:00.000Z');

		clock = '2026-09-20T12:00:00.000Z';
		playtime = 120;
		const afterTtl = await service.prepareAll();
		expect(steamCacheInputs[2]).toEqual({});
		expect(playstationCacheInputs[2]).toEqual({});
		await service.applySelection(afterTtl, afterTtl.plan.operations.map((operation) => operation.id), { explicit: true });
		expect((await cache.getRaw('1', 'steam'))?.createdAt).toBe('2026-09-20T12:00:00.000Z');
		expect((await cache.getRaw('2', 'playstation'))?.createdAt).toBe('2026-09-20T12:00:00.000Z');
	});

	it('uses an accepted partial snapshot as the durable restart baseline without replacing the successful snapshot', async () => {
		const gateway = new FakeVaultGateway();
		let raw: unknown;
		const stateStore = createStateStore(async () => raw, async (value) => { raw = value; });
		let mode: 'complete' | 'partial' | 'failed' = 'complete';
		const steam = adapter(async () => {
			if (mode === 'failed') throw new Error('Steam unavailable');
			return mode === 'partial' ? snapshot('partial', [providerGame('1', 90)]) : snapshot('complete', [providerGame('1', 60)]);
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const initial = await firstService.prepareAll();
		await firstService.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		mode = 'partial';
		const partial = await firstService.prepareAll();
		await firstService.applySelection(partial, partial.plan.operations.map((operation) => operation.id), { explicit: true });
		const appliedState = await firstService.getState();
		expect(appliedState.lastAppliedProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(90);
		expect(appliedState.lastSuccessfulProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(60);

		mode = 'failed';
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore });
		const failed = await restarted.prepareAll();
		expect(failed.providerStatuses.steam.state).toBe('failed');
		expect(failed.games[0]?.providers.steam?.playtimeMinutes).toBe(90);
		expect(() => migrateState(raw)).not.toThrow();
	});

	it('requires two complete false-ownership observations even when the game remains present', async () => {
		const gateway = new FakeVaultGateway();
		let owned = true;
		const steam = adapter(async () => snapshot('complete', [{ ...providerGame('1'), owned }]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });

		owned = false;
		const first = await service.prepareAll();
		await service.applySelection(first, first.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(first.games[0]?.owned).toBe(true);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(1);

		const second = await service.prepareAll();
		await service.applySelection(second, second.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(second.games[0]?.owned).toBe(false);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(2);
	});

	it('does not recover a manually created note when noteApplied was never durably recorded', async () => {
		const gateway = new FakeVaultGateway();
		let raw: unknown;
		let saveCount = 0;
		const state = migrateState({ settings: { recordHistory: true } });
		raw = state;
		const stateStore = createStateStore(async () => raw, async (value) => {
			saveCount += 1;
			if (saveCount === 2) throw new Error('journal save failed after note apply');
			raw = value;
		});
		let writes = 0;
		const originalCreate = gateway.create.bind(gateway);
		gateway.create = async (path, content) => { writes += 1; await originalCreate(path, content); };
		const events: string[] = [];
		const history = { record: async (event: { type: string }, noteApplied: boolean) => { if (noteApplied) events.push(event.type); return noteApplied; } };
		let sourceUrl = 'https://steam.example/games/1?revision=old';
		const steam = adapter(async () => snapshot('complete', [{ ...providerGame('1'), sourceUrl }]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, history });
		const first = await firstService.prepareAll();
		const failed = await firstService.applySelection(first, first.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(failed.operationsApplied).toBe(0);
		expect(migrateState(raw).operationJournal[0]?.noteApplied).toBe(false);

		sourceUrl = 'https://steam.example/games/1?revision=new';
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, history });
		const prepared = await restarted.prepareAll();
		const recovered = await restarted.applySelection(prepared, [], { explicit: true });
		expect(recovered.operationsApplied).toBe(0);
		expect(writes).toBe(1);
		expect(events).toHaveLength(0);
		await expect(stateStore.load()).resolves.toBeDefined();
	});

	it('does not recover an old journal payload into a changed source snapshot', async () => {
		const gateway = new FakeVaultGateway();
		let raw: unknown;
		let saveCount = 0;
		raw = migrateState({ settings: { recordHistory: true } });
		const stateStore = createStateStore(async () => raw, async (value) => {
			saveCount += 1;
			if (saveCount === 2) throw new Error('journal save failed after note apply');
			raw = value;
		});
		let playtime = 60;
		const steam = adapter(async () => snapshot('complete', [providerGame('1', playtime)]));
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		let stateHookCalls = 0;
		const firstService = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, onProviderState: async () => { stateHookCalls += 1; } });
		const first = await firstService.prepareAll();
		await firstService.applySelection(first, first.plan.operations.map((operation) => operation.id), { explicit: true });

		playtime = 90;
		const restarted = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), stateStore, onProviderState: async () => { stateHookCalls += 1; } });
		const changed = await restarted.prepareAll();
		await restarted.applySelection(changed, changed.plan.operations.map((operation) => operation.id), { explicit: true });
		expect(stateHookCalls).toBe(1);
		expect(await gateway.read('Games/Example Game.md')).toContain('90');
	});

	it('rejects a stale empty preview and does not commit a review-only empty plan', async () => {
		const gateway = new FakeVaultGateway();
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway) });
		const initial = await service.prepareAll();
		await service.applySelection(initial, initial.plan.operations.map((operation) => operation.id), { explicit: true });
		next = snapshot('complete', [providerGame('1', 90)]);
		const changed = await service.prepareAll();
		await service.applySelection(changed, changed.plan.operations.map((operation) => operation.id), { explicit: true });
		const empty = await service.prepareAll();
		next = snapshot('complete', [providerGame('1', 120)]);
		await service.prepareAll();
		await expect(service.applySelection(empty, [], { explicit: true })).rejects.toThrow(VaultConflictError);

		const reviewGateway = new FakeVaultGateway({
			'Games/One.md': '---\ntitle: Example Game\n---\nOne',
			'Games/Two.md': '---\ntitle: Example Game\n---\nTwo',
		});
		const reviewPlanner = createSyncPlanner({ gateway: reviewGateway, noteIndex: await buildNoteIndex(reviewGateway), notesFolder: 'Games' });
		const reviewService = new SyncService({ adapters: [adapter(async () => snapshot('complete', [providerGame('1')])),], planner: reviewPlanner, writer: new VaultWriter(reviewGateway) });
		const review = await reviewService.prepareAll();
		await reviewService.applySelection(review, [], { explicit: true });
		expect((await reviewService.getState()).lastSuccessfulProviderSnapshots.steam).toBeUndefined();
	});

	it('records per-provider change events with distinct payloads', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState(undefined);
		state.settings.recordHistory = true;
		const events: Array<{ provider: string; type: string; data: Record<string, unknown> }> = [];
		const history = { record: async (event: { provider: string; type: string; data: Record<string, unknown> }, noteApplied: boolean) => { if (noteApplied) events.push(event); return noteApplied; } };
		const locked = { earned: 0, total: 1, progress: 0, achievements: [{ id: 'a', name: 'A', unlocked: false, hidden: false }] };
		let next: ProviderSnapshot = snapshot('complete', [providerGame('1', 60, locked)]);
		const steam = adapter(async () => next);
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam], planner, writer: new VaultWriter(gateway), state, history });
		for (const playtime of [60, 90, 120]) {
			if (playtime !== 60) next = snapshot('complete', [providerGame('1', playtime, playtime === 120 ? { earned: 1, total: 1, progress: 100, achievements: [{ id: 'a', name: 'A', unlocked: true, hidden: false, unlockedAt: '2026-09-12T12:00:00Z' }] } : locked)]);
			const prepared = await service.prepareAll();
			await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });
		}
		expect(events.map((event) => event.type)).toEqual(['game-first-seen', 'playtime-changed', 'playtime-changed', 'achievement-unlocked']);
		expect(events.filter((event) => event.type === 'ownership-changed')).toHaveLength(0);
		expect(events[1]?.data).toEqual({ previousMinutes: 60, playtimeMinutes: 90 });
		expect(events[2]?.data).toEqual({ previousMinutes: 90, playtimeMinutes: 120 });
	});

	it('records first-seen events for every provider in a merged game', async () => {
		const gateway = new FakeVaultGateway();
		const state = migrateState({
			settings: { recordHistory: true },
			identityMappings: [
				{ canonicalId: 'game-sync:one', provider: 'steam', providerGameId: '1' },
				{ canonicalId: 'game-sync:one', provider: 'playstation', providerGameId: '2' },
			],
		});
		const events: Array<{ provider: string; type: string }> = [];
		const history = { record: async (event: { provider: string; type: string }, noteApplied: boolean) => { if (noteApplied) events.push({ provider: event.provider, type: event.type }); return noteApplied; } };
		const steam = adapter(async () => snapshot('complete', [providerGame('1')]));
		const playstation = { ...adapter(async () => ({
			provider: 'playstation' as const, status: 'complete' as const, games: [playstationGame('2')], fetchedAt: '2026-09-12T12:00:00.000Z', pagination: { complete: true, pagesFetched: 1 }, paginationComplete: true,
		})), id: 'playstation' as const };
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const service = new SyncService({ adapters: [steam, playstation], planner, writer: new VaultWriter(gateway), state, history });
		const prepared = await service.prepareAll();
		await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });

		expect(events).toEqual([{ provider: 'steam', type: 'game-first-seen' }, { provider: 'playstation', type: 'game-first-seen' }]);
	});
});
