import type { CanonicalGame } from '../model/canonical-game';

export type CanonicalPropertyKey =
	| 'gameSyncId' | 'igdbId' | 'gametrackId' | 'type' | 'title' | 'released' | 'developers' | 'publishers'
	| 'genres' | 'cover' | 'platforms' | 'owned' | 'playtime' | 'lastPlayed'
	| 'achievementsUnlocked' | 'achievementsTotal' | 'achievementPercentage';

export type CanonicalPropertyMapping = Partial<Record<CanonicalPropertyKey, string | null | false>>;
export type ResolvedCanonicalPropertyMapping = Record<CanonicalPropertyKey, string | undefined>;

export interface CanonicalProjectionOptions {
	readonly canonicalKeyOverride?: string;
}

export const DEFAULT_CANONICAL_PROPERTY_MAPPING: Record<CanonicalPropertyKey, string> = {
	gameSyncId: 'game-sync-id', igdbId: 'igdb-id', gametrackId: 'gametrack-id', type: 'type', title: 'title', released: 'released',
	developers: 'developers', publishers: 'publishers', genres: 'genres', cover: 'cover', platforms: 'platforms', owned: 'owned',
	playtime: 'playtime', lastPlayed: 'last-played', achievementsUnlocked: 'achievements-unlocked', achievementsTotal: 'achievements-total',
	achievementPercentage: 'achievement-percentage',
};

export const CANONICAL_PROVIDER_MANAGED_KEYS = Object.freeze([
	'gameSyncId', 'igdbId', 'gametrackId', 'type', 'title', 'released', 'developers', 'publishers', 'genres', 'cover', 'platforms',
	'owned', 'playtime', 'lastPlayed', 'achievementsUnlocked', 'achievementsTotal', 'achievementPercentage',
] satisfies readonly CanonicalPropertyKey[]);

/** Reuses destinations from the legacy settings where the canonical key has the same meaning. */
export function canonicalMappingFromLegacy(mapping: Readonly<Record<string, string | null | false>> = {}): CanonicalPropertyMapping {
	const result: CanonicalPropertyMapping = {};
	for (const key of CANONICAL_PROVIDER_MANAGED_KEYS) {
		const value = mapping[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function resolve(mapping: CanonicalPropertyMapping): ResolvedCanonicalPropertyMapping {
	const result = {} as ResolvedCanonicalPropertyMapping;
	for (const key of CANONICAL_PROVIDER_MANAGED_KEYS) {
		const value = mapping[key];
		result[key] = value === null || value === false ? undefined : value === undefined ? DEFAULT_CANONICAL_PROPERTY_MAPPING[key] : value.trim();
	}
	return result;
}

export function resolveCanonicalPropertyMapping(mapping: CanonicalPropertyMapping = {}): ResolvedCanonicalPropertyMapping {
	const result = resolve(mapping);
	const destinations = new Set<string>();
	for (const [key, destination] of Object.entries(result)) {
		if (destination === undefined || destination.length === 0) continue;
		const normalized = destination.toLocaleLowerCase();
		if (['status', 'rating', 'favorite', 'review', 'notes', 'tags', 'priority'].includes(normalized)) {
			throw new Error(`Property ${destination} is user-owned and cannot be managed.`);
		}
		if (destinations.has(normalized)) throw new Error(`Duplicate canonical property mapping destination ${destination} for ${key}.`);
		destinations.add(normalized);
	}
	return result;
}

function setIfPresent(result: Record<string, unknown>, key: string | undefined, value: unknown): void {
	if (key !== undefined && value !== undefined && value !== null) result[key] = value;
}

function reliableAchievement(game: CanonicalGame): { unlocked?: number; total?: number; completionPercent?: number } | undefined {
	const summaries = (game.achievements ?? []).filter((summary) => summary.unlocked !== undefined || summary.total !== undefined);
	if (summaries.length === 0) return undefined;
	const high = summaries.filter((summary) => summary.confidence === 'high');
	if (high.length > 1 && new Set(high.map((summary) => `${summary.unlocked ?? ''}:${summary.total ?? ''}`)).size > 1) return undefined;
	const direct = high.filter((summary) => summary.source !== 'gametrack');
	if (direct.length > 1 && new Set(direct.map((summary) => `${summary.unlocked ?? ''}:${summary.total ?? ''}`)).size > 1) return undefined;
	const selected = direct[0] ?? high[0] ?? (summaries.length === 1 ? summaries[0] : undefined);
	if (selected === undefined) return undefined;
	return {
		...(selected.unlocked === undefined ? {} : { unlocked: selected.unlocked }),
		...(selected.total === undefined ? {} : { total: selected.total }),
		...(selected.completionPercent === undefined ? {} : { completionPercent: selected.completionPercent }),
	};
}

export function buildCanonicalManagedProperties(
	game: CanonicalGame,
	mapping: CanonicalPropertyMapping = {},
	options: CanonicalProjectionOptions = {},
): Record<string, unknown> {
	const resolved = resolveCanonicalPropertyMapping(mapping);
	const achievement = reliableAchievement(game);
	const values: Partial<Record<CanonicalPropertyKey, unknown>> = {
		gameSyncId: options.canonicalKeyOverride ?? game.identity.canonicalKey,
		igdbId: game.identity.externalIds.igdb,
		gametrackId: game.identity.externalIds.gametrack,
		type: 'game', title: game.title, released: game.metadata.releaseDate,
		developers: game.metadata.developers, publishers: game.metadata.publishers, genres: game.metadata.genres, cover: game.metadata.cover,
		platforms: [...new Set(game.platforms.map((platform) => platform.id))],
		owned: game.platforms.some((platform) => platform.owned === true) ? true : undefined,
		playtime: game.playtime.canonical?.minutes,
		lastPlayed: game.activity?.lastPlayed?.value ?? game.lastPlayed,
		achievementsUnlocked: achievement?.unlocked, achievementsTotal: achievement?.total, achievementPercentage: achievement?.completionPercent,
	};
	const result: Record<string, unknown> = {};
	for (const key of CANONICAL_PROVIDER_MANAGED_KEYS) setIfPresent(result, resolved[key], values[key]);
	return result;
}

export function canonicalManagedPropertyNames(mapping: CanonicalPropertyMapping = {}): readonly string[] {
	return Object.values(resolveCanonicalPropertyMapping(mapping)).filter((value): value is string => value !== undefined);
}
