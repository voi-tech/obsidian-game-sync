import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest', () => {
	it('uses the stable Game Sync identity', () => {
		expect(manifest.id).toBe('game-sync');
		expect(manifest.name).toBe('Game Sync');
		expect(manifest.isDesktopOnly).toBe(false);
	});

	it('uses YY.M.PATCH', () => {
		expect(manifest.version).toMatch(/^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/);
	});
});
