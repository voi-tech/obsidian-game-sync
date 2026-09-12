import { describe, expect, it, vi } from 'vitest';
import malformed from './fixtures/playstation/malformed.json';

const {
	getUserPlayedGames,
	getPurchasedGames,
	getRecentlyPlayedGames,
	getUserTitles,
	getTitleTrophies,
	getUserTrophiesEarnedForTitle,
} = vi.hoisted(() => ({
	getUserPlayedGames: vi.fn(),
	getPurchasedGames: vi.fn(),
	getRecentlyPlayedGames: vi.fn(),
	getUserTitles: vi.fn(),
	getTitleTrophies: vi.fn(),
	getUserTrophiesEarnedForTitle: vi.fn(),
}));

vi.mock('psn-api', () => ({
	getPurchasedGames,
	getUserTitles,
	getTitleTrophies,
	getUserTrophiesEarnedForTitle,
	getUserPlayedGames,
	getRecentlyPlayedGames,
}));

import { createPlayStationApi } from '../src/providers/playstation/api';
import { playStationPlayedGamesSchema } from '../src/providers/playstation/schemas';

const auth = { getAccessToken: async () => 'access-token' } as Parameters<typeof createPlayStationApi>[0];

describe('PlayStation paginated API boundary', () => {
	it('rejects malformed played-games payloads at the schema boundary', () => {
		expect(() => playStationPlayedGamesSchema.parse(malformed)).toThrow();
	});

	it('fetches purchased games until a short page and reports complete', async () => {
		const fullPage = Array.from({ length: 800 }, (_, index) => ({
			__typename: 'GameLibraryTitle',
			conceptId: String(index),
			entitlementId: `ent-${index}`,
			image: { __typename: 'Media', url: 'https://example.invalid/game.jpg' },
			isActive: true,
			isDownloadable: true,
			isPreOrder: false,
			membership: 'NONE',
			name: `Game ${index}`,
			platform: 'PS4',
			productId: `prod-${index}`,
			titleId: `CUSA${String(index).padStart(5, '0')}_00`,
		}));
		getPurchasedGames.mockResolvedValueOnce({ data: { purchasedTitlesRetrieve: { games: fullPage } } }).mockResolvedValueOnce({ data: { purchasedTitlesRetrieve: { games: [fullPage[0]] } } });

		const result = await createPlayStationApi(auth).getPurchasedGames();

		expect(result.complete).toBe(true);
		expect(result.pagesFetched).toBe(2);
		expect(result.games).toHaveLength(801);
		expect(getPurchasedGames).toHaveBeenNthCalledWith(2, { accessToken: 'access-token' }, expect.objectContaining({ start: 800, size: 800 }));
	});

	it('propagates incomplete offset pagination for titles and both trophy endpoints', async () => {
		getUserTitles.mockResolvedValueOnce({ trophyTitles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR1', trophyTitleName: 'Game' }], nextOffset: 1 });
		getUserTitles.mockResolvedValueOnce({ trophyTitles: [{ npServiceName: 'trophy2', npCommunicationId: 'NPWR2', trophyTitleName: 'Game 2' }], nextOffset: 1 });
		getTitleTrophies.mockResolvedValueOnce({ trophies: [{ trophyId: 1, trophyType: 'bronze' }], nextOffset: 1 }).mockResolvedValueOnce({ trophies: [{ trophyId: 2, trophyType: 'silver' }], nextOffset: 1 });
		getUserTrophiesEarnedForTitle.mockResolvedValueOnce({ trophies: [{ trophyId: 1, earned: true }], nextOffset: 1 }).mockResolvedValueOnce({ trophies: [{ trophyId: 2, earned: false }], nextOffset: 1 });

		const api = createPlayStationApi(auth);
		const titles = await api.getUserTitles();
		const metadata = await api.getTitleTrophies('NPWR1', { npServiceName: 'trophy' });
		const earned = await api.getUserTrophiesEarnedForTitle('NPWR1', { npServiceName: 'trophy' });

		expect(titles.complete).toBe(true);
		expect(titles.titles).toHaveLength(2);
		expect(metadata.complete).toBe(true);
		expect(metadata.trophies).toHaveLength(2);
		expect(earned.complete).toBe(true);
		expect(earned.trophies).toHaveLength(2);
	});

	it('does not claim completeness when total count exceeds a stopped offset', async () => {
		getUserPlayedGames.mockResolvedValue({ titles: [{ titleId: 'CUSA00001_00', name: 'Game' }], totalItemCount: 2, nextOffset: 0 });
		getUserTitles.mockResolvedValue({ trophyTitles: [{ npServiceName: 'trophy', npCommunicationId: 'NPWR1', trophyTitleName: 'Game' }], totalItemCount: 2, nextOffset: 0 });
		getTitleTrophies.mockResolvedValue({ trophies: [{ trophyId: 1, trophyType: 'bronze' }], totalItemCount: 2, nextOffset: 0 });
		getUserTrophiesEarnedForTitle.mockResolvedValue({ trophies: [{ trophyId: 1, earned: true }], totalItemCount: 2, nextOffset: 0 });

		const api = createPlayStationApi(auth);
		expect((await api.getUserPlayedGames()).complete).toBe(false);
		expect((await api.getUserTitles()).complete).toBe(false);
		expect((await api.getTitleTrophies('NPWR1', { npServiceName: 'trophy' })).complete).toBe(false);
		expect((await api.getUserTrophiesEarnedForTitle('NPWR1', { npServiceName: 'trophy' })).complete).toBe(false);
	});

	it('treats a recently-played page at the requested limit as partial', async () => {
		getRecentlyPlayedGames.mockResolvedValue({ data: { gameLibraryTitlesRetrieve: { games: Array.from({ length: 100 }, (_, index) => ({ name: `Game ${index}` })) } } });

		const result = await createPlayStationApi(auth).getRecentlyPlayedGames();

		expect(result.complete).toBe(false);
	});
});
