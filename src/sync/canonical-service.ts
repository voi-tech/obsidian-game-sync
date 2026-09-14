import type { CanonicalLibrarySnapshot, LibraryProvider } from '../model/canonical-provider';
import { mergeEnrichmentResults, type GameEnricher, type GameEnrichmentResult } from '../model/enrichment';
import { planCanonicalSync, type CanonicalSyncPlan, type CanonicalSyncPlannerOptions } from './canonical-planner';
import { CanonicalVaultWriter } from '../vault/canonical-writer';

export interface CanonicalPreviewResult {
	readonly snapshot: CanonicalLibrarySnapshot;
	readonly plan?: CanonicalSyncPlan;
	readonly enrichments?: readonly GameEnrichmentResult[];
}

export class CanonicalProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CanonicalProviderError';
	}
}

export interface CanonicalSyncServiceOptions {
	readonly provider: LibraryProvider;
	readonly enrichers?: readonly GameEnricher[];
	readonly snapshotOverride?: () => CanonicalLibrarySnapshot | undefined;
	readonly requireSnapshotOverride?: boolean;
	readonly onLibrarySnapshot?: (snapshot: CanonicalLibrarySnapshot) => void;
	readonly planner: Omit<CanonicalSyncPlannerOptions, 'gateway'> & Pick<CanonicalSyncPlannerOptions, 'gateway'>;
	readonly writer: CanonicalVaultWriter;
}

export class CanonicalSyncService {
	constructor(private readonly options: CanonicalSyncServiceOptions) {}

	async preview(): Promise<CanonicalPreviewResult> {
		const overridden = this.options.snapshotOverride?.();
		const base = overridden ?? (this.options.requireSnapshotOverride ? unavailableSnapshot(this.options.provider.id) : await this.options.provider.getSnapshot());
		this.options.onLibrarySnapshot?.(base);
		if (base.status !== 'complete') return { snapshot: base };
		const enrichments = await Promise.all((this.options.enrichers ?? []).map((enricher) => this.runEnricher(enricher, base)));
		const snapshot = mergeEnrichmentResults(base, enrichments);
		const revision = `${base.revision ?? 'base'}:${enrichedRevision(snapshot.games, enrichments)}`;
		return { snapshot, enrichments, plan: await planCanonicalSync(snapshot.games, { ...this.options.planner, protectedCanonicalProperties: unavailableEnrichmentProperties(enrichments) }, revision) };
	}

	async sync(selectedOperationIds?: readonly string[]): Promise<{ preview: CanonicalPreviewResult; appliedOperationIds: readonly string[] }> {
		const preview = await this.preview();
		const appliedOperationIds = await this.applyPreview(preview, selectedOperationIds);
		return { preview, appliedOperationIds };
	}

	async applyPreview(preview: CanonicalPreviewResult, selectedOperationIds?: readonly string[]): Promise<readonly string[]> {
		if (preview.snapshot.status !== 'complete' || preview.plan === undefined) {
			throw new CanonicalProviderError('Library snapshot is not complete; no vault changes were made.');
		}
		const currentBase = this.options.snapshotOverride?.() ?? await this.options.provider.getSnapshot();
		if (currentBase.status !== 'complete') {
			throw new CanonicalProviderError('The library snapshot is no longer complete; this preview is no longer valid. Preview the sync again.');
		}
		const currentResults = await Promise.all((this.options.enrichers ?? []).map((enricher) => this.runEnricher(enricher, currentBase)));
		const currentSnapshot = mergeEnrichmentResults(currentBase, currentResults);
		const currentRevision = `${currentBase.revision ?? 'base'}:${enrichedRevision(currentSnapshot.games, currentResults)}`;
		if (currentRevision !== preview.plan.planRevision) {
			throw new CanonicalProviderError('The library source changed; this preview is no longer valid. Preview the sync again.');
		}
		return this.options.writer.apply(preview.plan, selectedOperationIds);
	}

	private async runEnricher(enricher: GameEnricher, snapshot: CanonicalLibrarySnapshot): Promise<GameEnrichmentResult> {
		try {
			return await enricher.enrich(snapshot);
		} catch (error) {
			return { source: enricher.id, status: 'failed', retrievedAt: new Date().toISOString(), patches: [], diagnostics: [{ code: 'ENRICHER_FAILED', message: error instanceof Error ? error.message : 'The optional enrichment failed.' }] };
		}
	}
}

function unavailableSnapshot(provider: string): CanonicalLibrarySnapshot {
	return { status: 'failed', games: [], diagnostics: { provider, database: 'unavailable', schema: 'unknown', gamesRead: 0, gamesNormalized: 0, diagnostics: [{ code: 'SNAPSHOT_CACHE_EMPTY', message: 'No previously imported library snapshot is available for background enrichment.' }] } };
}

function enrichedRevision(games: readonly import('../model/canonical-game').CanonicalGame[], results: readonly GameEnrichmentResult[]): string {
	let value = 2166136261;
	const input = JSON.stringify({ games, results: results.map((result) => ({ source: result.source, status: result.status, fingerprint: result.fingerprint, patches: result.patches })) });
	for (const character of input) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
	return (value >>> 0).toString(16).padStart(8, '0');
}

function unavailableEnrichmentProperties(results: readonly GameEnrichmentResult[]): readonly import('../vault/canonical-projection').CanonicalPropertyKey[] {
	return results.some((result) => result.status !== 'success')
		? ['lastPlayed', 'achievementsUnlocked', 'achievementsTotal', 'achievementPercentage']
		: [];
}
