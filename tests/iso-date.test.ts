import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { toIsoDate } from '../src/model/iso-date';
import { canonicalGameFingerprint } from '../src/sync/canonical-state';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { buildCanonicalManagedProperties } from '../src/vault/canonical-projection';
import { FakeVaultGateway } from './fake-gateway';

function game(lastPlayed: string | undefined): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:date-test', externalIds: { gametrack: 'date-test', igdb: 1905 } },
		title: 'Date Test',
		lastPlayed,
		metadata: { releaseDate: '2026-09-15T00:00:00Z', developers: [], publishers: [], genres: [] },
		platforms: [],
		playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'date-test', schemaSignature: 'fixture' },
	};
}

describe('date-only normalization', () => {
	it('preserves the source calendar date from timestamp strings', () => {
		expect(toIsoDate('2026-09-15T23:30:00-07:00')).toBe('2026-09-15');
		expect(toIsoDate('2026-09-15T00:30:00+14:00')).toBe('2026-09-15');
	});

	it('keeps date-only values stable and handles null values', () => {
		expect(toIsoDate('2026-09-15')).toBe('2026-09-15');
		expect(toIsoDate(null)).toBeUndefined();
		expect(toIsoDate(undefined)).toBeUndefined();
	});

	it('projects date-only fields and fingerprints by the final public value', () => {
		const first = game('2026-09-15T10:23:00Z');
		const second = game('2026-09-15T23:59:59Z');
		expect(buildCanonicalManagedProperties(first)).toMatchObject({ released: '2026-09-15', 'last-played': '2026-09-15' });
		expect(canonicalGameFingerprint(first)).toBe(canonicalGameFingerprint(second));
	});

	it('updates an old timestamp once, then reports the note unchanged', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Date Test.md': '---\ngame-sync-id: gametrack:date-test\nigdb-id: 1905\ntitle: Date Test\nlast-played: 2026-09-15T10:23:00Z\n---\n# Date Test\n' });
		const firstPlan = await planCanonicalSync([game('2026-09-15T20:00:00Z')], { gateway, notesFolder: 'Games' });
		expect(firstPlan.operations).toHaveLength(1);
		expect(firstPlan.operations[0]?.preview.changes).toEqual(expect.arrayContaining([
			expect.objectContaining({ property: 'last-played', previous: '2026-09-15T10:23:00Z', next: '2026-09-15' }),
		]));
		await new CanonicalVaultWriter(gateway).apply(firstPlan);

		const secondPlan = await planCanonicalSync([game('2026-09-15T20:00:00Z')], { gateway, notesFolder: 'Games' });
		expect(secondPlan.operations).toHaveLength(0);
		expect(secondPlan.statuses[0]?.status).toBe('unchanged');
	});
});
