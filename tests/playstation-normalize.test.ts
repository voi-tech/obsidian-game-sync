import { describe, expect, it } from 'vitest';
import played from './fixtures/playstation/played.json';
import playedNoPurchase from './fixtures/playstation/played-no-purchase.json';
import purchased from './fixtures/playstation/purchased.json';
import recentlyPlayed from './fixtures/playstation/recently-played.json';
import partialTrophyFailure from './fixtures/playstation/partial-trophy-failure.json';
import trophyTitles from './fixtures/playstation/trophy-titles.json';
import { normalizePlayStationGames, normalizePlayStationLibrary } from '../src/providers/playstation/normalize';
import { createPlayStationAdapter } from '../src/providers/playstation/adapter';
import type { PlayStationApi, PlayStationTrophyTitle } from '../src/providers/playstation/types';
import type { SecretStore } from '../src/auth/secrets';
import type { ProviderGame } from '../src/model/provider';

describe('PlayStation normalization', () => {
	it('merges PS4 and PS5 records by concept while preserving all identifiers', () => {
		const normalized = normalizePlayStationLibrary({ played: played.titles, purchased: purchased.data.purchasedTitlesRetrieve.games, recentlyPlayed: recentlyPlayed.data.gameLibraryTitlesRetrieve.games, trophyTitles: trophyTitles.titles as PlayStationTrophyTitle[] });
		const games = normalized.games;
		const game = games.find((entry) => entry.title === 'Shared Game');

		expect(game).toBeDefined();
		expect(game?.identity).toMatchObject({ provider: 'playstation', conceptId: '12345' });
		expect((game?.identity as { titleIds: string[] }).titleIds).toEqual(['CUSA00001_00', 'PPSA00001_00']);
		expect(game?.platforms).toEqual(['ps4', 'ps5']);
		expect(game?.playtimeMinutes).toBe(65);
		expect(game?.identity).toMatchObject({ npCommunicationIds: ['NPWR00001_00'] });
		expect(normalized.trophyServices.get('NPWR00001_00')).toBe('trophy');

		const purchasedOnly = games.find((entry) => entry.title === 'Purchased Only');
		expect(purchasedOnly).toMatchObject({ owned: true, platforms: ['ps5'], identity: { provider: 'playstation', conceptId: '67890', titleIds: ['PPSA00002_00'], npCommunicationIds: [] } });
		expect(purchasedOnly?.playtimeMinutes).toBeUndefined();
	});

	it('marks a played game as not owned when it is absent from the current purchase source', () => {
		const [game] = normalizePlayStationGames({ played: playedNoPurchase.titles, purchased: [] });

		expect(game).toMatchObject({ title: 'Played No Purchase', owned: false, playtimeMinutes: 10, freshness: { ownership: true } });
	});

	it('keeps ownership unknown when the purchases source is unavailable', () => {
		const result = normalizePlayStationLibrary({ played: played.titles, ownershipKnown: false });
		const game = result.games.find((entry) => entry.title === 'Shared Game');

		expect(result.ownershipKnown).toBe(false);
		expect(game?.owned).toBeUndefined();
		expect(game?.freshness.ownership).toBe(false);
	});

	it('marks a snapshot partial when any paginated source is incomplete', async () => {
		const api: PlayStationApi = {
			getUserPlayedGames: async () => ({ complete: true, pagesFetched: 1, titles: [{ titleId: 'CUSA00003_00', name: 'Incomplete Source Game', category: 'ps4_game', playDuration: 'PT1H', concept: { id: '300', titleIds: ['CUSA00003_00'], name: 'Incomplete Source Game' } }] }),
			getPurchasedGames: async () => ({ complete: false, pagesFetched: 100, games: [] }),
			getRecentlyPlayedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getUserTitles: async () => ({ complete: false, pagesFetched: 100, titles: [] }),
			getTitleTrophies: async () => ({ complete: true, pagesFetched: 1, npServiceName: 'trophy', trophies: [] }),
			getUserTrophiesEarnedForTitle: async () => ({ complete: true, pagesFetched: 1, trophies: [] }),
		};
		const secretStore: SecretStore = { get: () => null, set: () => undefined, delete: () => undefined };
		const snapshot = await createPlayStationAdapter({ secretStore, api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z' });

		expect(snapshot.status).toBe('partial');
		expect(snapshot.paginationComplete).toBe(false);
		expect(snapshot.games[0]?.owned).toBeUndefined();
		expect(snapshot.games[0]?.freshness.ownership).toBe(false);
	});

	it('does not attach a trophy title to multiple same-name groups', () => {
		const result = normalizePlayStationLibrary({
			played: [
				{ titleId: 'CUSA10000_00', name: 'Same Title', concept: { id: '100', titleIds: ['CUSA10000_00'], name: 'Same Title' }, category: 'ps4_game', playDuration: 'PT1H' },
				{ titleId: 'CUSA20000_00', name: 'Same Title', concept: { id: '200', titleIds: ['CUSA20000_00'], name: 'Same Title' }, category: 'ps4_game', playDuration: 'PT2H' },
			],
			trophyTitles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR-AMBIGUOUS', trophyTitleName: 'Same Title' }],
		});

		expect(result.games).toHaveLength(2);
		expect(result.games.every((entry) => entry.identity.provider === 'playstation' && entry.identity.npCommunicationIds.length === 0)).toBe(true);
	});

	it('preserves library and previous trophies when a trophy endpoint fails', async () => {
		const api: PlayStationApi = {
			getUserPlayedGames: async () => ({ complete: true, pagesFetched: 1, titles: [{ titleId: 'CUSA00001_00', name: 'Shared Game', category: 'ps4_game', service: 'none_purchased', playDuration: 'PT2H', concept: { id: '12345', titleIds: ['CUSA00001_00'], name: 'Shared Game' } }] }),
			getPurchasedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getRecentlyPlayedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getUserTitles: async () => ({ complete: true, pagesFetched: 1, titles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR00001_00', trophyTitleName: 'Shared Game' }] }),
			getTitleTrophies: async () => { throw new Error(partialTrophyFailure.error); },
			getUserTrophiesEarnedForTitle: async () => { throw new Error('earned endpoint unavailable'); },
		};
		const secretStore: SecretStore = { get: () => null, set: () => undefined, delete: () => undefined };
		const previousAchievements = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'trophy-1', unlocked: true, hidden: false }] };
		const previous: ProviderGame = {
			provider: 'playstation',
			providerGameId: '12345',
			title: 'Shared Game',
			developers: [],
			publishers: [],
			genres: [],
			platforms: ['ps4'],
			owned: true,
			playtimeMinutes: 15,
			achievements: previousAchievements,
			freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
			identity: { provider: 'playstation', conceptId: '12345', titleIds: ['PPSA00001_00'], npCommunicationIds: ['NPWR00001_00', 'NPWR-OLD'] },
		};
		const adapter = createPlayStationAdapter({ secretStore, api });

		const snapshot = await adapter.fetchLibrary({ now: '2026-09-12T12:00:00.000Z', force: true, previousGames: [previous] });
		expect(snapshot.status).toBe('partial');
		expect(snapshot.games[0]?.playtimeMinutes).toBe(120);
		expect(snapshot.games[0]?.achievements).toEqual(previousAchievements);
		expect(snapshot.games[0]?.freshness.achievements).toBe(false);
		expect(snapshot.games[0]?.identity).toMatchObject({ conceptId: '12345', titleIds: ['CUSA00001_00', 'PPSA00001_00'], npCommunicationIds: ['NPWR-OLD', 'NPWR00001_00'] });
	});

	it('refreshes previous trophies after cache expiry even when previous freshness was true', async () => {
		let trophyCalls = 0;
		const api: PlayStationApi = {
			getUserPlayedGames: async () => ({ complete: true, pagesFetched: 1, titles: [{ titleId: 'CUSA00001_00', name: 'Shared Game', category: 'ps4_game', service: 'none_purchased', playDuration: 'PT2H', concept: { id: '12345', titleIds: ['CUSA00001_00'], name: 'Shared Game' } }] }),
			getPurchasedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getRecentlyPlayedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getUserTitles: async () => ({ complete: true, pagesFetched: 1, titles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR00001_00', trophyTitleName: 'Shared Game' }] }),
			getTitleTrophies: async () => { trophyCalls += 1; return { complete: true, pagesFetched: 1, npServiceName: 'trophy', trophies: [{ trophyId: 1, trophyType: 'bronze', trophyName: 'One' }] }; },
			getUserTrophiesEarnedForTitle: async () => ({ complete: true, pagesFetched: 1, trophies: [{ trophyId: 1, trophyType: 'bronze', earned: true }] }),
		};
		const secretStore: SecretStore = { get: () => null, set: () => undefined, delete: () => undefined };
		const previous: ProviderGame = {
			provider: 'playstation', providerGameId: '12345', title: 'Shared Game', developers: [], publishers: [], genres: [], platforms: ['ps4'], playtimeMinutes: 15,
			achievements: { earned: 1, total: 1, progress: 100, achievements: [{ id: 'old', unlocked: true, hidden: false }] },
			freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
			identity: { provider: 'playstation', conceptId: '12345', titleIds: ['CUSA00001_00'], npCommunicationIds: ['NPWR00001_00'] },
		};
		const snapshot = await createPlayStationAdapter({ secretStore, api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z', previousGames: [previous], achievementCache: { '12345': { fetchedAt: '2026-09-01T00:00:00.000Z', achievements: previous.achievements } }, achievementCacheTtlMs: 1_000 });

		expect(trophyCalls).toBe(1);
		expect(snapshot.games[0]?.freshness.achievements).toBe(true);
		expect(snapshot.achievementProvenance?.['12345']).toEqual({ source: 'network', fetchedAt: '2026-09-12T12:00:00.000Z' });
	});

	it('marks a fresh PlayStation cache reuse with the original fetchedAt', async () => {
		let trophyCalls = 0;
		const api: PlayStationApi = {
			getUserPlayedGames: async () => ({ complete: true, pagesFetched: 1, titles: [{ titleId: 'CUSA00001_00', name: 'Shared Game', category: 'ps4_game', playDuration: 'PT2H', concept: { id: '12345', titleIds: ['CUSA00001_00'], name: 'Shared Game' } }] }),
			getPurchasedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getRecentlyPlayedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getUserTitles: async () => ({ complete: true, pagesFetched: 1, titles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR00001_00', trophyTitleName: 'Shared Game' }] }),
			getTitleTrophies: async () => { trophyCalls += 1; return { complete: true, pagesFetched: 1, npServiceName: 'trophy', trophies: [{ trophyId: 1, trophyType: 'bronze', trophyName: 'One' }] }; },
			getUserTrophiesEarnedForTitle: async () => ({ complete: true, pagesFetched: 1, trophies: [{ trophyId: 1, trophyType: 'bronze', earned: true }] }),
		};
		const previousAchievements = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'old', unlocked: true, hidden: false }] };
		const previous: ProviderGame = {
			provider: 'playstation', providerGameId: '12345', title: 'Shared Game', developers: [], publishers: [], genres: [], platforms: ['ps4'], playtimeMinutes: 15,
			achievements: previousAchievements, freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
			identity: { provider: 'playstation', conceptId: '12345', titleIds: ['CUSA00001_00'], npCommunicationIds: ['NPWR00001_00'] },
		};
		const secretStore: SecretStore = { get: () => null, set: () => undefined, delete: () => undefined };
		const snapshot = await createPlayStationAdapter({ secretStore, api }).fetchLibrary({
			now: '2026-09-12T12:00:00.000Z',
			previousGames: [previous],
			achievementCache: { '12345': { fetchedAt: '2026-09-01T00:00:00.000Z', playtimeMinutes: 15, achievements: previousAchievements } },
			achievementCacheTtlMs: 1_000_000_000,
		});

		expect(trophyCalls).toBe(0);
		expect(snapshot.achievementProvenance?.['12345']).toEqual({ source: 'cache', fetchedAt: '2026-09-01T00:00:00.000Z' });
	});

	it('marks achievements stale when a PlayStation game has no communication IDs', async () => {
		const api: PlayStationApi = {
			getUserPlayedGames: async () => ({ complete: true, pagesFetched: 1, titles: [{ titleId: 'CUSA00001_00', name: 'Shared Game', category: 'ps4_game', playDuration: 'PT2H', concept: { id: '12345', titleIds: ['CUSA00001_00'], name: 'Shared Game' } }] }),
			getPurchasedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getRecentlyPlayedGames: async () => ({ complete: true, pagesFetched: 1, games: [] }),
			getUserTitles: async () => ({ complete: true, pagesFetched: 1, titles: [] }),
			getTitleTrophies: async () => { throw new Error('must not fetch trophies'); },
			getUserTrophiesEarnedForTitle: async () => { throw new Error('must not fetch earned trophies'); },
		};
		const previousAchievements = { earned: 1, total: 1, progress: 100, achievements: [{ id: 'old', unlocked: true, hidden: false }] };
		const previous: ProviderGame = {
			provider: 'playstation', providerGameId: '12345', title: 'Shared Game', developers: [], publishers: [], genres: [], platforms: ['ps4'], playtimeMinutes: 15,
			achievements: previousAchievements, freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
			identity: { provider: 'playstation', conceptId: '12345', titleIds: ['CUSA00001_00'], npCommunicationIds: [] },
		};
		const secretStore: SecretStore = { get: () => null, set: () => undefined, delete: () => undefined };
		const snapshot = await createPlayStationAdapter({ secretStore, api }).fetchLibrary({ now: '2026-09-12T12:00:00.000Z', previousGames: [previous] });

		expect(snapshot.games[0]?.achievements).toEqual(previousAchievements);
		expect(snapshot.games[0]?.freshness.achievements).toBe(false);
		expect(snapshot.achievementProvenance).toBeUndefined();
	});
});
