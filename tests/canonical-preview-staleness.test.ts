import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { CanonicalLibrarySnapshot, LibraryProvider } from '../src/model/canonical-provider';
import { CanonicalProviderError, CanonicalSyncService } from '../src/sync/canonical-service';
import { canonicalLibraryRevision } from '../src/sync/canonical-state';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { FakeVaultGateway } from './fake-gateway';

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:game-1', externalIds: { gametrack: 'game-1' } },
		title: 'Example Game',
		metadata: { summary: 'Original summary', developers: [], publishers: [], genres: [] },
		platforms: [{ id: 'pc', source: 'gametrack', owned: true }],
		playtime: { canonical: { minutes: 60, source: 'gametrack', confidence: 'high' }, observations: [] },
		achievements: [{ source: 'gametrack', unlocked: 1, total: 2, confidence: 'high', details: [{ id: 'a', name: 'First', description: 'Original detail', unlocked: true }] }],
		provenance: { provider: 'gametrack', sourceId: 'game-1', schemaSignature: 'schema-1' },
		...overrides,
	};
}

function snapshot(value: CanonicalGame, gamesRead = 1): CanonicalLibrarySnapshot {
	// Real providers derive the revision from the game content (GameTrack adds the export fingerprint).
	return { status: 'complete', games: [value], revision: canonicalLibraryRevision([value]), diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead, gamesNormalized: 1, diagnostics: [] } };
}

function mutableProvider(initial: CanonicalLibrarySnapshot): { provider: LibraryProvider; set(next: CanonicalLibrarySnapshot): void } {
	let current = initial;
	return {
		provider: {
			id: 'gametrack',
			getCapabilities: () => ({ supported: true, desktop: true, mobile: true, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
			isAvailable: async () => true,
			getSnapshot: async () => current,
			getLibrary: async () => current.games,
			getDiagnostics: () => current.diagnostics,
		},
		set: (next) => { current = next; },
	};
}

function service(provider: LibraryProvider, gateway: FakeVaultGateway): CanonicalSyncService {
	return new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });
}

// Moved from the removed canonical Steam/PlayStation library provider tests: the guard is provider-neutral and
// rejects a preview when the provider revision changed after it.
describe('canonical preview staleness', () => {
	it('applies a preview when only diagnostics changed after it', async () => {
		const source = mutableProvider(snapshot(game()));
		const gateway = new FakeVaultGateway();
		const sync = service(source.provider, gateway);
		const preview = await sync.preview();
		source.set(snapshot(game(), 2));

		await expect(sync.applyPreview(preview)).resolves.toHaveLength(1);
	});

	it('rejects a preview when a managed value changed before writing', async () => {
		const source = mutableProvider(snapshot(game()));
		const gateway = new FakeVaultGateway();
		const sync = service(source.provider, gateway);
		const preview = await sync.preview();
		source.set(snapshot(game({ title: 'Example Game Updated' })));

		await expect(sync.applyPreview(preview)).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(gateway.frontMatterProcessCount).toBe(0);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it('rejects a preview when metadata or achievement details changed', async () => {
		const original = game();
		const source = mutableProvider(snapshot(original));
		const gateway = new FakeVaultGateway();
		const sync = service(source.provider, gateway);
		const preview = await sync.preview();
		const [summary] = original.achievements!;
		source.set(snapshot(game({
			metadata: { ...original.metadata, summary: 'Changed summary' },
			achievements: [{ ...summary, details: [{ ...summary.details![0], description: 'Changed detail' }] }],
		})));

		await expect(sync.applyPreview(preview)).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});
});
