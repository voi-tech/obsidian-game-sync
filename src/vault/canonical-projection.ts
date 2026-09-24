import type { AchievementSummary, CanonicalGame, PlatformPresence } from '../model/canonical-game';
import { toIsoDate } from '../model/iso-date';
import {
	resolvePropertyMapping,
	type ManagedPropertyKey,
	type PropertyMapping,
	type ResolvedPropertyMapping,
} from '../model/property-mapping';

/** Canonical sync owns a checked subset of the shared managed-property contract. */
export const CANONICAL_PROVIDER_MANAGED_KEYS = Object.freeze([
	'gameSyncId', 'igdbId', 'gametrackId', 'type', 'title', 'released', 'developers', 'publishers', 'genres', 'cover', 'platforms', 'providers',
	'owned', 'acquisitionType', 'playtime', 'lastPlayed', 'steamId', 'steamOwned', 'steamPlaytime', 'steamLastPlayed',
	'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress', 'playstationId', 'playstationOwned',
	'playstationPlaytime', 'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress', 'psnBronze',
	'psnSilver', 'psnGold', 'psnPlatinum', 'updated',
] as const satisfies readonly ManagedPropertyKey[]);

export type CanonicalPropertyKey = typeof CANONICAL_PROVIDER_MANAGED_KEYS[number];
export type CanonicalPropertyMapping = Pick<PropertyMapping, CanonicalPropertyKey>;
export type ResolvedCanonicalPropertyMapping = Pick<ResolvedPropertyMapping, CanonicalPropertyKey>;

export interface CanonicalProjectionOptions {
	readonly canonicalKeyOverride?: string;
	readonly protectedProperties?: readonly CanonicalPropertyKey[];
	readonly updatedAt?: string;
}

/** Reuses destinations from the legacy settings where the canonical key has the same meaning. */
export function canonicalMappingFromLegacy(mapping: Readonly<Record<string, string | null | false>> = {}): CanonicalPropertyMapping {
	const result: CanonicalPropertyMapping = {};
	for (const key of CANONICAL_PROVIDER_MANAGED_KEYS) {
		const value = mapping[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

export function resolveCanonicalPropertyMapping(mapping: CanonicalPropertyMapping = {}): ResolvedCanonicalPropertyMapping {
	const resolved = resolvePropertyMapping(mapping);
	return Object.fromEntries(CANONICAL_PROVIDER_MANAGED_KEYS.map((key) => [key, resolved[key]])) as ResolvedCanonicalPropertyMapping;
}

function setIfPresent(result: Record<string, unknown>, key: string | undefined, value: unknown): void {
	if (key !== undefined && value !== undefined && value !== null) result[key] = value;
}

function providerSources(game: CanonicalGame): string[] {
	const sources = [game.provenance.provider, ...game.platforms.map((platform) => platform.source), ...game.playtime.observations.map((observation) => observation.source),
		...(game.activity?.lastPlayed === undefined ? [] : [game.activity.lastPlayed.source]), ...(game.achievements ?? []).map((summary) => summary.source)];
	return [...new Set(sources.map((source) => source.trim()).filter((source) => source.length > 0))];
}

function providerPlaytime(game: CanonicalGame, provider: string): number | undefined {
	const values = game.playtime.observations
		.filter((observation) => observation.source === provider && observation.valid && observation.minutes !== undefined && Number.isFinite(observation.minutes) && observation.minutes >= 0)
		.map((observation) => observation.minutes as number);
	if (values.length === 0 || new Set(values).size > 1) return undefined;
	return values[0];
}

/** Resolves ownership without turning partial or missing observations into a guess. */
export function resolveCanonicalOwnership(platforms: readonly PlatformPresence[], source?: string): boolean | undefined {
	const relevant = source === undefined ? platforms : platforms.filter((platform) => platform.source === source);
	if (relevant.length === 0) return undefined;
	if (relevant.some((platform) => platform.owned === true)) return true;
	return relevant.some((platform) => platform.owned === undefined) ? undefined : false;
}

function providerOwned(game: CanonicalGame, provider: string): boolean | undefined {
	return resolveCanonicalOwnership(game.platforms, provider);
}

function providerLastPlayed(game: CanonicalGame, provider: string): string | undefined {
	const activity = game.activity?.lastPlayed;
	return activity?.source === provider ? toIsoDate(activity.value) : undefined;
}

function achievementFor(game: CanonicalGame, provider: 'steam' | 'playstation'): AchievementSummary | undefined {
	const candidates = (game.achievements ?? []).filter((summary) => summary.source === provider || summary.platform === provider);
	if (candidates.length === 0) return undefined;
	const high = candidates.filter((summary) => summary.confidence === 'high');
	const preferred = high.length > 0 ? high : candidates;
	const fingerprints = new Set(preferred.map((summary) => `${preferredValue(summary.unlocked)}:${preferredValue(summary.total)}:${preferredValue(summary.completionPercent)}`));
	return fingerprints.size === 1 ? preferred[0] : undefined;
}

function preferredValue(value: number | undefined): string {
	return value === undefined ? '' : String(value);
}

function trophyCount(summary: AchievementSummary | undefined, type: 'bronze' | 'silver' | 'gold' | 'platinum'): number | undefined {
	if (summary?.details === undefined) return undefined;
	return summary.details.filter((detail) => detail.trophyType === type).length;
}

export function buildCanonicalManagedProperties(
	game: CanonicalGame,
	mapping: CanonicalPropertyMapping = {},
	options: CanonicalProjectionOptions = {},
): Record<string, unknown> {
	const resolved = resolveCanonicalPropertyMapping(mapping);
	const steam = achievementFor(game, 'steam');
	const playstation = achievementFor(game, 'playstation');
	const steamPlaytime = providerPlaytime(game, 'steam');
	const playstationPlaytime = providerPlaytime(game, 'playstation');
	const values: Partial<Record<CanonicalPropertyKey, unknown>> = {
		gameSyncId: options.canonicalKeyOverride ?? game.identity.canonicalKey,
		igdbId: game.identity.externalIds.igdb,
		gametrackId: game.identity.externalIds.gametrack,
		type: 'game', title: game.title, released: toIsoDate(game.metadata.releaseDate), developers: game.metadata.developers, publishers: game.metadata.publishers,
		genres: game.metadata.genres, cover: game.metadata.cover, platforms: [...new Set(game.platforms.map((platform) => platform.id))], providers: providerSources(game),
		owned: resolveCanonicalOwnership(game.platforms), acquisitionType: 'unknown', playtime: game.playtime.canonical?.minutes,
		lastPlayed: toIsoDate(game.activity?.lastPlayed?.value ?? game.lastPlayed), steamId: game.identity.externalIds.steam, steamOwned: providerOwned(game, 'steam'),
		steamPlaytime, steamLastPlayed: providerLastPlayed(game, 'steam'), steamAchievementsEarned: steam?.unlocked, steamAchievementsTotal: steam?.total,
		steamAchievementsProgress: steam?.completionPercent, playstationId: game.identity.externalIds.playstation, playstationOwned: providerOwned(game, 'playstation'),
		playstationPlaytime, playstationLastPlayed: providerLastPlayed(game, 'playstation'), psnTrophiesEarned: playstation?.unlocked, psnTrophiesTotal: playstation?.total,
		psnTrophiesProgress: playstation?.completionPercent, psnBronze: trophyCount(playstation, 'bronze'), psnSilver: trophyCount(playstation, 'silver'),
		psnGold: trophyCount(playstation, 'gold'), psnPlatinum: trophyCount(playstation, 'platinum'), updated: options.updatedAt,
	};
	const result: Record<string, unknown> = {};
	for (const key of CANONICAL_PROVIDER_MANAGED_KEYS) setIfPresent(result, resolved[key], values[key]);
	return result;
}

/** Builds the exact provider-managed projection that a canonical writer may apply. */
export function buildCanonicalWriteProperties(
	game: CanonicalGame,
	mapping: CanonicalPropertyMapping = {},
	options: CanonicalProjectionOptions = {},
): Record<string, unknown> {
	const properties = buildCanonicalManagedProperties(game, mapping, options);
	if (options.protectedProperties === undefined || options.protectedProperties.length === 0) return properties;
	const resolved = resolveCanonicalPropertyMapping(mapping);
	for (const key of options.protectedProperties) {
		const destination = resolved[key];
		if (destination !== undefined) delete properties[destination];
	}
	return properties;
}

export function defaultCanonicalNoteBody(game: CanonicalGame): string {
	return `# ${game.title}\n`;
}

export function canonicalManagedPropertyNames(mapping: CanonicalPropertyMapping = {}): readonly string[] {
	return Object.values(resolveCanonicalPropertyMapping(mapping)).filter((value): value is string => value !== undefined);
}
