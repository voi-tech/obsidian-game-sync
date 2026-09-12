import type { NormalizedGame } from './game';

export type ManagedPropertyKey =
	| 'gameSyncId' | 'type' | 'title' | 'released' | 'developers' | 'publishers' | 'genres' | 'cover' | 'platforms' | 'providers'
	| 'owned' | 'acquisitionType' | 'playtime' | 'lastPlayed' | 'steamId' | 'steamOwned' | 'steamPlaytime' | 'steamLastPlayed'
	| 'steamAchievementsEarned' | 'steamAchievementsTotal' | 'steamAchievementsProgress' | 'playstationId' | 'playstationOwned'
	| 'playstationPlaytime' | 'playstationLastPlayed' | 'psnTrophiesEarned' | 'psnTrophiesTotal' | 'psnTrophiesProgress'
	| 'psnBronze' | 'psnSilver' | 'psnGold' | 'psnPlatinum' | 'updated';

export type PropertyMapping = Partial<Record<ManagedPropertyKey, string | null | false>>;
export type ResolvedPropertyMapping = Record<ManagedPropertyKey, string | undefined>;

export const DEFAULT_PROPERTY_MAPPING: Record<ManagedPropertyKey, string> = {
	gameSyncId: 'game-sync-id', type: 'type', title: 'title', released: 'released', developers: 'developers', publishers: 'publishers',
	genres: 'genres', cover: 'cover', platforms: 'platforms', providers: 'providers', owned: 'owned', acquisitionType: 'acquisition-type',
	playtime: 'playtime', lastPlayed: 'last-played', steamId: 'steam-id', steamOwned: 'steam-owned', steamPlaytime: 'steam-playtime',
	steamLastPlayed: 'steam-last-played', steamAchievementsEarned: 'steam-achievements-earned', steamAchievementsTotal: 'steam-achievements-total',
	steamAchievementsProgress: 'steam-achievements-progress', playstationId: 'playstation-id', playstationOwned: 'playstation-owned',
	playstationPlaytime: 'playstation-playtime', playstationLastPlayed: 'playstation-last-played', psnTrophiesEarned: 'psn-trophies-earned',
	psnTrophiesTotal: 'psn-trophies-total', psnTrophiesProgress: 'psn-trophies-progress', psnBronze: 'psn-bronze', psnSilver: 'psn-silver',
	psnGold: 'psn-gold', psnPlatinum: 'psn-platinum', updated: 'game-sync-updated',
};

const USER_OWNED_PROPERTY_NAMES = new Set(['status', 'rating', 'favorite', 'start', 'end', 'review', 'notes', 'tags']);

export function validatePropertyMapping(mapping: PropertyMapping): void {
	const destinations = new Map<string, ManagedPropertyKey>();
	for (const [key, destination] of Object.entries(mapping) as [ManagedPropertyKey, string | null | false][]) {
		if (destination === null || destination === false || destination === undefined) continue;
		if (typeof destination !== 'string' || destination.trim().length === 0) throw new Error(`Invalid property mapping for ${key}.`);
		if (USER_OWNED_PROPERTY_NAMES.has(destination)) throw new Error(`Property ${destination} is user-owned and cannot be managed.`);
		const previous = destinations.get(destination);
		if (previous !== undefined) throw new Error(`Duplicate property mapping destination ${destination} for ${previous} and ${key}.`);
		destinations.set(destination, key);
	}
}

export function resolvePropertyMapping(mapping: PropertyMapping = {}): ResolvedPropertyMapping {
	validatePropertyMapping(mapping);
	const resolved = {} as ResolvedPropertyMapping;
	for (const key of Object.keys(DEFAULT_PROPERTY_MAPPING) as ManagedPropertyKey[]) {
		const destination = mapping[key];
		resolved[key] = destination === null || destination === false ? undefined : destination ?? DEFAULT_PROPERTY_MAPPING[key];
	}
	return resolved;
}

function setIfPresent(result: Record<string, unknown>, destination: string | undefined, value: unknown): void {
	if (destination !== undefined && value !== undefined && value !== null) result[destination] = value;
}

export function buildManagedProperties(
	game: NormalizedGame,
	mapping: PropertyMapping = {},
	updatedAt?: string,
): Record<string, unknown> {
	const resolved = resolvePropertyMapping(mapping);
	const steam = game.providers.steam;
	const playstation = game.providers.playstation;
	const steamAchievements = steam?.achievements;
	const playstationAchievements = playstation?.achievements;
	const trophyCount = (type: 'bronze' | 'silver' | 'gold' | 'platinum') =>
		playstationAchievements?.achievements.filter((achievement) => achievement.trophyType === type).length;
	const values: Partial<Record<ManagedPropertyKey, unknown>> = {
		gameSyncId: game.canonicalId, type: 'game', title: game.title, released: game.releaseDate, developers: game.developers,
		publishers: game.publishers, genres: game.genres, cover: game.cover, platforms: game.platforms,
		providers: Object.keys(game.providers), owned: game.owned, acquisitionType: game.acquisitionType, playtime: game.playtimeMinutes,
		lastPlayed: game.lastPlayed, steamId: steam?.providerGameId, steamOwned: steam?.owned, steamPlaytime: steam?.playtimeMinutes,
		steamLastPlayed: steam?.lastPlayed, steamAchievementsEarned: steamAchievements?.earned, steamAchievementsTotal: steamAchievements?.total,
		steamAchievementsProgress: steamAchievements?.progress, playstationId: playstation?.providerGameId, playstationOwned: playstation?.owned,
		playstationPlaytime: playstation?.playtimeMinutes, playstationLastPlayed: playstation?.lastPlayed,
		psnTrophiesEarned: playstationAchievements?.earned, psnTrophiesTotal: playstationAchievements?.total,
		psnTrophiesProgress: playstationAchievements?.progress, psnBronze: trophyCount('bronze'), psnSilver: trophyCount('silver'),
		psnGold: trophyCount('gold'), psnPlatinum: trophyCount('platinum'), updated: updatedAt,
	};
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(values) as ManagedPropertyKey[]) setIfPresent(result, resolved[key], values[key]);
	return result;
}
