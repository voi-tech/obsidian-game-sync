import { describe, expect, it } from 'vitest';
import ownedPlayed from './fixtures/steam/owned-played.json';
import ownedUnplayed from './fixtures/steam/owned-unplayed.json';
import playedFree from './fixtures/steam/played-free.json';
import nonGames from './fixtures/steam/non-games.json';
import malformed from './fixtures/steam/malformed.json';
import noAchievementSupport from './fixtures/steam/no-achievement-support.json';
import recentPlay from './fixtures/steam/recent-play.json';
import { normalizeSteamGames } from '../src/providers/steam/normalize';
import { steamOwnedGamesSchema } from '../src/providers/steam/schemas';
import type { SteamAppDetails } from '../src/providers/steam/types';

describe('Steam normalization', () => {
	it('rejects malformed owned-games payloads at the schema boundary', () => {
		expect(() => steamOwnedGamesSchema.parse(malformed)).toThrow();
	});

	it('normalizes integer minutes, includes played free games, and filters only explicit non-game categories', () => {
		const details = new Map<number, SteamAppDetails>([
			[10, { type: 'game', is_free: false, genres: [{ description: 'Action' }] }],
			[20, { type: 'game', is_free: false }],
			[30, { type: 'game', is_free: true }],
			[31, { type: 'game' }],
			[40, { type: 'demo' }],
			[41, { type: 'soundtrack' }],
		]);
		const games = normalizeSteamGames([...ownedPlayed.response.games, ...ownedUnplayed.response.games, ...playedFree.response.games, ...nonGames.response.games], details);

		expect(games.map((game) => game.providerGameId)).toEqual(['10', '20', '30', '31']);
		expect(games.find((game) => game.providerGameId === '10')).toMatchObject({ playtimeMinutes: 123, owned: true, acquisitionType: 'unknown' });
		expect(games.find((game) => game.providerGameId === '30')).toMatchObject({ acquisitionType: 'free', playtimeMinutes: 45 });
		expect(games.find((game) => game.providerGameId === '31')?.title).toBe('Ambiguous Game');
	});

	it('does not trust core owned-games metadata for filters or acquisition type', () => {
		const [game] = normalizeSteamGames([{ appid: 99, name: 'Core Game', type: 'demo', is_free: true, genres: [{ description: 'Action' }] }]);

		expect(game).toMatchObject({ title: 'Core Game', acquisitionType: 'unknown' });
	});

	it('does not create a fresh achievement set when Steam reports no community stats', () => {
		const [game] = normalizeSteamGames(noAchievementSupport.response.games);

		expect(game?.achievements).toBeUndefined();
		expect(game?.freshness.achievements).toBe(false);
	});

	it('normalizes recent play time and last-played timestamp from the fixture', () => {
		const [game] = normalizeSteamGames(recentPlay.response.games);

		expect(game).toMatchObject({ providerGameId: '60', playtimeMinutes: 1, lastPlayed: '2026-09-12T10:00:00.000Z' });
	});
});
