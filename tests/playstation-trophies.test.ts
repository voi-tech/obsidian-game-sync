import { describe, expect, it } from 'vitest';
import titleTrophies from './fixtures/playstation/title-trophies.json';
import earnedTrophies from './fixtures/playstation/earned-trophies.json';
import { normalizePlayStationTrophies } from '../src/providers/playstation/trophies';

describe('PlayStation trophies', () => {
	it('combines hidden, incomplete-description, and all four trophy grades', () => {
		const result = normalizePlayStationTrophies(titleTrophies as never, earnedTrophies as never);

		expect(result.total).toBe(4);
		expect(result.earned).toBe(2);
		expect(result.achievements.map((entry) => entry.trophyType)).toEqual(['bronze', 'silver', 'gold', 'platinum']);
		expect(result.achievements[1]?.hidden).toBe(true);
		expect(result.achievements[2]?.description).toBeUndefined();
	});
});
