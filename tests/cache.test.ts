import { describe, expect, it } from 'vitest';
import {
	CACHE_TTL_MS,
	createCacheEnvelope,
	createCacheStore,
	parseCacheEnvelope,
	sha256Fingerprint,
} from '../src/sync/cache';
import { isProviderAchievementSet } from '../src/sync/service';

describe('disposable provider cache', () => {
	it('creates and accepts a versioned envelope for its provider', () => {
		const envelope = createCacheEnvelope('steam', { title: 'Example' }, '2026-09-12T10:00:00.000Z');

		expect(envelope).toEqual({
			schemaVersion: 1,
			provider: 'steam',
			createdAt: '2026-09-12T10:00:00.000Z',
			data: { title: 'Example' },
		});
		expect(parseCacheEnvelope(envelope, 'steam')).toEqual(envelope);
		expect(parseCacheEnvelope({ ...envelope, schemaVersion: 2 }, 'steam')).toBeUndefined();
		expect(parseCacheEnvelope({ ...envelope, provider: 'playstation' }, 'steam')).toBeUndefined();
		expect(parseCacheEnvelope({ ...envelope, createdAt: 'not-a-date' }, 'steam')).toBeUndefined();
		expect(parseCacheEnvelope(null, 'steam')).toBeUndefined();
	});

	it('expires cache values according to their TTL category', async () => {
		const cache = createCacheStore({ now: () => Date.parse('2026-09-12T12:00:00.000Z') });
		await cache.set('metadata', 'steam', { title: 'Example' }, '2026-09-01T12:00:00.000Z');
		await cache.set('achievements', 'steam', { earned: 1 }, '2026-09-04T00:00:00.000Z');

		expect(await cache.get('metadata', 'steam', CACHE_TTL_MS.metadata)).toEqual({ title: 'Example' });
		expect(await cache.get('achievements', 'steam', CACHE_TTL_MS.achievements)).toBeUndefined();
	});

	it('discards malformed entries and returns copies rather than mutable internals', async () => {
		const cache = createCacheStore();
		await cache.set('metadata', 'steam', { nested: { value: 1 } }, '2026-09-12T12:00:00.000Z');
		const first = await cache.get<{ nested: { value: number } }>('metadata', 'steam', Number.POSITIVE_INFINITY);
		if (first === undefined) throw new Error('Expected cache value.');
		first.nested.value = 2;
		expect((await cache.get<{ nested: { value: number } }>('metadata', 'steam', Number.POSITIVE_INFINITY))?.nested.value).toBe(1);

		cache.setRaw('broken', { schemaVersion: 99 });
		expect(await cache.getRaw('broken', 'steam')).toBeUndefined();
	});

	it('rejects provider cache payloads that do not match the requested shape', async () => {
		const cache = createCacheStore({ now: () => Date.parse('2026-09-12T12:00:00.000Z') });
		cache.setRaw('steam:bad', { schemaVersion: 1, provider: 'steam', createdAt: '2026-09-12T11:00:00.000Z', data: { achievements: 'not-a-set' } });
		const providerRecord = (value: unknown): value is { fetchedAt: string; achievements: Record<string, unknown> } => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
			const record = value as Record<string, unknown>;
			return typeof record.fetchedAt === 'string' && typeof record.achievements === 'object' && record.achievements !== null && !Array.isArray(record.achievements);
		};

		expect(await cache.get('bad', 'steam', 'achievements', undefined, providerRecord)).toBeUndefined();
	});

	it('rejects a cache envelope when any provider achievement is malformed', async () => {
		const valid = {
			earned: 1,
			total: 1,
			progress: 100,
			achievements: [{ id: 'achievement-1', name: 'Achievement', unlocked: true, hidden: false, rarityPercent: 25, trophyType: 'gold', iconUrl: 'https://example.test/icon.png' }],
		};
		expect(isProviderAchievementSet(valid)).toBe(true);
		for (const malformed of [
			{ ...valid.achievements[0], id: '' },
			{ ...valid.achievements[0], unlocked: 'yes' },
			{ ...valid.achievements[0], hidden: 0 },
			{ ...valid.achievements[0], rarityPercent: 101 },
			{ ...valid.achievements[0], trophyType: 'diamond' },
			{ ...valid.achievements[0], secret: true },
		]) {
			expect(isProviderAchievementSet({ ...valid, achievements: [malformed] })).toBe(false);
		}
		expect(isProviderAchievementSet({ ...valid, total: 2 })).toBe(false);
		expect(isProviderAchievementSet({ ...valid, earned: 0 })).toBe(false);

		const cache = createCacheStore();
		cache.setRaw('steam:bad-achievement', createCacheEnvelope('steam', { fetchedAt: '2026-09-12T10:00:00.000Z', achievements: { ...valid, achievements: [{ ...valid.achievements[0], rarityPercent: Number.NaN }] } }, '2026-09-12T10:00:00.000Z'));
		const validator = (value: unknown): value is { fetchedAt: string; achievements: typeof valid } => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
			const record = value as Record<string, unknown>;
			return typeof record.fetchedAt === 'string' && isProviderAchievementSet(record.achievements);
		};
		expect(await cache.get('bad-achievement', 'steam', 'achievements', undefined, validator)).toBeUndefined();
		for (const inconsistent of [{ ...valid, total: 2 }, { ...valid, earned: 0 }]) {
			cache.setRaw('steam:inconsistent-achievement', createCacheEnvelope('steam', { fetchedAt: '2026-09-12T10:00:00.000Z', achievements: inconsistent }, '2026-09-12T10:00:00.000Z'));
			expect(await cache.get('inconsistent-achievement', 'steam', 'achievements', undefined, validator)).toBeUndefined();
		}
	});

	it('uses Web Crypto SHA-256 without Node crypto or Buffer', async () => {
		expect(await sha256Fingerprint('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
		expect(await sha256Fingerprint({ b: 2, a: 1 })).toBe(await sha256Fingerprint({ a: 1, b: 2 }));
	});
});
