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
import type { GameIdentity } from '../src/model/identity';

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
						titleIds: [],
						npCommunicationIds: [],
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
						titleIds: [],
						npCommunicationIds: [],
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

	it('uses stable canonical IDs independent of title', () => {
		const identity: GameIdentity = { canonicalId: createCanonicalGameId({ provider: 'steam', appId: 10 }) };
		const renamedIdentity: GameIdentity = { canonicalId: createCanonicalGameId({ provider: 'steam', appId: 10 }) };

		expect(identity.canonicalId).toBe(renamedIdentity.canonicalId);
		expect(identity.canonicalId).not.toContain('Example Game');
	});

	it('allows ownership reduction only for a complete paginated snapshot', () => {
		const complete = {
			provider: 'steam' as const,
			status: 'complete' as const,
			games: [],
			fetchedAt: '2026-09-12T12:00:00Z',
			pagination: { complete: true, pagesFetched: 2 },
		};
		const partial = { ...complete, status: 'partial' as const, pagination: { complete: false, pagesFetched: 1 } };
		const failed = { ...complete, status: 'failed' as const };

		expect(isCompleteProviderSnapshot(complete)).toBe(true);
		expect(canDecreaseOwnership(complete)).toBe(true);
		expect(canDecreaseOwnership(partial)).toBe(false);
		expect(canDecreaseOwnership(failed)).toBe(false);
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
});
