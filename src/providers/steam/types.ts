import type { ProviderAccount } from '../../model/provider';

export interface SteamApiResponse<T> {
	response: T;
}

export interface SteamPlayerSummary {
	steamid: string;
	personaname: string;
	profileurl?: string;
}

export interface SteamResolveVanityResponse {
	success: number;
	steamid?: string;
	message?: string;
}

export interface SteamOwnedGame {
	appid: number;
	name?: string;
	playtime_forever?: number;
	playtime_2weeks?: number;
	rtime_last_played?: number;
	last_played?: string;
	has_community_visible_stats?: boolean;
	type?: string;
	app_type?: string;
	category?: string | string[];
	is_free?: boolean;
	platforms?: Record<string, boolean> | string[];
	genres?: Array<{ id?: string; description?: string } | string>;
	developers?: string[];
	publishers?: string[];
	description?: string;
	short_description?: string;
	header_image?: string;
	cover?: string;
	release_date?: { date?: string } | string;
	[extra: string]: unknown;
}

export interface SteamOwnedGamesResponse {
	game_count?: number;
	games?: SteamOwnedGame[];
}

export interface SteamAppDetails {
	type?: string;
	is_free?: boolean;
	name?: string;
	short_description?: string;
	detailed_description?: string;
	header_image?: string;
	platforms?: Record<string, boolean>;
	genres?: Array<{ id?: string; description?: string } | string>;
	developers?: string[];
	publishers?: string[];
	categories?: Array<{ id?: number; description?: string } | string>;
	supportsAchievements?: boolean;
}

export interface SteamAppDetailsFailure {
	success: false;
	message?: string;
}

export type SteamAppDetailsResult = SteamAppDetails | SteamAppDetailsFailure;

export interface SteamAchievement {
	name?: string;
	displayName?: string;
	description?: string;
	achieved?: number;
	unlocktime?: number;
	icon?: string;
	icongray?: string;
	hidden?: boolean;
}

export interface SteamPlayerStatsResponse {
	steamID?: string;
	gameName?: string;
	achievements?: SteamAchievement[];
}

export interface SteamAuthOptions {
	http: import('../../network/http').HttpClient;
	secretStore: import('../../auth/secrets').SecretStore;
	account: string;
	apiKeySecretName?: string;
	baseUrl?: string;
}

export interface SteamApiOptions {
	http: import('../../network/http').HttpClient;
	apiKey: string;
	baseUrl?: string;
	storeBaseUrl?: string;
}

export interface SteamApi {
	resolveVanityUrl(vanityUrl: string): Promise<SteamResolveVanityResponse>;
	getPlayerSummaries(steamId64: string): Promise<SteamPlayerSummary[]>;
	getOwnedGames(steamId64: string): Promise<SteamOwnedGamesResponse>;
	getPlayerAchievements(steamId64: string, appId: number): Promise<SteamPlayerStatsResponse>;
	getAppDetails?: (appId: number) => Promise<SteamAppDetailsResult | undefined>;
}

export interface SteamAuthService {
	resolveSteamId64(): Promise<string>;
	testConnection(): Promise<ProviderAccount>;
	getConnectionStatus(): Promise<import('../provider').ProviderConnectionStatus>;
	disconnect(): Promise<void>;
}
