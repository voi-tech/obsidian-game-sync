import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { CanonicalLibrarySnapshot } from '../src/model/canonical-provider';
import { applyEnrichmentResult, type GameEnricher, type GameEnrichmentResult } from '../src/model/enrichment';
import { CanonicalSyncService } from '../src/sync/canonical-service';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { FakeVaultGateway } from './fake-gateway';
import { parseFrontmatter } from '../src/vault/frontmatter';

function game(): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:one', externalIds: { gametrack: 'one', igdb: 1, steam: '10' } },
		title: 'Example',
		metadata: { developers: [], publishers: [], genres: [] },
		platforms: [{ id: 'steam', source: 'gametrack', owned: true }],
		playtime: { canonical: { minutes: 120, source: 'gametrack', confidence: 'high' }, observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'one', schemaSignature: 'fixture' },
	};
}

function snapshot(overrides: Partial<CanonicalLibrarySnapshot> = {}): CanonicalLibrarySnapshot {
	return {
		status: 'complete', games: [game()], revision: 'base-1',
		diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 1, gamesNormalized: 1, diagnostics: [] },
		...overrides,
	};
}

describe('canonical library/enrichment boundary', () => {
	it('applies activity and platform playtime patches without changing library membership', () => {
		const result: GameEnrichmentResult = {
			source: 'steam', status: 'success', retrievedAt: '2026-09-14T12:00:00.000Z', patches: [{
			canonicalKey: 'gametrack:one', source: 'steam',
			patch: {
				lastPlayed: { value: '2026-09-13T12:00:00.000Z', source: 'steam', confidence: 'high' },
				playtimeObservation: { source: 'steam', platform: 'steam', rawValue: 90, rawUnit: 'minutes', minutes: 90, confidence: 'high', valid: true },
			},
		}], diagnostics: [],
		};
		const enriched = applyEnrichmentResult(snapshot(), result);

		expect(enriched.games).toHaveLength(1);
		expect(enriched.games[0]?.lastPlayed).toBe('2026-09-13T12:00:00.000Z');
		expect(enriched.games[0]?.playtime.observations[0]?.source).toBe('steam');
		expect(enriched.games[0]?.activity?.lastPlayed?.source).toBe('steam');
	});

	it('continues with the base snapshot when an optional enricher fails', async () => {
		const enricher: GameEnricher = {
			id: 'steam',
			getCapabilities: () => ({ playtime: true, activity: true, achievementSummary: true, achievementDetails: true }),
			enrich: async () => ({ source: 'steam', status: 'failed', retrievedAt: '2026-09-14T12:00:00.000Z', patches: [], diagnostics: [{ code: 'STEAM_UNAVAILABLE', message: 'Steam unavailable.' }] }),
		};
		const gateway = new FakeVaultGateway();
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => true, getSnapshot: async () => snapshot(), getLibrary: async () => [game()], getDiagnostics: () => snapshot().diagnostics };
		const service = new CanonicalSyncService({ provider, enrichers: [enricher], planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });

		const preview = await service.preview();
		expect(preview.snapshot.status).toBe('complete');
		expect(preview.enrichments?.[0]?.status).toBe('failed');
		expect(preview.plan?.operations).toHaveLength(1);
	});

	it('blocks all writes when the library provider fails even if enrichers succeed', async () => {
		const enricher: GameEnricher = { id: 'steam', getCapabilities: () => ({ playtime: true, activity: true, achievementSummary: true, achievementDetails: true }), enrich: async () => ({ source: 'steam', status: 'success', retrievedAt: '2026-09-14T12:00:00.000Z', patches: [], diagnostics: [] }) };
		const gateway = new FakeVaultGateway();
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => false, getSnapshot: async () => snapshot({ status: 'failed', games: [] }), getLibrary: async () => [], getDiagnostics: () => snapshot().diagnostics };
		const service = new CanonicalSyncService({ provider, enrichers: [enricher], planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });

		await expect(service.sync()).rejects.toThrow();
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it('does not erase stale enriched properties when an optional source is unavailable', async () => {
		const enricher: GameEnricher = { id: 'steam', getCapabilities: () => ({ playtime: true, activity: true, achievementSummary: true, achievementDetails: true }), enrich: async () => ({ source: 'steam', status: 'failed', retrievedAt: '2026-09-14T12:00:00.000Z', patches: [], diagnostics: [{ code: 'STEAM_UNAVAILABLE', message: 'Steam unavailable.' }] }) };
		const gateway = new FakeVaultGateway({ 'Games/Example.md': '---\ngame-sync-id: gametrack:one\ntitle: Example\nlast-played: 2026-09-13T12:00:00.000Z\nachievements-unlocked: 9\nachievements-total: 10\ncustom: keep\n---\n' });
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => true, getSnapshot: async () => snapshot(), getLibrary: async () => [game()], getDiagnostics: () => snapshot().diagnostics };
		const service = new CanonicalSyncService({ provider, enrichers: [enricher], planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });

		const preview = await service.preview();
		await service.applyPreview(preview);
		const content = await gateway.read('Games/Example.md');
		expect(parseFrontmatter(content).frontmatter['last-played']).toBe('2026-09-13T12:00:00.000Z');
		expect(content).toContain('achievements-unlocked: 9');
		expect(content).toContain('custom: keep');
	});
});
