import type { ProviderAchievement, ProviderAchievementSet } from '../../model/achievement';
import type { ProviderAchievementProvenance, ProviderGame } from '../../model/provider';
import type { SteamApi, SteamAchievement } from './types';

export interface SteamAchievementCacheEntry {
	fetchedAt: string;
	playtimeMinutes?: number;
	lastPlayed?: string;
	achievements?: ProviderAchievementSet;
}

export interface SteamAchievementRefreshOptions {
	now?: string;
	ttlMs?: number;
	force?: boolean;
	previousAchievements?: ProviderAchievementSet;
	fetch: () => Promise<{ achievements?: SteamAchievement[] }>;
}

export interface SteamAchievementRefreshResult {
	ok: boolean;
	freshness: boolean;
	achievements?: ProviderAchievementSet;
	provenance?: ProviderAchievementProvenance;
	error?: string;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldRefreshSteamAchievements(game: ProviderGame, cached: SteamAchievementCacheEntry | undefined, options: { now?: string; ttlMs?: number; force?: boolean } = {}): boolean {
	if (options.force || cached === undefined || cached.achievements === undefined) return true;
	if ((game.playtimeMinutes ?? 0) > (cached.playtimeMinutes ?? 0)) return true;
	if (game.lastPlayed !== cached.lastPlayed) return true;
	const now = Date.parse(options.now ?? new Date().toISOString());
	const fetchedAt = Date.parse(cached.fetchedAt);
	return !Number.isFinite(fetchedAt) || now - fetchedAt >= (options.ttlMs ?? DEFAULT_TTL_MS);
}

function normalizeAchievement(achievement: SteamAchievement): ProviderAchievement {
	const unlocked = achievement.achieved === 1;
	return {
		id: achievement.name ?? achievement.displayName ?? 'unknown-achievement',
		name: achievement.displayName ?? achievement.name,
		description: achievement.description,
		unlocked,
		unlockedAt: unlocked && achievement.unlocktime !== undefined && achievement.unlocktime > 0 ? new Date(achievement.unlocktime * 1000).toISOString() : undefined,
		hidden: achievement.hidden ?? false,
		iconUrl: unlocked ? achievement.icon : achievement.icongray ?? achievement.icon,
	};
}

export function normalizeSteamAchievements(achievements: readonly SteamAchievement[] = []): ProviderAchievementSet {
	const normalized = achievements.map(normalizeAchievement);
	const earned = normalized.filter((achievement) => achievement.unlocked).length;
	return { earned, total: normalized.length, progress: normalized.length === 0 ? 0 : Math.round((earned / normalized.length) * 100), achievements: normalized };
}

export async function refreshSteamAchievements(game: ProviderGame, cached: SteamAchievementCacheEntry | undefined, options: SteamAchievementRefreshOptions): Promise<SteamAchievementRefreshResult> {
	if (!shouldRefreshSteamAchievements(game, cached, options)) {
		return {
			ok: true,
			freshness: true,
			achievements: cached?.achievements,
			...(cached === undefined ? {} : { provenance: { source: 'cache' as const, fetchedAt: cached.fetchedAt } }),
		};
	}
	try {
		const result = await options.fetch();
		return {
			ok: true,
			freshness: true,
			achievements: normalizeSteamAchievements(result.achievements ?? []),
			provenance: { source: 'network', fetchedAt: options.now ?? new Date().toISOString() },
		};
	} catch (error) {
		return { ok: false, freshness: false, achievements: options.previousAchievements ?? cached?.achievements, error: error instanceof Error ? error.message : 'Steam achievements request failed.' };
	}
}

export async function fetchSteamAchievements(api: SteamApi, steamId64: string, game: ProviderGame, cached: SteamAchievementCacheEntry | undefined, options: Omit<SteamAchievementRefreshOptions, 'fetch'> = {}): Promise<SteamAchievementRefreshResult> {
	if (game.identity.provider !== 'steam') return { ok: false, freshness: false, error: 'Steam achievements require a Steam game identity.' };
	const appId = game.identity.appId;
	return refreshSteamAchievements(game, cached, { ...options, fetch: () => api.getPlayerAchievements(steamId64, appId) });
}
