import { describe, expect, it } from 'vitest';
import type { NormalizedGame } from '../src/model/game';
import { buildManagedProperties, DEFAULT_PROPERTY_MAPPING, validatePropertyMapping } from '../src/model/property-mapping';

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
		]);
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

	it('rejects duplicate destinations and user-owned destinations', () => {
		expect(() => validatePropertyMapping({ title: 'same', type: 'same' })).toThrow(/duplicate/i);
		expect(() => validatePropertyMapping({ title: 'status' })).toThrow(/user-owned/i);
	});

	it('omits null and undefined source values instead of erasing unrelated data', () => {
		const values = buildManagedProperties({ ...game, cover: undefined, lastPlayed: undefined }, undefined, '2026-09-12T12:30:00.000Z');
		expect(values).not.toHaveProperty('cover');
		expect(values).not.toHaveProperty('last-played');
	});
});
