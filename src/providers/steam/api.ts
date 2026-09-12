import type { HttpClient } from '../../network/http';
import {
	steamOwnedGamesSchema,
	steamAppDetailsSchema,
	steamPlayerAchievementsSchema,
	steamPlayerSummariesSchema,
	steamResolveVanitySchema,
} from './schemas';
import type {
	SteamApi,
	SteamAppDetails,
	SteamApiOptions,
	SteamOwnedGamesResponse,
	SteamPlayerStatsResponse,
	SteamPlayerSummary,
	SteamResolveVanityResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.steampowered.com';

function endpoint(baseUrl: string, path: string, params: Record<string, string>): string {
	const url = new URL(`${baseUrl.replace(/\/$/, '')}/${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url.toString();
}

export function createSteamApi(options: SteamApiOptions): SteamApi {
	const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
	const storeBaseUrl = options.storeBaseUrl ?? 'https://store.steampowered.com';
	const key = options.apiKey;
	const request = <T>(http: HttpClient, path: string, params: Record<string, string>, schema: Parameters<HttpClient['request']>[1]): Promise<T> =>
		http.request({ url: endpoint(baseUrl, path, { key, format: 'json', ...params }) }, schema) as Promise<T>;

	return {
		async resolveVanityUrl(vanityUrl: string): Promise<SteamResolveVanityResponse> {
			const payload = await request<{ response: SteamResolveVanityResponse }>(options.http, 'ISteamUser/ResolveVanityURL/v0001/', { vanityurl: vanityUrl }, steamResolveVanitySchema);
			return payload.response;
		},
		async getPlayerSummaries(steamId64: string): Promise<SteamPlayerSummary[]> {
			const payload = await request<{ response: { players: SteamPlayerSummary[] } }>(options.http, 'ISteamUser/GetPlayerSummaries/v0002/', { steamids: steamId64 }, steamPlayerSummariesSchema);
			return payload.response.players;
		},
		async getOwnedGames(steamId64: string): Promise<SteamOwnedGamesResponse> {
			const payload = await request<{ response: SteamOwnedGamesResponse }>(options.http, 'IPlayerService/GetOwnedGames/v0001/', {
				steamid: steamId64,
				include_appinfo: '1',
				include_played_free_games: '1',
			}, steamOwnedGamesSchema);
			return payload.response;
		},
		async getPlayerAchievements(steamId64: string, appId: number): Promise<SteamPlayerStatsResponse> {
			const payload = await request<{ playerstats: SteamPlayerStatsResponse }>(options.http, 'ISteamUserStats/GetPlayerAchievements/v0001/', {
				steamid: steamId64,
				appid: String(appId),
				l: 'english',
			}, steamPlayerAchievementsSchema);
			return payload.playerstats;
		},
		async getAppDetails(appId: number): Promise<SteamAppDetails | undefined> {
			const url = endpoint(storeBaseUrl, 'api/appdetails', { appids: String(appId), l: 'english' });
			const payload = await options.http.request(url ? { url } : { url: storeBaseUrl }, steamAppDetailsSchema);
			const entry = payload[String(appId)];
			return entry?.success === true ? entry.data : undefined;
		},
	};
}
