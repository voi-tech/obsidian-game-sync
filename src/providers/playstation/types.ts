import type { SecretStore } from '../../auth/secrets';
import type { ProviderAccount } from '../../model/provider';
import type { ProviderConnectionStatus } from '../provider';

export interface PlayStationAuthTokens {
	accessToken: string;
	refreshToken: string;
	idToken?: string;
	expiresIn: number;
	refreshTokenExpiresIn?: number;
	accountId?: string;
	displayName?: string;
}

export interface PlayStationAuthOptions {
	secretStore: SecretStore;
	accessTokenLifetimeSkewMs?: number;
}

export interface PlayStationAuthService {
	connectWithNpsso(npsso: string): Promise<ProviderAccount>;
	getAccessToken(): Promise<string>;
	refresh(): Promise<void>;
	disconnect(): Promise<void>;
	getConnectionStatus(): Promise<ProviderConnectionStatus>;
	getAccount(): ProviderAccount | undefined;
}

export interface PlayStationPlayedGame {
	titleId: string;
	name: string;
	localizedName?: string;
	imageUrl?: string;
	localizedImageUrl?: string;
	category?: string;
	service?: string;
	playCount?: number;
	concept?: { id?: number | string; titleIds?: string[]; name?: string; media?: { images?: Array<{ url?: string }> } };
	firstPlayedDateTime?: string;
	lastPlayedDateTime?: string;
	playDuration?: string;
}

export interface PlayStationPurchasedGame {
	conceptId?: string | null;
	name: string;
	platform?: string;
	titleId?: string;
	image?: { url?: string };
	membership?: string;
}

export interface PlayStationRecentlyPlayedGame {
	name: string;
	platform?: string;
	lastPlayedDateTime?: string;
	titleId?: string;
	conceptId?: string;
	image?: { url?: string };
}

export interface PlayStationTrophyMetadata {
	npServiceName?: 'trophy' | 'trophy2';
	totalItemCount?: number;
	trophies: Array<{
		trophyId: number;
		trophyHidden?: boolean;
		trophyType?: 'bronze' | 'silver' | 'gold' | 'platinum';
		trophyName?: string;
		trophyDetail?: string;
		trophyIconUrl?: string;
	}>;
	complete: boolean;
	pagesFetched: number;
}

export interface PlayStationTrophyTitle {
	npServiceName?: 'trophy' | 'trophy2';
	npCommunicationId: string;
	trophyTitleName: string;
	trophyTitlePlatform?: string;
	hiddenFlag?: boolean;
}

export interface PlayStationEarnedTrophies {
	totalItemCount?: number;
	trophies: Array<{
		trophyId: number;
		trophyHidden?: boolean;
		earned?: boolean;
		earnedDateTime?: string;
		trophyType?: 'bronze' | 'silver' | 'gold' | 'platinum';
		trophyEarnedRate?: string;
	}>;
	complete: boolean;
	pagesFetched: number;
}

export interface PlayStationApi {
	getUserPlayedGames(options?: { offset?: number; limit?: number }): Promise<{ titles: PlayStationPlayedGame[]; totalItemCount?: number; complete: boolean; pagesFetched: number }>;
	getPurchasedGames(): Promise<{ games: PlayStationPurchasedGame[]; complete: boolean; pagesFetched: number }>;
	getRecentlyPlayedGames(): Promise<{ games: PlayStationRecentlyPlayedGame[]; complete: boolean; pagesFetched: number }>;
	getUserTitles: () => Promise<{ titles: PlayStationTrophyTitle[]; totalItemCount?: number; complete: boolean; pagesFetched: number }>;
	getTitleTrophies(npCommunicationId: string, options: { npServiceName: 'trophy' | 'trophy2' }): Promise<PlayStationTrophyMetadata>;
	getUserTrophiesEarnedForTitle(npCommunicationId: string, options: { npServiceName: 'trophy' | 'trophy2' }): Promise<PlayStationEarnedTrophies>;
}

export interface PlayStationAdapterOptions extends PlayStationAuthOptions {
	api?: PlayStationApi;
}
