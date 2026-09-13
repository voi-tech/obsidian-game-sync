import { ProviderAuthError, ProviderHttpError } from '../../network/errors';
import type { ProviderAccount, ProviderAchievementProvenance, ProviderGame, ProviderSnapshot } from '../../model/provider';
import type { GameProviderAdapter, ProviderConnectionStatus, ProviderFetchOptions } from '../provider';
import { fetchSteamAchievements, type SteamAchievementCacheEntry } from './achievements';
import { createSteamAuth } from './auth';
import { createSteamApi } from './api';
import { normalizeSteamGames } from './normalize';
import type { SteamApi, SteamAuthOptions, SteamAppDetails, SteamAppDetailsResult } from './types';

function isSuccessfulAppDetails(value: SteamAppDetailsResult | undefined): value is SteamAppDetails {
	return value !== undefined && !('success' in value && value.success === false);
}

function failedSnapshot(error: unknown, games: ProviderGame[] = [], now = new Date().toISOString()): ProviderSnapshot {
	const details = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown } : undefined;
	const code = typeof details?.code === 'string' ? details.code : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'steam-provider-failure';
	const message = typeof details?.message === 'string' ? details.message : error instanceof Error ? error.message : 'Steam provider request failed.';
	return {
		provider: 'steam',
		status: games.length > 0 ? 'partial' : 'failed',
		games,
		fetchedAt: now,
		pagination: { complete: false, pagesFetched: 0 },
		paginationComplete: false,
		error: { code, message },
	};
}

export interface SteamAdapterOptions extends SteamAuthOptions {
	api?: SteamApi;
}

export function createSteamAdapter(options: SteamAdapterOptions): GameProviderAdapter {
	const auth = createSteamAuth(options, options.api);
	const apiFor = (): SteamApi => options.api ?? createSteamApi({ http: options.http, apiKey: options.secretStore.get(options.apiKeySecretName ?? 'steam-api-key') ?? '', baseUrl: options.baseUrl });
	let account: ProviderAccount | undefined;

	return {
		id: 'steam',
		async getConnectionStatus(): Promise<ProviderConnectionStatus> {
			return auth.getConnectionStatus();
		},
		async testConnection(): Promise<ProviderAccount> {
			account = await auth.testConnection();
			return account;
		},
		async fetchLibrary(options: ProviderFetchOptions): Promise<ProviderSnapshot> {
			const now = options.now ?? new Date().toISOString();
			try {
				const api = apiFor();
				const connected = account ?? await auth.testConnection();
				account = connected;
				const steamId64 = connected.accountId;
				const response = await api.getOwnedGames(steamId64);
				if (response.games === undefined && response.game_count === undefined) return failedSnapshot({ code: 'steam-private-game-details', message: 'Steam Game Details are private. Set the Steam profile and Game Details visibility to Public.' }, [], now);
				const details = new Map<number, SteamAppDetails>();
				let detailFailure = api.getAppDetails === undefined;
				if (api.getAppDetails !== undefined) {
					for (const ownedGame of response.games ?? []) {
						try {
							const appDetails = await api.getAppDetails(ownedGame.appid);
							if (isSuccessfulAppDetails(appDetails)) details.set(ownedGame.appid, appDetails);
							else detailFailure = true;
						} catch {
							detailFailure = true;
						}
					}
				}
				const games = normalizeSteamGames(response.games ?? [], details);
				if (detailFailure) for (const game of games) if (!details.has(game.identity.provider === 'steam' ? game.identity.appId : -1)) game.freshness.metadata = false;
				let achievementFailure = false;
				const achievementProvenance: Record<string, ProviderAchievementProvenance> = {};
				const previous = new Map((options.previousGames ?? []).map((game) => [game.providerGameId, game]));
				const cache = options.achievementCache ?? {};
				for (const game of games) {
					const ownedGame = response.games?.find((candidate) => String(candidate.appid) === game.providerGameId);
					const appDetails = game.identity.provider === 'steam' ? details.get(game.identity.appId) : undefined;
					if (ownedGame?.has_community_visible_stats === false || appDetails?.supportsAchievements === false) {
						game.freshness.achievements = false;
						continue;
					}
					if (game.achievements !== undefined) continue;
					const cached = cache[game.providerGameId] as SteamAchievementCacheEntry | undefined;
					const result = await fetchSteamAchievements(api, steamId64, game, cached, { now, ttlMs: options.achievementCacheTtlMs, force: options.force });
					if (result.achievements !== undefined) game.achievements = result.achievements;
					game.freshness.achievements = result.freshness;
					if (result.provenance !== undefined && result.freshness) achievementProvenance[game.providerGameId] = result.provenance;
					if (!result.ok) {
						achievementFailure = true;
						const old = previous.get(game.providerGameId);
						if (old?.achievements !== undefined) game.achievements = old.achievements;
					}
				}
				return {
					provider: 'steam',
					status: achievementFailure || detailFailure ? 'partial' : 'complete',
					games,
					fetchedAt: now,
					pagination: { complete: true, pagesFetched: 1 },
					paginationComplete: true,
					...(Object.keys(achievementProvenance).length === 0 ? {} : { achievementProvenance }),
					error: achievementFailure || detailFailure ? { code: achievementFailure ? 'steam-achievements-partial' : 'steam-app-details-partial', message: 'Some Steam data could not be refreshed; unknown fields were retained without guessing.' } : undefined,
				};
			} catch (error) {
				if (error instanceof ProviderAuthError || error instanceof ProviderHttpError) return failedSnapshot(error, [], now);
				return failedSnapshot(error, [], now);
			}
		},
		async disconnect(): Promise<void> {
			await auth.disconnect();
			account = undefined;
		},
	};
}
