import {
	getPurchasedGames,
	getRecentlyPlayedGames,
	getTitleTrophies,
	getUserPlayedGames,
	getUserTitles,
	getUserTrophiesEarnedForTitle,
} from 'psn-api';
import type { PlayStationAuthService, PlayStationApi } from './types';
import {
	playStationEarnedTrophiesSchema,
	playStationPlayedGamesSchema,
	playStationPurchasedGamesSchema,
	playStationRecentlyPlayedGamesSchema,
	playStationTrophyMetadataSchema,
	playStationTrophyTitlesSchema,
} from './schemas';

export const PLAYSTATION_MAX_PAGES = 100;

function pageComplete(collectedCount: number, totalItemCount: number | undefined, nextOffset: number | undefined, offset: number): boolean {
	if (totalItemCount !== undefined) return collectedCount >= totalItemCount;
	return nextOffset === undefined || nextOffset <= offset;
}

export function createPlayStationApi(auth: PlayStationAuthService, accountId = 'me'): PlayStationApi {
	const authorization = async (): Promise<{ accessToken: string }> => ({ accessToken: await auth.getAccessToken() });

	return {
		async getUserPlayedGames(options = {}) {
			const limit = options.limit ?? 800;
			let offset = options.offset ?? 0;
			const titles = [];
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = playStationPlayedGamesSchema.parse(await getUserPlayedGames(await authorization(), accountId, { limit, offset, categories: 'ps4_game,ps5_native_game' }));
				titles.push(...response.titles);
				totalItemCount = response.totalItemCount ?? totalItemCount;
				if (pageComplete(titles.length, totalItemCount, response.nextOffset, offset)) return { titles, totalItemCount, complete: true, pagesFetched: page + 1 };
				if (response.nextOffset === undefined || response.nextOffset <= offset) return { titles, totalItemCount, complete: false, pagesFetched: page + 1 };
				offset = response.nextOffset;
			}
			return { titles, totalItemCount, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getPurchasedGames() {
			const size = 800;
			const games = [];
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = await getPurchasedGames(await authorization(), { size, start: page * size, platform: ['ps4', 'ps5'], isActive: true });
				const currentGames = playStationPurchasedGamesSchema.parse({ games: response.data.purchasedTitlesRetrieve.games }).games;
				games.push(...currentGames);
				if (currentGames.length < size) return { games, complete: true, pagesFetched: page + 1 };
			}
			return { games, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getRecentlyPlayedGames() {
			const limit = 100;
			const response = await getRecentlyPlayedGames(await authorization(), { categories: ['ps4_game', 'ps5_native_game'], limit });
			const games = playStationRecentlyPlayedGamesSchema.parse({ games: response.data.gameLibraryTitlesRetrieve.games }).games;
			return { games, complete: games.length < limit, pagesFetched: 1 };
		},
		async getUserTitles() {
			const titles = [];
			let offset = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const raw = await getUserTitles(await authorization(), accountId, { limit: 800, offset });
				const response = playStationTrophyTitlesSchema.parse({ titles: raw.trophyTitles, totalItemCount: raw.totalItemCount, nextOffset: raw.nextOffset });
				titles.push(...response.titles);
				totalItemCount = response.totalItemCount ?? totalItemCount;
				if (pageComplete(titles.length, totalItemCount, response.nextOffset, offset)) return { titles, totalItemCount, complete: true, pagesFetched: page + 1 };
				if (response.nextOffset === undefined || response.nextOffset <= offset) return { titles, totalItemCount, complete: false, pagesFetched: page + 1 };
				offset = response.nextOffset;
			}
			return { titles, totalItemCount, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getTitleTrophies(npCommunicationId, options) {
			const trophies = [];
			let offset = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = await getTitleTrophies(await authorization(), npCommunicationId, 'all', { npServiceName: options.npServiceName, limit: 200, offset });
				const parsed = playStationTrophyMetadataSchema.parse({ npServiceName: options.npServiceName, totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
				trophies.push(...parsed.trophies);
				totalItemCount = parsed.totalItemCount ?? totalItemCount;
				if (pageComplete(trophies.length, totalItemCount, response.nextOffset, offset)) return { npServiceName: options.npServiceName, totalItemCount, trophies, complete: true, pagesFetched: page + 1 };
				if (response.nextOffset === undefined || response.nextOffset <= offset) return { npServiceName: options.npServiceName, totalItemCount, trophies, complete: false, pagesFetched: page + 1 };
				offset = response.nextOffset;
			}
			return { npServiceName: options.npServiceName, totalItemCount, trophies, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getUserTrophiesEarnedForTitle(npCommunicationId, options) {
			const trophies = [];
			let offset = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = await getUserTrophiesEarnedForTitle(await authorization(), accountId, npCommunicationId, 'all', { npServiceName: options.npServiceName, limit: 200, offset });
				const parsed = playStationEarnedTrophiesSchema.parse({ totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
				trophies.push(...parsed.trophies);
				totalItemCount = parsed.totalItemCount ?? totalItemCount;
				if (pageComplete(trophies.length, totalItemCount, response.nextOffset, offset)) return { totalItemCount, trophies, complete: true, pagesFetched: page + 1 };
				if (response.nextOffset === undefined || response.nextOffset <= offset) return { totalItemCount, trophies, complete: false, pagesFetched: page + 1 };
				offset = response.nextOffset;
			}
			return { totalItemCount, trophies, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
	};
}
