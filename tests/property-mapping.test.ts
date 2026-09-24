import { describe, expect, it } from 'vitest';
import type { NormalizedGame } from '../src/model/game';
import { buildManagedProperties, DEFAULT_PROPERTY_MAPPING, resolvePropertyMapping, validatePropertyMapping } from '../src/model/property-mapping';
import { canonicalMappingFromLegacy, resolveCanonicalPropertyMapping } from '../src/vault/canonical-projection';
import { PROPERTY_MAPPING_GROUPS } from '../src/ui/settings/property-settings';

const game: NormalizedGame = {
	identity: { canonicalId: 'game-sync:one', steamAppId: 1 },
	canonicalId: 'game-sync:one',
	title: 'One',
	releaseDate: '2020-01-02',
	developers: ['Dev'],
	publishers: ['Pub'],
	genres: ['RPG'],
	platforms: ['pc'],
	providers: {
		steam: {
			providerGameId: '1',
			title: 'One',
			developers: ['Dev'],
			publishers: ['Pub'],
			genres: ['RPG'],
			platforms: ['pc'],
			owned: true,
			playtimeMinutes: 90,
			freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
		},
	},
	owned: true,
	acquisitionType: 'unknown',
	playtimeMinutes: 90,
};

describe('managed Property mapping', () => {
	it('contains every default logical key', () => {
		expect(Object.keys(DEFAULT_PROPERTY_MAPPING)).toEqual([
			'gameSyncId', 'type', 'title', 'released', 'developers', 'publishers', 'genres', 'cover', 'platforms', 'providers',
			'owned', 'acquisitionType', 'playtime', 'lastPlayed', 'steamId', 'steamOwned', 'steamPlaytime', 'steamLastPlayed',
			'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress', 'playstationId', 'playstationOwned',
			'playstationPlaytime', 'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress',
			'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum', 'updated',
			'igdbId', 'gametrackId',
		]);
	});

	it('renders every default logical key in exactly one settings group', () => {
		const grouped = PROPERTY_MAPPING_GROUPS.flatMap((group) => group.keys);
		expect(grouped).toHaveLength(Object.keys(DEFAULT_PROPERTY_MAPPING).length);
		expect(new Set(grouped).size).toBe(grouped.length);
		expect(new Set(grouped)).toEqual(new Set(Object.keys(DEFAULT_PROPERTY_MAPPING)));
	});

	it('omits disabled mappings and does not expose template keys as mapping keys', () => {
		const values = buildManagedProperties(game, { steamPlaytime: null }, '2026-09-12T12:30:00.000Z');
		expect(values).toMatchObject({ 'game-sync-id': 'game-sync:one', title: 'One', playtime: 90 });
		expect(values).not.toHaveProperty('steam-playtime');
	});

	it('writes a renamed destination while leaving the old destination untouched', () => {
		const values = buildManagedProperties(game, { title: 'game-title' });
		expect(values).toHaveProperty('game-title', 'One');
		expect(values).not.toHaveProperty('title');
	});

	it('rejects duplicate and user-owned destinations', () => {
		expect(() => validatePropertyMapping({ title: 'same', type: 'same' })).toThrow(/duplicate/i);
		for (const name of ['status', 'rating', 'favorite', 'start', 'end', 'review', 'notes', 'tags']) {
			expect(() => validatePropertyMapping({ title: `  ${name.toUpperCase()}  ` })).toThrow(/user-owned/i);
		}
		expect(() => validatePropertyMapping({ title: ' Steam-ID ' })).toThrow(/duplicate/i);
	});

	it('rejects user-owned canonical destinations after trimming and case normalization', () => {
		for (const name of ['status', 'rating', 'favorite', 'start', 'end', 'review', 'notes', 'tags']) {
			expect(() => resolveCanonicalPropertyMapping({ title: `  ${name.toUpperCase()}  ` })).toThrow(/user-owned/i);
		}
	});

	it('resolves defaults before validating active destinations and trims overrides', () => {
		expect(resolvePropertyMapping({ title: '  custom-title  ' }).title).toBe('custom-title');
		expect(resolvePropertyMapping({ steamPlaytime: null }).steamPlaytime).toBeUndefined();
	});

	it('passes canonical identity and achievement mapping overrides through the shared settings state', () => {
		expect(canonicalMappingFromLegacy({ igdbId: 'external-id', gametrackId: null, steamAchievementsTotal: 'achievement-count' })).toEqual({
		igdbId: 'external-id', gametrackId: null, steamAchievementsTotal: 'achievement-count',
	});
		expect(resolveCanonicalPropertyMapping({ title: 'game-title', steamAchievementsTotal: null })).toMatchObject({ title: 'game-title', steamAchievementsTotal: undefined });
	});

	it('omits null and undefined source values instead of erasing unrelated data', () => {
		const values = buildManagedProperties({ ...game, cover: undefined, lastPlayed: undefined }, undefined, '2026-09-12T12:30:00.000Z');
		expect(values).not.toHaveProperty('cover');
		expect(values).not.toHaveProperty('last-played');
	});

	it('omits every achievement and trophy Property when freshness is incomplete', () => {
		const staleGame = {
			...game,
			providers: {
				steam: {
					...game.providers.steam!,
					freshness: { ...game.providers.steam!.freshness, achievements: false },
					achievements: { earned: 1, total: 2, progress: 50, achievements: [] },
				},
			},
		};
		const values = buildManagedProperties(staleGame, {}, { updatedAt: '2026-09-12T12:30:00.000Z', omitAchievementProperties: true });

		for (const key of ['steam-achievements-earned', 'steam-achievements-total', 'steam-achievements-progress', 'psn-trophies-earned', 'psn-trophies-total', 'psn-trophies-progress', 'psn-bronze', 'psn-silver', 'psn-gold', 'psn-platinum']) {
			expect(values).not.toHaveProperty(key);
		}
	});
});
