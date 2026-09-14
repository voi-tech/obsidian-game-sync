import { describe, expect, it } from 'vitest';
import type { ProviderGame, ProviderSnapshot } from '../src/model/provider';
import type { GameProviderAdapter } from '../src/providers/provider';
import { createSteamLibraryProvider } from '../src/providers/steam/library-provider';
import { createPlayStationLibraryProvider } from '../src/providers/playstation/library-provider';

function steamGame(): ProviderGame {
	return {
		provider: 'steam',
		providerGameId: '440',
		title: 'Team Fortress 2',
		releaseDate: '2007-10-10',
		developers: ['Valve'],
		publishers: ['Valve'],
		genres: ['Action'],
		platforms: ['pc'],
		owned: true,
		playtimeMinutes: 120,
		lastPlayed: '2026-09-14T12:00:00.000Z',
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: { provider: 'steam', appId: 440 },
	};
}

function playStationGame(): ProviderGame {
	return {
		provider: 'playstation',
		providerGameId: 'concept-1',
		title: 'PlayStation Game',
		developers: [],
		publishers: [],
		genres: [],
		platforms: ['ps5'],
		owned: true,
		playtimeMinutes: 90,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: { provider: 'playstation', conceptId: 'concept-1', titleIds: ['title-1'], npCommunicationIds: ['np-1'] },
	};
}

function adapter(snapshot: ProviderSnapshot): GameProviderAdapter {
	return {
		id: snapshot.provider,
		getConnectionStatus: async () => ({ provider: snapshot.provider, state: 'connected', connected: true }),
		testConnection: async () => ({ provider: snapshot.provider, displayName: snapshot.provider, accountId: `${snapshot.provider}-account` }),
		fetchLibrary: async () => snapshot,
		disconnect: async () => undefined,
	};
}

function snapshot(game: ProviderGame, status: ProviderSnapshot['status'] = 'complete'): ProviderSnapshot {
	return {
		provider: game.provider,
		status,
		games: [game],
		fetchedAt: '2026-09-14T12:00:00.000Z',
		pagination: { complete: status === 'complete', pagesFetched: 1 },
		paginationComplete: status === 'complete',
	};
}

describe('canonical Steam and PlayStation library providers', () => {
	it('normalizes Steam library membership into CanonicalGame', async () => {
		const result = await createSteamLibraryProvider({ adapter: adapter(snapshot(steamGame())) }).getSnapshot();

		expect(result.status).toBe('complete');
		expect(result.games[0]).toMatchObject({
			identity: { canonicalKey: 'steam:440', externalIds: { steam: '440' } },
			title: 'Team Fortress 2',
			platforms: [{ id: 'steam', owned: true, source: 'steam' }],
			playtime: { canonical: { minutes: 120, source: 'steam', confidence: 'high' } },
		});
	});

	it('normalizes PlayStation library membership into CanonicalGame', async () => {
		const result = await createPlayStationLibraryProvider({ adapter: adapter(snapshot(playStationGame())) }).getSnapshot();

		expect(result.status).toBe('complete');
		expect(result.games[0]).toMatchObject({
			identity: { canonicalKey: 'playstation:concept-1', externalIds: { playstation: 'concept-1' } },
			platforms: [{ id: 'playstation-5', owned: true, source: 'playstation' }],
			playtime: { canonical: { minutes: 90, source: 'playstation', confidence: 'high' } },
		});
	});

	it('preserves incomplete source status and does not present it as a complete library', async () => {
		const result = await createSteamLibraryProvider({ adapter: adapter(snapshot(steamGame(), 'partial')) }).getSnapshot();

		expect(result.status).toBe('partial');
		expect(result.games).toHaveLength(1);
	});
});
