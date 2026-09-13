import { describe, expect, it } from 'vitest';
import { transitionPresence, type PresenceState } from '../src/sync/freshness';
import type { ProviderSnapshot } from '../src/model/provider';

function snapshot(status: ProviderSnapshot['status'], games: string[] = [], owned = true): ProviderSnapshot {
	return {
		provider: 'steam',
		status,
		games: games.map((providerGameId) => ({
			provider: 'steam', providerGameId, title: providerGameId, developers: [], publishers: [], genres: [], platforms: [],
				owned,
				freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
			identity: { provider: 'steam', appId: Number(providerGameId) || 1 },
		})),
		fetchedAt: '2026-09-12T12:00:00.000Z',
		pagination: { complete: status === 'complete', pagesFetched: 1 },
		paginationComplete: status === 'complete',
	};
}

describe('provider presence freshness', () => {
	it('requires two complete successful misses before ownership may be reduced', () => {
		const present = transitionPresence('present', snapshot('complete', ['1']), '1');
		const missingOnce = transitionPresence(present.state, snapshot('complete'), '1');
		const missingConfirmed = transitionPresence(missingOnce.state, snapshot('complete'), '1');

		expect(present.state).toBe<PresenceState>('present');
		expect(missingOnce.state).toBe('missing-once');
		expect(missingOnce.canReduceOwnership).toBe(false);
		expect(missingConfirmed.state).toBe('missing-confirmed');
		expect(missingConfirmed.canReduceOwnership).toBe(true);
	});

	it('does not advance missing state for partial or failed snapshots', () => {
		const partial = transitionPresence('present', snapshot('partial'), '1');
		const failed = transitionPresence(partial.state, snapshot('failed'), '1');

		expect(partial.state).toBe('present');
		expect(partial.canReduceOwnership).toBe(false);
		expect(failed.state).toBe('present');
		expect(failed.canReduceOwnership).toBe(false);
	});

	it('keeps confirmed absence immutable until a complete snapshot sees the game again', () => {
		const restored = transitionPresence('missing-confirmed', snapshot('complete', ['1']), '1');
		expect(restored).toEqual({ state: 'present', consecutiveMissing: 0, canReduceOwnership: false });
	});

	it('requires two complete false-ownership observations for an existing record', () => {
		const first = transitionPresence('present', snapshot('complete', ['1'], false), '1', false);
		const second = transitionPresence(first.state, snapshot('complete', ['1'], false), '1', false);

		expect(first).toEqual({ state: 'missing-once', consecutiveMissing: 1, canReduceOwnership: false });
		expect(second).toEqual({ state: 'missing-confirmed', consecutiveMissing: 2, canReduceOwnership: true });
	});
});
