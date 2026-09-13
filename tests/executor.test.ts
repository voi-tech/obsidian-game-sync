import { describe, expect, it } from 'vitest';
import { createSyncPlanner } from '../src/sync/planner';
import { SyncExecutor } from '../src/sync/executor';
import { VaultWriter } from '../src/vault/writer';
import { buildNoteIndex } from '../src/vault/note-index';
import { noteFingerprint } from '../src/vault/gateway';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { FakeVaultGateway } from './fake-gateway';
import type { NormalizedGame } from '../src/model/game';

const game: NormalizedGame = {
	identity: { canonicalId: 'game-sync:one', steamAppId: 1 }, canonicalId: 'game-sync:one', title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], providers: {
		steam: { providerGameId: '1', title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], owned: true, playtimeMinutes: 90, freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
	},
	}, owned: true, acquisitionType: 'unknown', playtimeMinutes: 90,
};

describe('sync executor', () => {
	it('uses VaultWriter and preserves manual body during adoption', async () => {
		const initial = '---\nsteam-id: "1"\ncustom: keep\n---\n# Manual body\n\nDo not rewrite';
		const gateway = new FakeVaultGateway({ 'Games/Old.md': initial });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const plan = await planner.plan([game], 'revision-1');
		let stateCalls = 0;
		const executor = new SyncExecutor({ writer: new VaultWriter(gateway), games: [game], onProviderState: async () => { stateCalls += 1; } });

		const result = await executor.apply(plan);
		const content = await gateway.read('Games/Old.md');
		expect(result.appliedOperationIds).toHaveLength(1);
		expect(stateCalls).toBe(1);
		expect(parseFrontmatter(content).body).toBe('# Manual body\n\nDo not rewrite');
		expect(parseFrontmatter(content).frontmatter['game-sync-id']).toBe('game-sync:one');
	});

	it('does not advance state, history or cache when the note write fails', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const plan = await planner.plan([game], 'revision-1');
		const calls: string[] = [];
		const executor = new SyncExecutor({
			writer: new VaultWriter(gateway), games: [game],
			onProviderState: async () => { calls.push('state'); }, onHistory: async () => { calls.push('history'); }, onCache: async () => { calls.push('cache'); },
		});
		gateway.create = async () => { throw new Error('write failed'); };

		const result = await executor.apply(plan);
		expect(result.appliedOperationIds).toHaveLength(0);
		expect(result.pendingOperationIds).toEqual([plan.operations[0]?.id]);
		expect(calls).toEqual([]);
	});

	it('leaves deselected operations pending and does not repeat completed callbacks', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const firstPlan = await planner.plan([game], 'revision-1');
		const secondGame = { ...game, canonicalId: 'game-sync:two', identity: { canonicalId: 'game-sync:two', steamAppId: 2 }, title: 'Second Game', providers: { steam: { ...game.providers.steam!, providerGameId: '2', title: 'Second Game' } } };
		const secondPlan = await createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' }).plan([game, secondGame], 'revision-2');
		const applied: string[] = [];
		const executor = new SyncExecutor({ writer: new VaultWriter(gateway), games: [game, secondGame], onProviderState: async (item) => { applied.push(item.canonicalId); } });

		const deselected = await executor.apply(secondPlan, []);
		expect(deselected.pendingOperationIds).toContain(secondPlan.operations[0]?.id);
		const selected = await executor.apply(secondPlan, [secondPlan.operations[0]?.id ?? '']);
		const repeated = await executor.apply(secondPlan, [secondPlan.operations[0]?.id ?? '']);
		expect(selected.appliedOperationIds).toHaveLength(1);
		expect(repeated.appliedOperationIds).toHaveLength(0);
		expect(applied).toHaveLength(1);
		expect(firstPlan.operations).toHaveLength(1);
	});

	it('rejects a plan with a changed revision before writing', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const plan = await planner.plan([game], 'revision-1');
		const executor = new SyncExecutor({ writer: new VaultWriter(gateway), games: [game], currentRevision: 'revision-2' });

		await expect(executor.apply(plan)).rejects.toThrow(/stale/i);
	});

	it('does not repeat a successful note write when a later hook fails', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const plan = await planner.plan([game], 'revision-hooks');
		const originalCreate = gateway.create.bind(gateway);
		let writes = 0;
		gateway.create = async (path, content) => { writes += 1; await originalCreate(path, content); };
		let failHistory = true;
		const calls: string[] = [];
		const executor = new SyncExecutor({
			writer: new VaultWriter(gateway), games: [game],
			currentNoteFingerprints: async () => ({ 'Games/Example Game.md': await gateway.exists('Games/Example Game.md') ? noteFingerprint(await gateway.read('Games/Example Game.md')) : null }),
			onProviderState: async () => { calls.push('state'); },
			onHistory: async () => { calls.push('history'); if (failHistory) { failHistory = false; throw new Error('history failed'); } },
			onCache: async () => { calls.push('cache'); },
		});

		const first = await executor.apply(plan);
		const second = await executor.apply(plan);
		expect(first.appliedOperationIds).toHaveLength(0);
		expect(second.appliedOperationIds).toHaveLength(1);
		expect(writes).toBe(1);
		expect(calls).toEqual(['state', 'history', 'history', 'cache']);
	});

	it('captures the post-write fingerprint before hooks and rejects a manual edit on retry', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const plan = await planner.plan([game], 'revision-fingerprint');
		let failHistory = true;
		const executor = new SyncExecutor({
			writer: new VaultWriter(gateway), games: [game],
			currentNoteFingerprints: () => planner.currentNoteFingerprints(),
			onHistory: async () => { if (failHistory) { failHistory = false; throw new Error('history failed'); } },
		});

		const first = await executor.apply(plan);
		expect(first.failedOperationIds).toHaveLength(1);
		gateway.set('Games/Example Game.md', `${await gateway.read('Games/Example Game.md')}\nManual edit`);

		await expect(executor.apply(plan)).rejects.toThrow(/stale|conflict/i);
	});
});
