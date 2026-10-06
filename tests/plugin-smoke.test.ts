import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest', () => {
	it('ships third-party license notices inside the installable bundle', async () => {
		const { readFile } = await import('node:fs/promises');
		const bundle = await readFile(new URL('../main.js', import.meta.url), 'utf8');
		expect(bundle.includes('Game Sync third-party notices')).toBe(true);
		expect(bundle.includes('BSD-3-Clause')).toBe(true);
		expect(bundle.includes('ISC')).toBe(true);
	});

	it('uses the stable Game Sync identity', () => {
		expect(manifest.id).toBe('game-sync');
		expect(manifest.name).toBe('Game Sync');
		expect(manifest.isDesktopOnly).toBe(true);
	});

	it('uses YY.M.PATCH', () => {
		expect(manifest.version).toMatch(/^\d{2}\.(?:[1-9]|1[0-2])\.\d+$/);
	});
});
