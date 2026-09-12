import { describe, expect, it } from 'vitest';
import type { ProviderGame } from '../src/model/provider';
import { canDecreaseOwnership, isCompleteProviderSnapshot } from '../src/model/provider';
import {
	calculateTotalPlaytime,
	createCanonicalGameId,
	createNormalizedGame,
	createOperation,
	createSyncPlan,
	isSyncPlanStale,
} from '../src/model/operations';
import { resolveCanonicalGameId, type GameIdentity } from '../src/model/identity';

function providerGame(overrides: Partial<ProviderGame> = {}): ProviderGame {
	return {
		provider: 'steam',
		providerGameId: '10',
		title: 'Example Game',
		developers: [],
		publishers: [],
		genres: [],
		platforms: ['pc'],
		freshness: {
			metadata: true,
			ownership: true,
			playtime: true,
			achievements: true,
		},
		identity: { provider: 'steam', appId: 10 },
		...overrides,
	};
}

describe('canonical game domain', () => {
	it('computes total playtime from provider values', () => {
		const normalized = createNormalizedGame(
			[
				providerGame({ playtimeMinutes: 120 }),
				providerGame({
					provider: 'playstation',
					providerGameId: 'concept-10',
					platforms: ['ps5'],
					playtimeMinutes: 80,
					identity: {
						provider: 'playstation',
						conceptId: 'concept-10',
						titleIds: ['title-10'],
						npCommunicationIds: ['comm-10'],
					},
				}),
			],
			'game:example',
		);

		expect(calculateTotalPlaytime(normalized)).toBe(200);
		expect(normalized.playtimeMinutes).toBe(200);
	});

	it('keeps achievement systems separate', () => {
		const steamAchievements = {
			earned: 1,
			total: 2,
			progress: 50,
			achievements: [],
		};
		const trophies = {
			earned: 2,
			total: 4,
			progress: 50,
			achievements: [],
		};
		const normalized = createNormalizedGame(
			[
				providerGame({ achievements: steamAchievements }),
				providerGame({
					provider: 'playstation',
					providerGameId: 'concept-10',
					achievements: trophies,
					platforms: ['ps5'],
					identity: {
						provider: 'playstation',
						conceptId: 'concept-10',
						titleIds: ['title-10'],
						npCommunicationIds: ['comm-10'],
					},
				}),
			],
			'game:example',
		);

		expect(normalized.providers.steam?.achievements).toEqual(steamAchievements);
		expect(normalized.providers.playstation?.achievements).toEqual(trophies);
		expect(normalized.providers.steam?.achievements).not.toBe(normalized.providers.playstation?.achievements);
	});

	it('distinguishes providers from actual platforms', () => {
		const game = providerGame({ provider: 'steam', platforms: ['pc'] });

		expect(game.provider).toBe('steam');
		expect(game.platforms).toEqual(['pc']);
		expect(game.platforms).not.toContain(game.provider);
	});

	it('supports played-but-no-longer-owned', () => {
		const game = providerGame({ owned: false, playtimeMinutes: 45, lastPlayed: '2026-09-01' });
		const normalized = createNormalizedGame([game], 'game:example');

		expect(normalized.owned).toBe(false);
		expect(normalized.providers.steam?.owned).toBe(false);
		expect(normalized.lastPlayed).toBe('2026-09-01');
	});

	it('uses random UUID canonical IDs and preserves an existing GameIdentity ID', () => {
		const persisted: GameIdentity = { canonicalId: '6e8d9f9c-7c5b-4aa4-8cd1-2f0cf6cb6fb0' };
		const first = createCanonicalGameId({ provider: 'steam', appId: 10 });
		const second = createCanonicalGameId({ provider: 'steam', appId: 10 });

		expect(createCanonicalGameId(persisted)).toBe(persisted.canonicalId);
		expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		expect(first).not.toMatch(/^game-sync:(steam|playstation):/);
		expect(second).not.toBe(first);
	});

	it('allows ownership reduction only for a complete paginated snapshot', () => {
		const complete = {
			provider: 'steam' as const,
			status: 'complete' as const,
			games: [],
			fetchedAt: '2026-09-12T12:00:00Z',
			pagination: { complete: true, pagesFetched: 2 },
			paginationComplete: true,
		};
		const partial = { ...complete, status: 'partial' as const, pagination: { complete: false, pagesFetched: 1 } };
		const failed = { ...complete, status: 'failed' as const };

		expect(isCompleteProviderSnapshot(complete)).toBe(true);
		expect(canDecreaseOwnership(complete)).toBe(true);
		expect(canDecreaseOwnership(partial)).toBe(false);
		expect(canDecreaseOwnership(failed)).toBe(false);
	});

	it('requires a stable provider identifier and preserves durable canonical mappings', () => {
		expect(() =>
			createCanonicalGameId({
				provider: 'playstation',
				conceptId: '',
				titleIds: [],
				npCommunicationIds: [],
			} as never),
		).toThrow();

		expect(
			resolveCanonicalGameId(
				{ provider: 'steam', appId: 10 },
				'10',
				[{ canonicalId: 'game-sync:durable', provider: 'steam', providerGameId: '10' }],
			),
		).toBe('game-sync:durable');

		const generated = resolveCanonicalGameId({ provider: 'steam', appId: 10 }, '11', []);
		expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		expect(generated).not.toMatch(/^game-sync:(steam|playstation):/);
	});

	it('creates deterministic operations and rejects stale note previews', () => {
		const operationInput = {
			canonicalGameId: 'game:example',
			kind: 'update-properties' as const,
			risk: 'safe' as const,
			path: 'Games/Example Game.md',
			summary: 'Update managed properties',
			expectedNoteFingerprint: 'fingerprint-1',
			planRevision: 'revision-1',
		};
		const first = createOperation(operationInput);
		const second = createOperation(operationInput);
		const plan = createSyncPlan('revision-1', [first]);

		expect(first.id).toBe(second.id);
		expect(plan.operations[0]?.id).toBe(first.id);
		expect(isSyncPlanStale(plan, 'revision-1', { [operationInput.path]: 'fingerprint-1' })).toBe(false);
		expect(isSyncPlanStale(plan, 'revision-2', { [operationInput.path]: 'fingerprint-1' })).toBe(true);
		expect(isSyncPlanStale(plan, 'revision-1', { [operationInput.path]: 'fingerprint-2' })).toBe(true);
	});

	it('enforces operation fingerprint invariants and plan consistency', () => {
		const invalidCreate = {
			canonicalGameId: 'game:example',
			kind: 'create-note' as const,
			risk: 'safe' as const,
			summary: 'Create note',
			planRevision: 'revision-1',
			expectedNoteFingerprint: 'must-not-exist',
		};
		const invalidUpdate = {
			canonicalGameId: 'game:example',
			kind: 'update-properties' as const,
			risk: 'safe' as const,
			summary: 'Update properties',
			planRevision: 'revision-1',
			expectedNoteFingerprint: '  ',
		};
		const missingPathUpdate = {
			canonicalGameId: 'game:example',
			kind: 'update-properties' as const,
			risk: 'safe' as const,
			summary: 'Update properties',
			planRevision: 'revision-1',
			expectedNoteFingerprint: 'fingerprint-1',
		};
		const missingPathAdopt = { ...missingPathUpdate, kind: 'adopt-note' as const };

		expect(() => createOperation(invalidCreate as never)).toThrow();
		expect(() => createOperation(invalidUpdate as never)).toThrow();
		expect(() => createOperation(missingPathUpdate as never)).toThrow();
		expect(() => createOperation(missingPathAdopt as never)).toThrow();

		const update = createOperation({
			canonicalGameId: 'game:example',
			kind: 'update-properties',
			risk: 'safe',
			path: 'Games/Example.md',
			summary: 'Update properties',
			planRevision: 'revision-2',
			expectedNoteFingerprint: 'fingerprint-1',
		});
		const conflicting = createOperation({ ...update, summary: 'Conflicting update', expectedNoteFingerprint: 'fingerprint-2' });
		const createNote = createOperation({
			canonicalGameId: 'game:new',
			kind: 'create-note',
			risk: 'safe',
			path: 'Games/New.md',
			summary: 'Create note',
			planRevision: 'revision-2',
		});

		expect(() => createSyncPlan('revision-1', [update])).toThrow();
		expect(() => createSyncPlan('revision-2', [update, conflicting])).toThrow();
		const notePlan = createSyncPlan('revision-2', [update, createNote]);
		expect(notePlan.expectedNoteFingerprints).toEqual({
			'Games/Example.md': 'fingerprint-1',
			'Games/New.md': null,
		});
	});
});
