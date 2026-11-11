import type { NormalizedGame } from './game';
import { toIsoDate } from './iso-date';

export type ManagedPropertyKey =
	| 'gameSyncId' | 'type' | 'title' | 'released' | 'developers' | 'publishers' | 'genres' | 'cover' | 'platforms' | 'providers'
	| 'owned' | 'acquisitionType' | 'playtime' | 'lastPlayed' | 'steamId' | 'steamOwned' | 'steamPlaytime' | 'steamLastPlayed'
	| 'steamAchievementsEarned' | 'steamAchievementsTotal' | 'steamAchievementsProgress' | 'playstationId' | 'playstationOwned'
	| 'playstationPlaytime' | 'playstationLastPlayed' | 'psnTrophiesEarned' | 'psnTrophiesTotal' | 'psnTrophiesProgress'
	| 'psnBronze' | 'psnSilver' | 'psnGold' | 'psnPlatinum' | 'updated' | 'igdbId' | 'gametrackId'
	| 'purchaseDate' | 'purchasePrice' | 'purchaseCurrency';

export type PropertyMapping = Partial<Record<ManagedPropertyKey, string | null | false>>;
export type ResolvedPropertyMapping = Record<ManagedPropertyKey, string | undefined>;
export interface ManagedPropertyBuildOptions {
	updatedAt?: string;
	omitAchievementProperties?: boolean;
}

export const DEFAULT_PROPERTY_MAPPING: Record<ManagedPropertyKey, string> = {
	gameSyncId: 'game-sync-id', type: 'type', title: 'title', released: 'released', developers: 'developers', publishers: 'publishers',
	genres: 'genres', cover: 'cover', platforms: 'platforms', providers: 'providers', owned: 'owned', acquisitionType: 'acquisition-type',
	playtime: 'playtime', lastPlayed: 'last-played', steamId: 'steam-id', steamOwned: 'steam-owned', steamPlaytime: 'steam-playtime',
	steamLastPlayed: 'steam-last-played', steamAchievementsEarned: 'steam-achievements-earned', steamAchievementsTotal: 'steam-achievements-total',
	steamAchievementsProgress: 'steam-achievements-progress', playstationId: 'playstation-id', playstationOwned: 'playstation-owned',
	playstationPlaytime: 'playstation-playtime', playstationLastPlayed: 'playstation-last-played', psnTrophiesEarned: 'psn-trophies-earned',
	psnTrophiesTotal: 'psn-trophies-total', psnTrophiesProgress: 'psn-trophies-progress', psnBronze: 'psn-bronze', psnSilver: 'psn-silver',
	psnGold: 'psn-gold', psnPlatinum: 'psn-platinum', updated: 'game-sync-updated', igdbId: 'igdb-id', gametrackId: 'gametrack-id',
	// Written only by the purchase import, never by sync (buildManagedProperties leaves them out).
	purchaseDate: 'purchase-date', purchasePrice: 'purchase-price', purchaseCurrency: 'purchase-currency',
};

function normalizeDestination(destination: string): string {
	return destination.trim().toLocaleLowerCase();
}

/**
 * Keys added after mappings were already saved. Their default destination yields to a property the user has
 * already mapped (e.g. `title: purchase-price`), so an older valid mapping never becomes invalid on upgrade.
 */
const LATER_DEFAULT_KEYS: ReadonlySet<ManagedPropertyKey> = new Set(['purchaseDate', 'purchasePrice', 'purchaseCurrency']);

function resolveWithoutValidation(mapping: PropertyMapping): ResolvedPropertyMapping {
	const resolved = {} as ResolvedPropertyMapping;
	for (const key of Object.keys(DEFAULT_PROPERTY_MAPPING) as ManagedPropertyKey[]) {
		const destination = mapping[key];
		resolved[key] = destination === null || destination === false ? undefined : destination === undefined ? DEFAULT_PROPERTY_MAPPING[key] : destination.trim();
	}
	const taken = new Set((Object.entries(resolved) as [ManagedPropertyKey, string | undefined][])
		.filter(([key, destination]) => destination !== undefined && !(LATER_DEFAULT_KEYS.has(key) && mapping[key] === undefined))
		.map(([, destination]) => normalizeDestination(destination!)));
	for (const key of LATER_DEFAULT_KEYS) {
		if (mapping[key] === undefined && taken.has(normalizeDestination(DEFAULT_PROPERTY_MAPPING[key]))) resolved[key] = undefined;
	}
	return resolved;
}

function validateResolvedPropertyMapping(resolved: ResolvedPropertyMapping): void {
	const destinations = new Map<string, ManagedPropertyKey>();
	for (const [key, destination] of Object.entries(resolved) as [ManagedPropertyKey, string | undefined][]) {
		if (destination === undefined) continue;
		if (destination.length === 0) throw new Error(`Invalid property mapping for ${key}.`);
		const normalized = normalizeDestination(destination);
		const previous = destinations.get(normalized);
		if (previous !== undefined) throw new Error(`Duplicate property mapping destination ${destination} for ${previous} and ${key}.`);
		destinations.set(normalized, key);
	}
}

export function validatePropertyMapping(mapping: PropertyMapping): void {
	validateResolvedPropertyMapping(resolveWithoutValidation(mapping));
}

export function resolvePropertyMapping(mapping: PropertyMapping = {}): ResolvedPropertyMapping {
	const resolved = resolveWithoutValidation(mapping);
	validateResolvedPropertyMapping(resolved);
	return resolved;
}

function setIfPresent(result: Record<string, unknown>, destination: string | undefined, value: unknown): void {
	if (destination !== undefined && value !== undefined && value !== null) result[destination] = value;
}

function isAchievementFresh(game: NormalizedGame): boolean {
	return Object.values(game.providers).every((provider) => provider?.freshness.achievements === true);
}

function buildOptions(value: string | ManagedPropertyBuildOptions | undefined): ManagedPropertyBuildOptions {
	return typeof value === 'string' ? { updatedAt: value } : value ?? {};
}

export function buildManagedProperties(
	game: NormalizedGame,
	mapping: PropertyMapping = {},
	updatedAtOrOptions?: string | ManagedPropertyBuildOptions,
): Record<string, unknown> {
	const resolved = resolvePropertyMapping(mapping);
	const options = buildOptions(updatedAtOrOptions);
	const steam = game.providers.steam;
	const playstation = game.providers.playstation;
	const steamAchievements = steam?.achievements;
	const playstationAchievements = playstation?.achievements;
	const trophyCount = (type: 'bronze' | 'silver' | 'gold' | 'platinum') =>
		playstationAchievements?.achievements.filter((achievement) => achievement.trophyType === type && achievement.unlocked).length;
	const values: Partial<Record<ManagedPropertyKey, unknown>> = {
		gameSyncId: game.canonicalId, type: 'game', title: game.title, released: toIsoDate(game.releaseDate), developers: game.developers,
		publishers: game.publishers, genres: game.genres, cover: game.cover, platforms: game.platforms,
		providers: Object.keys(game.providers), owned: game.owned, acquisitionType: game.acquisitionType, playtime: game.playtimeMinutes,
		lastPlayed: toIsoDate(game.lastPlayed), steamId: steam?.providerGameId, steamOwned: steam?.owned, steamPlaytime: steam?.playtimeMinutes,
		steamLastPlayed: toIsoDate(steam?.lastPlayed), steamAchievementsEarned: steamAchievements?.earned, steamAchievementsTotal: steamAchievements?.total,
		steamAchievementsProgress: steamAchievements?.progress, playstationId: playstation?.providerGameId, playstationOwned: playstation?.owned,
		playstationPlaytime: playstation?.playtimeMinutes, playstationLastPlayed: toIsoDate(playstation?.lastPlayed),
		psnTrophiesEarned: playstationAchievements?.earned, psnTrophiesTotal: playstationAchievements?.total,
		psnTrophiesProgress: playstationAchievements?.progress, psnBronze: trophyCount('bronze'), psnSilver: trophyCount('silver'),
		psnGold: trophyCount('gold'), psnPlatinum: trophyCount('platinum'), updated: options.updatedAt,
	};
	if (options.omitAchievementProperties && !isAchievementFresh(game)) {
		for (const key of [
			'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress', 'psnTrophiesEarned', 'psnTrophiesTotal',
			'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum',
		] as const) delete values[key];
	}
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(values) as ManagedPropertyKey[]) setIfPresent(result, resolved[key], values[key]);
	return result;
}
