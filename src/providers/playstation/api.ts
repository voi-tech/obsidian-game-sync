import { playStationClient } from './client';
import type { PlayStationClient } from './client';
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

function validated<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new Error('Invalid PlayStation response');
	return parsed.data;
}

function pageComplete(collectedCount: number, totalItemCount: number | undefined, nextOffset: number | undefined, offset: number): boolean {
	if (totalItemCount !== undefined) return collectedCount >= totalItemCount;
	return nextOffset === undefined || nextOffset <= offset;
}

export function createPlayStationApi(auth: PlayStationAuthService, accountId = 'me', client: PlayStationClient = playStationClient): PlayStationApi {
	const authorization = async (): Promise<{ accessToken: string }> => ({ accessToken: await auth.getAccessToken() });

	return {
		async getUserPlayedGames(options = {}) {
			const limit = options.limit ?? 800;
			let offset = options.offset ?? 0;
			const titles = [];
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = validated(playStationPlayedGamesSchema, await client.getUserPlayedGames(await authorization(), accountId, { limit, offset, categories: 'ps4_game,ps5_native_game' }));
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
				const response = await client.getPurchasedGames(await authorization(), { size, start: page * size, platform: ['ps4', 'ps5'], isActive: true });
				const currentGames = validated(playStationPurchasedGamesSchema, { games: response.data.purchasedTitlesRetrieve.games }).games;
				games.push(...currentGames);
				if (currentGames.length < size) return { games, complete: true, pagesFetched: page + 1 };
			}
			return { games, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getRecentlyPlayedGames() {
			const limit = 100;
			const response = await client.getRecentlyPlayedGames(await authorization(), { categories: ['ps4_game', 'ps5_native_game'], limit });
			const games = validated(playStationRecentlyPlayedGamesSchema, { games: response.data.gameLibraryTitlesRetrieve.games }).games;
			return { games, complete: games.length < limit, pagesFetched: 1 };
		},
		async getUserTitles() {
			const titles = [];
			let offset = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const raw = await client.getUserTitles(await authorization(), accountId, { limit: 800, offset });
				const response = validated(playStationTrophyTitlesSchema, { titles: raw.trophyTitles, totalItemCount: raw.totalItemCount, nextOffset: raw.nextOffset });
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
				const response = await client.getTitleTrophies(await authorization(), npCommunicationId, 'all', { npServiceName: options.npServiceName, limit: 200, offset });
				const parsed = validated(playStationTrophyMetadataSchema, { npServiceName: options.npServiceName, totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
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
				const response = await client.getUserTrophiesEarnedForTitle(await authorization(), accountId, npCommunicationId, 'all', { npServiceName: options.npServiceName, limit: 200, offset });
				const parsed = validated(playStationEarnedTrophiesSchema, { totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
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
