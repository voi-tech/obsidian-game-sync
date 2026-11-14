import { playStationClient } from './client';
import type { PlayStationClient } from './client';
import type { PlayStationAuthService, PlayStationApi } from './types';
import { describeIssues, issuePaths, validateItems, withoutNulls, type SafeParseSchema } from '../../network/validation';
import {
	playStationEarnedTrophiesSchema,
	playStationPageSchema,
	playStationPlayedGameSchema,
	playStationPurchasedGameSchema,
	playStationRecentlyPlayedGameSchema,
	playStationTrophyMetadataSchema,
	playStationTrophyTitleSchema,
} from './schemas';

export const PLAYSTATION_MAX_PAGES = 100;
/** Sony's gamelist endpoint rejects pages above 500 titles with HTTP 400; 200 matches other PSN clients. */
export const PLAYSTATION_PLAYED_GAMES_PAGE_SIZE = 200;

/** Error messages carry only schema paths (never response values), so they are safe to show in diagnostics. */
function invalidResponse(endpoint: string, paths: readonly string[]): Error {
	return Object.assign(new Error(`Invalid PlayStation response (${endpoint})${describeIssues(paths)}`), { code: 'playstation-invalid-response' });
}

function validated<T>(endpoint: string, schema: SafeParseSchema<T>, value: unknown): T {
	const parsed = schema.safeParse(withoutNulls(value));
	if (!parsed.success) throw invalidResponse(endpoint, issuePaths(parsed.error));
	return parsed.data;
}

/**
 * Validates a list item by item: one malformed title must not discard the whole library. The caller gets the
 * number of dropped items: where absence from a list means something (purchases), such a list is not complete.
 */
function validatedItems<T>(endpoint: string, schema: SafeParseSchema<T>, value: unknown): { items: T[]; dropped: number } {
	if (!Array.isArray(value)) throw invalidResponse(endpoint, ['(list)']);
	const { items, dropped, paths } = validateItems(schema, value);
	// Losing every item means the format changed, not that a few titles are odd: fail loudly.
	if (value.length > 0 && items.length === 0) throw invalidResponse(endpoint, paths);
	return { items, dropped };
}

function pageComplete(collectedCount: number, totalItemCount: number | undefined, nextOffset: number | undefined, offset: number): boolean {
	if (totalItemCount !== undefined) return collectedCount >= totalItemCount;
	return nextOffset === undefined || nextOffset <= offset;
}

export function createPlayStationApi(auth: PlayStationAuthService, accountId = 'me', client: PlayStationClient = playStationClient): PlayStationApi {
	const authorization = async (): Promise<{ accessToken: string }> => ({ accessToken: await auth.getAccessToken() });

	return {
		async getUserPlayedGames(options = {}) {
			const limit = Math.min(options.limit ?? PLAYSTATION_PLAYED_GAMES_PAGE_SIZE, PLAYSTATION_PLAYED_GAMES_PAGE_SIZE);
			let offset = options.offset ?? 0;
			const titles = [];
			let received = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const raw = await client.getUserPlayedGames(await authorization(), accountId, { limit, offset, categories: 'ps4_game,ps5_native_game' });
				const envelope = validated('played games', playStationPageSchema, raw);
				const rawTitles: unknown = (raw as { titles?: unknown }).titles;
				titles.push(...validatedItems('played games', playStationPlayedGameSchema, rawTitles).items);
				received += (rawTitles as unknown[]).length;
				totalItemCount = envelope.totalItemCount ?? totalItemCount;
				if (pageComplete(received, totalItemCount, envelope.nextOffset, offset)) return { titles, totalItemCount, complete: true, pagesFetched: page + 1 };
				if (envelope.nextOffset === undefined || envelope.nextOffset <= offset) return { titles, totalItemCount, complete: false, pagesFetched: page + 1 };
				offset = envelope.nextOffset;
			}
			return { titles, totalItemCount, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getPurchasedGames() {
			const size = 800;
			const games = [];
			let dropped = 0;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = await client.getPurchasedGames(await authorization(), { size, start: page * size, platform: ['ps4', 'ps5'], isActive: true });
				const rawGames: unknown = response.data.purchasedTitlesRetrieve.games;
				const valid = validatedItems('purchased games', playStationPurchasedGameSchema, rawGames);
				games.push(...valid.items);
				dropped += valid.dropped;
				// A purchase dropped by validation would read as "not owned": the list only counts as complete without drops.
				if ((rawGames as unknown[]).length < size) return { games, complete: dropped === 0, pagesFetched: page + 1 };
			}
			return { games, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getRecentlyPlayedGames() {
			const limit = 100;
			const response = await client.getRecentlyPlayedGames(await authorization(), { categories: ['ps4_game', 'ps5_native_game'], limit });
			const rawGames: unknown = response.data.gameLibraryTitlesRetrieve.games;
			const games = validatedItems('recently played games', playStationRecentlyPlayedGameSchema, rawGames).items;
			return { games, complete: (rawGames as unknown[]).length < limit, pagesFetched: 1 };
		},
		async getUserTitles() {
			const titles = [];
			let offset = 0;
			let received = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const raw = await client.getUserTitles(await authorization(), accountId, { limit: 800, offset });
				const envelope = validated('trophy titles', playStationPageSchema, { totalItemCount: raw.totalItemCount, nextOffset: raw.nextOffset });
				const rawTitles: unknown = raw.trophyTitles;
				titles.push(...validatedItems('trophy titles', playStationTrophyTitleSchema, rawTitles).items);
				received += (rawTitles as unknown[]).length;
				totalItemCount = envelope.totalItemCount ?? totalItemCount;
				if (pageComplete(received, totalItemCount, envelope.nextOffset, offset)) return { titles, totalItemCount, complete: true, pagesFetched: page + 1 };
				if (envelope.nextOffset === undefined || envelope.nextOffset <= offset) return { titles, totalItemCount, complete: false, pagesFetched: page + 1 };
				offset = envelope.nextOffset;
			}
			return { titles, totalItemCount, complete: false, pagesFetched: PLAYSTATION_MAX_PAGES };
		},
		async getTitleTrophies(npCommunicationId, options) {
			const trophies = [];
			let offset = 0;
			let totalItemCount: number | undefined;
			for (let page = 0; page < PLAYSTATION_MAX_PAGES; page += 1) {
				const response = await client.getTitleTrophies(await authorization(), npCommunicationId, 'all', { npServiceName: options.npServiceName, limit: 200, offset });
				const parsed = validated('trophy list', playStationTrophyMetadataSchema, { npServiceName: options.npServiceName, totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
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
				const parsed = validated('earned trophies', playStationEarnedTrophiesSchema, { totalItemCount: response.totalItemCount, trophies: response.trophies, nextOffset: response.nextOffset });
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
