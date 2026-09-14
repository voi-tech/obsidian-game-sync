import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { NotePathAllocator } from '../src/sync/note-path-allocator';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { FakeVaultGateway } from './fake-gateway';

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: {
			canonicalKey: 'gametrack:dead-space-2008',
			externalIds: { gametrack: 'dead-space-2008', igdb: 37 },
		},
		title: 'Dead Space',
		metadata: { releaseDate: '2008-10-13', developers: [], publishers: [], genres: [] },
		platforms: [],
		playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'dead-space-2008', schemaSignature: 'fixture' },
		...overrides,
	};
}

function pathsFor(games: readonly CanonicalGame[]): Map<string, string> {
	return new NotePathAllocator().allocateBatch(games, { notesFolder: 'Games', existingPaths: [] });
}

describe('NotePathAllocator', () => {
	it('uses the existing title path for a unique new game', () => {
		const result = new NotePathAllocator().allocate(game(), { notesFolder: 'Games', existingPaths: [] });

		expect(result.path).toBe('Games/Dead Space.md');
	});

	it('uses symmetric release-year paths for duplicate titles with unique years', () => {
		const games = [
			game(),
			game({ identity: { canonicalKey: 'gametrack:dead-space-2023', externalIds: { gametrack: 'dead-space-2023', igdb: 159119 } }, metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'dead-space-2023', schemaSignature: 'fixture' } }),
		];

		expect(pathsFor(games)).toEqual(new Map([
			['gametrack:dead-space-2008', 'Games/Dead Space (2008).md'],
			['gametrack:dead-space-2023', 'Games/Dead Space (2023).md'],
		]));
	});

	it('is deterministic when duplicate input order changes', () => {
		const first = game();
		const second = game({ identity: { canonicalKey: 'gametrack:dead-space-2023', externalIds: { gametrack: 'dead-space-2023', igdb: 159119 } }, metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'dead-space-2023', schemaSignature: 'fixture' } });

		expect([...pathsFor([first, second])]).toEqual([...pathsFor([second, first])]);
	});

	it('uses stable identity suffixes when years are equal or missing', () => {
		const sameYear = [
			game({ identity: { canonicalKey: 'gametrack:foo-1', externalIds: { gametrack: 'foo-1', igdb: 1001 } }, title: 'Foo', metadata: { releaseDate: '2020-01-01', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'foo-1', schemaSignature: 'fixture' } }),
			game({ identity: { canonicalKey: 'gametrack:foo-2', externalIds: { gametrack: 'foo-2', igdb: 1002 } }, title: 'Foo', metadata: { releaseDate: '2020-02-01', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'foo-2', schemaSignature: 'fixture' } }),
		];
		expect([...pathsFor(sameYear).values()]).toEqual(['Games/Foo (2020) [igdb-1001].md', 'Games/Foo (2020) [igdb-1002].md']);

		const missingYear = [
			game({ identity: { canonicalKey: 'gametrack:bar-1', externalIds: { gametrack: 'bar-1', igdb: 2001 } }, title: 'Bar', metadata: { developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'bar-1', schemaSignature: 'fixture' } }),
			game({ identity: { canonicalKey: 'gametrack:bar-2', externalIds: { gametrack: 'bar-2', igdb: 2002 } }, title: 'Bar', metadata: { developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'bar-2', schemaSignature: 'fixture' } }),
		];
		expect([...pathsFor(missingYear).values()]).toEqual(['Games/Bar [igdb-2001].md', 'Games/Bar [igdb-2002].md']);
	});

	it('allocates three same-title games without order-dependent counters', () => {
		const games = [
			game({ identity: { canonicalKey: 'gametrack:b-1', externalIds: { gametrack: 'b-1', igdb: 3001 } }, title: 'Box', metadata: { developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'b-1', schemaSignature: 'fixture' } }),
			game({ identity: { canonicalKey: 'gametrack:b-2', externalIds: { gametrack: 'b-2', igdb: 3002 } }, title: 'Box', metadata: { releaseDate: '2020-01-01', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'b-2', schemaSignature: 'fixture' } }),
			game({ identity: { canonicalKey: 'gametrack:b-3', externalIds: { gametrack: 'b-3', igdb: 3003 } }, title: 'Box', metadata: { releaseDate: '2021-01-01', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'b-3', schemaSignature: 'fixture' } }),
		];
		expect([...pathsFor(games).entries()]).toEqual([
			['gametrack:b-1', 'Games/Box [igdb-3001].md'],
			['gametrack:b-2', 'Games/Box (2020).md'],
			['gametrack:b-3', 'Games/Box (2021).md'],
		]);
	});

	it('falls back to a GameTrack identity when IGDB is absent', () => {
		const result = new NotePathAllocator().allocate(game({ identity: { canonicalKey: 'gametrack:foo', externalIds: { gametrack: 'foo' } }, title: 'Foo' }), { notesFolder: 'Games', existingPaths: ['Games/Foo.md'] });

		expect(result.path).toBe('Games/Foo [gametrack-foo].md');
	});
});

describe('canonical planner path allocation', () => {
	it('resolves the real Dead Space collision before creating operations', async () => {
		const gateway = new FakeVaultGateway();
		const first = game();
		const second = game({ identity: { canonicalKey: 'gametrack:dead-space-2023', externalIds: { gametrack: 'dead-space-2023', igdb: 159119 } }, metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'dead-space-2023', schemaSignature: 'fixture' } });
		const plan = await planCanonicalSync([first, second], { gateway, notesFolder: 'Games' });

		expect(plan.statuses.map((status) => [status.status, status.path])).toEqual([
			['create', 'Games/Dead Space (2008).md'],
			['create', 'Games/Dead Space (2023).md'],
		]);
		expect(plan.operations).toHaveLength(2);
	});

	it('preserves a matched existing path and allocates only the new collision', async () => {
		const existing = game();
		const second = game({ identity: { canonicalKey: 'gametrack:dead-space-2023', externalIds: { gametrack: 'dead-space-2023', igdb: 159119 } }, metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'dead-space-2023', schemaSignature: 'fixture' } });
		const gateway = new FakeVaultGateway({ 'Games/my-dead-space.md': '---\ntitle: Dead Space\nigdb-id: 37\nreleased: 2008-10-13\n---\nmanual' });
		const plan = await planCanonicalSync([existing, second], { gateway, notesFolder: 'Games' });

		expect(plan.statuses.find((status) => status.canonicalKey === existing.identity.canonicalKey)?.path).toBe('Games/my-dead-space.md');
		expect(plan.statuses.find((status) => status.canonicalKey === second.identity.canonicalKey)?.path).toBe('Games/Dead Space.md');
	});

	it('does not overwrite an unrelated file occupying the base path', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Dead Space.md': '# unrelated' });
		const plan = await planCanonicalSync([game({ metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] } })], { gateway, notesFolder: 'Games' });

		expect(plan.statuses[0]).toMatchObject({ status: 'create', path: 'Games/Dead Space (2023).md' });
		expect(plan.statuses.some((status) => status.status === 'conflict')).toBe(false);
	});

	it('keeps allocated paths stable after the first write', async () => {
		const gateway = new FakeVaultGateway();
		const games = [
			game(),
			game({ identity: { canonicalKey: 'gametrack:dead-space-2023', externalIds: { gametrack: 'dead-space-2023', igdb: 159119 } }, metadata: { releaseDate: '2023-01-27', developers: [], publishers: [], genres: [] }, provenance: { provider: 'gametrack', sourceId: 'dead-space-2023', schemaSignature: 'fixture' } }),
		];
		const first = await planCanonicalSync(games, { gateway, notesFolder: 'Games' });
		await new CanonicalVaultWriter(gateway).apply(first);
		const second = await planCanonicalSync(games, { gateway, notesFolder: 'Games' });

		expect(second.operations).toHaveLength(0);
		expect(second.statuses.map((status) => status.status)).toEqual(['unchanged', 'unchanged']);
	});
});
