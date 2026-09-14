import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { canonicalGameFingerprint } from '../src/sync/canonical-state';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { buildCanonicalManagedProperties } from '../src/vault/canonical-projection';
import { matchCanonicalVaultNote } from '../src/vault/matcher';
import { buildNoteIndex } from '../src/vault/note-index';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { CanonicalProviderError, CanonicalSyncService } from '../src/sync/canonical-service';
import { FakeVaultGateway } from './fake-gateway';

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: {
			canonicalKey: 'gametrack:game-1',
			externalIds: { gametrack: 'game-1', igdb: 1234 },
		},
		title: 'Example Game',
		metadata: { releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: ['Action'] },
		platforms: [{ id: 'steam', source: 'gametrack', owned: true }],
		playtime: {
			canonical: { minutes: 120, source: 'gametrack', confidence: 'high' },
			observations: [{ source: 'gametrack', rawValue: 2, rawUnit: 'hours', minutes: 120, confidence: 'high', valid: true }],
		},
		provenance: { provider: 'gametrack', sourceId: 'game-1', schemaSignature: 'schema-1' },
		...overrides,
	};
}

describe('Phase 3 canonical sync', () => {
	it('matches an existing note by IGDB before GameTrack ID and title', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\nigdb-id: 1234\ngametrack-id: another-id\n---\nmanual',
		});
		const match = matchCanonicalVaultNote(game(), await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('igdb-id');
		expect(match.confidence).toBe('explicit');
	});

	it('uses a legacy Steam identifier as a lower-priority stable match', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy.md': '---\ntitle: Legacy\nsteam-id: 440\n---\n' });
		const legacy = game({ title: 'Legacy', identity: { canonicalKey: 'gametrack:legacy', externalIds: { gametrack: 'legacy', steam: '440' } } });
		const match = matchCanonicalVaultNote(legacy, await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('provider-id');
	});

	it('uses a legacy PlayStation identifier as a lower-priority stable match', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy PS.md': '---\ntitle: Legacy PS\nplaystation-title-ids: 2001\n---\n' });
		const legacy = game({ title: 'Legacy PS', identity: { canonicalKey: 'gametrack:legacy-ps', externalIds: { gametrack: 'legacy-ps', playstation: '2001' } } });
		const match = matchCanonicalVaultNote(legacy, await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('provider-id');
	});

	it('does not auto-merge a title-only ambiguous match', async () => {
		const gateway = new FakeVaultGateway({
			'Games/A.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\n',
			'Games/B.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\n',
		});
		const noIds = game({ identity: { canonicalKey: 'gametrack:game-2', externalIds: { gametrack: 'game-2' } } });
		const match = matchCanonicalVaultNote(noIds, await buildNoteIndex(gateway));

		expect(match.status).toBe('conflict');
		expect(match.method).toBe('ambiguous');
	});

	it('projects only defined provider fields and preserves user-owned/custom properties', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\nigdb-id: 1234\nstatus: playing\nrating: 5\ncustom: keep\n---\nnotes',
		});
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const writer = new CanonicalVaultWriter(gateway);
		await writer.apply(plan);
		const content = await gateway.read('Games/Example Game.md');

		expect(content).toContain('status: playing');
		expect(content).toContain('rating: 5');
		expect(content).toContain('custom: keep');
		expect(content).toContain('igdb-id: 1234');
		expect(content).toContain('gametrack-id: game-1');
		expect(content).toContain('playtime: 120');
	});

	it('reports unchanged when provider-managed projection and fingerprint are stable', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ngame-sync-id: gametrack:game-1\nigdb-id: 1234\ngametrack-id: game-1\ntype: game\ntitle: Example Game\nreleased: 2024-01-01\ndevelopers:\n  - Studio\npublishers:\ngenres:\n  - Action\nplatforms:\n  - steam\nowned: true\nplaytime: 120\n---\n',
		});
		const first = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const second = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });

		expect(first.statuses[0]?.status).toBe('unchanged');
		expect(second.operations).toHaveLength(0);
		expect(canonicalGameFingerprint(game())).toBe(canonicalGameFingerprint(game()));
	});

	it('does not emit achievement properties when values are undefined', () => {
		const properties = buildCanonicalManagedProperties(game({ achievements: [{ source: 'steam', platform: 'steam', unlocked: 3, confidence: 'low' }] }));

		expect(properties).toEqual(expect.objectContaining({ 'achievements-unlocked': 3 }));
		expect(properties).not.toHaveProperty('achievements-total');
		expect(properties).not.toHaveProperty('achievement-percentage');
	});

	it('preserves an existing legacy game-sync-id while adding canonical external IDs', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy.md': '---\ngame-sync-id: game-sync:legacy\nsteam-id: 440\ntitle: Legacy\n---\nmanual' });
		const legacy = game({ title: 'Legacy', identity: { canonicalKey: 'gametrack:legacy', externalIds: { gametrack: 'legacy', steam: '440' } } });
		const plan = await planCanonicalSync([legacy], { gateway, notesFolder: 'Games' });
		await new CanonicalVaultWriter(gateway).apply(plan);
		const content = await gateway.read('Games/Legacy.md');

		expect(content).toContain('game-sync-id: game-sync:legacy');
		expect(content).toContain('gametrack-id: legacy');
	});

	it('blocks vault writes for a failed canonical snapshot', async () => {
		const gateway = new FakeVaultGateway();
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => false, getSnapshot: async () => ({ status: 'failed' as const, games: [], diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unsupported' as const, gamesRead: 0, gamesNormalized: 0, diagnostics: [{ code: 'EXPORT_NOT_SELECTED', message: 'No export selected.' }] } }), getLibrary: async () => [], getDiagnostics: () => ({ provider: 'gametrack', database: 'unavailable' as const, schema: 'unsupported' as const, gamesRead: 0, gamesNormalized: 0, diagnostics: [] }) };
		const service = new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });

		await expect(service.sync()).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

});
