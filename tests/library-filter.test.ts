import { describe, expect, it } from 'vitest';
import type { NormalizedGame } from '../src/model/game';
import { allowsNewNote } from '../src/sync/library-filter';

const all = { includeUnplayed: true, includeFreeToPlay: true, includePreviouslyPlayedNoLongerOwned: true };

function game(overrides: Partial<NormalizedGame> = {}, provider: Partial<NonNullable<NormalizedGame['providers']['steam']>> = {}): NormalizedGame {
	return {
		identity: { canonicalId: 'game-sync:one', steamAppId: 1 },
		canonicalId: 'game-sync:one', title: 'One', developers: [], publishers: [], genres: [], platforms: ['pc'],
		providers: { steam: { providerGameId: '1', title: 'One', developers: [], publishers: [], genres: [], platforms: ['pc'], owned: true, playtimeMinutes: 30, freshness: { metadata: true, ownership: true, playtime: true, achievements: false }, ...provider } },
		owned: true, acquisitionType: 'purchased', playtimeMinutes: 30, ...overrides,
	};
}

describe('library filters for new notes', () => {
	it('lets everything through with the defaults', () => {
		expect(allowsNewNote(game({ playtimeMinutes: 0 }, { playtimeMinutes: 0 }), all)).toBe(true);
	});

	it('skips unplayed, free-to-play and explicitly no-longer-owned games when switched off', () => {
		expect(allowsNewNote(game({ playtimeMinutes: 0 }, { playtimeMinutes: 0 }), { ...all, includeUnplayed: false })).toBe(false);
		expect(allowsNewNote(game({ acquisitionType: 'free' }), { ...all, includeFreeToPlay: false })).toBe(false);
		expect(allowsNewNote(game({ owned: false }, { owned: false }), { ...all, includePreviouslyPlayedNoLongerOwned: false })).toBe(false);
	});

	it('does not treat unknown ownership or a recently played game as filtered', () => {
		expect(allowsNewNote(game({ owned: false }, { owned: undefined }), { ...all, includePreviouslyPlayedNoLongerOwned: false })).toBe(true);
		expect(allowsNewNote(game({ playtimeMinutes: 0, lastPlayed: '2026-01-01' }, { playtimeMinutes: 0, lastPlayed: '2026-01-01' }), { ...all, includeUnplayed: false })).toBe(true);
	});
});
