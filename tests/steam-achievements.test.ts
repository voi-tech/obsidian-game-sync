import { describe, expect, it, vi } from 'vitest';
import type { ProviderGame } from '../src/model/provider';
import { normalizeSteamAchievements, shouldRefreshSteamAchievements, refreshSteamAchievements } from '../src/providers/steam/achievements';
import { createSteamAdapter } from '../src/providers/steam/adapter';
import type { SteamApi } from '../src/providers/steam/types';
import type { SecretStore } from '../src/auth/secrets';
import hiddenFixture from './fixtures/steam/achievements-hidden.json';
import noAchievementSupport from './fixtures/steam/no-achievement-support.json';

const game: ProviderGame = {
	provider: 'steam',
	providerGameId: '10',
	title: 'Game',
	developers: [],
	publishers: [],
	genres: [],
	platforms: ['pc'],
	playtimeMinutes: 10,
	lastPlayed: '2026-09-12T10:00:00.000Z',
	freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
	identity: { provider: 'steam', appId: 10 },
};

describe('Steam achievement refresh policy', () => {
	it('refreshes only when a trigger is present', () => {
		expect(shouldRefreshSteamAchievements(game, undefined, { now: '2026-09-12T12:00:00.000Z' })).toBe(true);
		const cached = { fetchedAt: '2026-09-12T11:00:00.000Z', playtimeMinutes: 10, lastPlayed: game.lastPlayed, achievements: { earned: 0, total: 0, progress: 0, achievements: [] } };
		expect(shouldRefreshSteamAchievements(game, cached, { now: '2026-09-12T12:00:00.000Z' })).toBe(false);
		expect(shouldRefreshSteamAchievements({ ...game, playtimeMinutes: 11 }, cached, { now: '2026-09-12T12:00:00.000Z' })).toBe(true);
	});

	it('preserves hidden metadata when the achievement endpoint supplies it', () => {
		const result = normalizeSteamAchievements(hiddenFixture.playerstats.achievements);

		expect(result.achievements[0]).toMatchObject({ id: 'secret_achievement', hidden: true, unlocked: true });
	});

	it('returns a partial achievement result without inventing a fresh empty set on failure', async () => {
		const previous = { earned: 1, total: 2, progress: 50, achievements: [{ id: 'a', unlocked: true, hidden: false }] };
		const result = await refreshSteamAchievements(game, undefined, {
			fetch: async () => {
				throw new Error('endpoint unavailable');
			},
			previousAchievements: previous,
		});

		expect(result).toMatchObject({ ok: false, achievements: previous });
		expect(result.freshness).toBe(false);
	});

	it('marks the snapshot partial and retains previous achievements when one app fails', async () => {
		const api: SteamApi = {
			resolveVanityUrl: async () => ({ success: 1, steamid: '76561198000000001' }),
			getPlayerSummaries: async () => [{ steamid: '76561198000000001', personaname: 'Test Player' }],
			getOwnedGames: async () => ({ game_count: 1, games: [{ appid: 10, name: 'Game', playtime_forever: 30, type: 'game' }] }),
			getAppDetails: async () => ({ type: 'game' }),
			getPlayerAchievements: async () => { throw new Error('achievement endpoint unavailable'); },
		};
		const secretStore: SecretStore = { get: () => 'steam-key', set: () => undefined, delete: () => undefined };
		const previousAchievements = { earned: 1, total: 2, progress: 50, achievements: [{ id: 'a', unlocked: true, hidden: false }] };
		const adapter = createSteamAdapter({ http: { request: async () => ({}) as never }, secretStore, account: '76561198000000001', api });

		const snapshot = await adapter.fetchLibrary({ now: '2026-09-12T12:00:00.000Z', force: true, previousGames: [{ ...game, achievements: previousAchievements }] });
		expect(snapshot.status).toBe('partial');
		expect(snapshot.games[0]?.freshness).toEqual({ metadata: true, ownership: true, playtime: true, achievements: false });
		expect(snapshot.games[0]?.achievements).toEqual(previousAchievements);
	});

	it.each([
		['getAppDetails is unavailable', undefined],
		['getAppDetails returns no details', async () => undefined],
		['getAppDetails returns success false', async () => ({ success: false as const })],
	])('marks the snapshot partial when %s', async (_label, getAppDetails) => {
		const api: SteamApi = {
			resolveVanityUrl: async () => ({ success: 1, steamid: '76561198000000001' }),
			getPlayerSummaries: async () => [{ steamid: '76561198000000001', personaname: 'Test Player' }],
			getOwnedGames: async () => ({ game_count: 1, games: [{ appid: 10, name: 'Game', playtime_forever: 30 }] }),
			getPlayerAchievements: async () => ({ achievements: [] }),
			...(getAppDetails === undefined ? {} : { getAppDetails }),
		};
		const secretStore: SecretStore = { get: () => 'steam-key', set: () => undefined, delete: () => undefined };

		const snapshot = await createSteamAdapter({ http: { request: async () => ({}) as never }, secretStore, account: '76561198000000001', api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z' });

		expect(snapshot.status).toBe('partial');
		expect(snapshot.error?.code).toBe('steam-app-details-partial');
		expect(snapshot.games[0]?.freshness.metadata).toBe(false);
	});

	it('does not fetch or create a fresh achievement set when community stats are unavailable', async () => {
		const getPlayerAchievements = vi.fn(async () => ({ achievements: [] }));
		const api: SteamApi = {
			resolveVanityUrl: async () => ({ success: 1, steamid: '76561198000000001' }),
			getPlayerSummaries: async () => [{ steamid: '76561198000000001', personaname: 'Test Player' }],
			getOwnedGames: async () => noAchievementSupport.response,
			getAppDetails: async () => ({ type: 'game' }),
			getPlayerAchievements,
		};
		const secretStore: SecretStore = { get: () => 'steam-key', set: () => undefined, delete: () => undefined };

		const snapshot = await createSteamAdapter({ http: { request: async () => ({}) as never }, secretStore, account: '76561198000000001', api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z' });

		expect(getPlayerAchievements).not.toHaveBeenCalled();
		expect(snapshot.games[0]?.achievements).toBeUndefined();
		expect(snapshot.games[0]?.freshness.achievements).toBe(false);
	});

	it('preserves a structured private-details error through the adapter snapshot', async () => {
		const api: SteamApi = {
			resolveVanityUrl: async () => ({ success: 1, steamid: '76561198000000001' }),
			getPlayerSummaries: async () => [{ steamid: '76561198000000001', personaname: 'Test Player' }],
			getOwnedGames: async () => { return {}; },
			getPlayerAchievements: async () => ({ achievements: [] }),
		};
		const secretStore: SecretStore = { get: () => 'steam-key', set: () => undefined, delete: () => undefined };
		const snapshot = await createSteamAdapter({ http: { request: async () => ({}) as never }, secretStore, account: '76561198000000001', api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z' });

		expect(snapshot.status).toBe('failed');
		expect(snapshot.error).toEqual({ code: 'steam-private-game-details', message: 'Steam Game Details are private. Set the Steam profile and Game Details visibility to Public.' });
	});
});
