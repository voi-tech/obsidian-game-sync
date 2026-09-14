import { describe, expect, it, vi } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { CanonicalLibrarySnapshot } from '../src/model/canonical-provider';
import { createSteamEnricher } from '../src/providers/steam/enricher';
import { createPlayStationEnricher } from '../src/providers/playstation/enricher';
import type { SteamApi, SteamAuthService } from '../src/providers/steam/types';
import type { PlayStationApi, PlayStationAuthService } from '../src/providers/playstation/types';

function snapshot(games: readonly CanonicalGame[]): CanonicalLibrarySnapshot {
	return { status: 'complete', games, revision: 'base', diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: games.length, gamesNormalized: games.length, diagnostics: [] } };
}

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return { identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', igdb: 1, steam: '10', playstation: 'NP-1' } }, title: 'Example', metadata: { developers: [], publishers: [], genres: [] }, platforms: [{ id: 'steam', source: 'gametrack', owned: true }, { id: 'playstation-5', source: 'gametrack' }], playtime: { observations: [] }, provenance: { provider: 'gametrack', sourceId: 'one', schemaSignature: 'fixture' }, ...overrides };
}

const steamAuth = { resolveSteamId64: vi.fn(async () => '76561198000000001') } as unknown as SteamAuthService;
const psAuth = { getAccessToken: vi.fn(async () => 'token') } as unknown as PlayStationAuthService;

describe('SteamEnricher', () => {
	it('enriches only matched canonical games and never adds an external game', async () => {
		const api: SteamApi = {
			resolveVanityUrl: vi.fn(), getPlayerSummaries: vi.fn(),
			getOwnedGames: vi.fn(async () => ({ game_count: 2, games: [{ appid: 10, name: 'Example', playtime_forever: 90, rtime_last_played: 1 }, { appid: 20, name: 'External only', playtime_forever: 30 }] })),
			getPlayerAchievements: vi.fn(async () => ({ achievements: [{ name: 'a', displayName: 'A', achieved: 1, unlocktime: 2 }] })),
		};
		const result = await createSteamEnricher({ auth: steamAuth, api, now: () => '2026-09-14T12:00:00.000Z' }).enrich(snapshot([game()]));

		expect(result.status).toBe('partial');
		expect(result.patches).toHaveLength(1);
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'UNMATCHED_EXTERNAL_GAME')).toBe(true);
		expect(result.patches[0]?.patch.playtimeObservation).toMatchObject({ source: 'steam', minutes: 90, confidence: 'high' });
		expect(result.patches[0]?.patch.achievements?.[0]).toMatchObject({ source: 'steam', unlocked: 1, total: 1, completionPercent: 100 });
	});

	it('keeps the base snapshot usable when the optional API fails', async () => {
		const api = { getOwnedGames: vi.fn(async () => { throw new Error('network'); }) } as unknown as SteamApi;
		const result = await createSteamEnricher({ auth: steamAuth, api }).enrich(snapshot([game()]));
		expect(result.status).toBe('failed');
		expect(result.patches).toEqual([]);
	});
});

describe('PlayStationEnricher', () => {
	it('adds trophy summary only for a canonical PlayStation match', async () => {
		const api: PlayStationApi = {
			getUserPlayedGames: vi.fn(async () => ({ titles: [{ titleId: 'title-1', name: 'Example', category: 'ps5_game', playDuration: 'PT2H', lastPlayedDateTime: '2026-09-13T12:00:00.000Z' }], complete: true, pagesFetched: 1 })),
			getPurchasedGames: vi.fn(async () => ({ games: [], complete: true, pagesFetched: 1 })),
			getRecentlyPlayedGames: vi.fn(async () => ({ games: [], complete: true, pagesFetched: 1 })),
			getUserTitles: vi.fn(async () => ({ titles: [], complete: true, pagesFetched: 1 })),
			getTitleTrophies: vi.fn(async () => ({ npServiceName: 'trophy2' as const, totalItemCount: 1, complete: true, pagesFetched: 1, trophies: [{ trophyId: 1, trophyType: 'gold' as const, trophyName: 'Gold' }] })),
			getUserTrophiesEarnedForTitle: vi.fn(async () => ({ totalItemCount: 1, complete: true, pagesFetched: 1, trophies: [{ trophyId: 1, earned: true, earnedDateTime: '2026-09-13T12:00:00.000Z' }] })),
		};
		const result = await createPlayStationEnricher({ auth: psAuth, api, now: () => '2026-09-14T12:00:00.000Z' }).enrich(snapshot([game()]));

		expect(result.status).toBe('success');
		expect(result.patches[0]?.patch.playtimeObservation).toMatchObject({ source: 'playstation', minutes: 120, confidence: 'high' });
		expect(result.patches[0]?.patch.achievements?.[0]).toMatchObject({ source: 'playstation', unlocked: 1, total: 1, completionPercent: 100 });
	});
});
