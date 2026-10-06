import type { CanonicalLibrarySnapshot, LibraryProvider } from '../model/canonical-provider';
import { mergeEnrichmentResults, type GameEnricher, type GameEnrichmentResult } from '../model/enrichment';
import { planCanonicalSync, type CanonicalSyncPlan, type CanonicalSyncPlannerOptions, type CanonicalSyncSelection } from './canonical-planner';
import { CanonicalVaultWriter } from '../vault/canonical-writer';
import { canonicalGameFingerprint } from './canonical-state';

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
	readonly configurationRevision?: string;
	readonly readConfigurationRevision?: () => Promise<string>;
	readonly isActive?: () => boolean;
}

export class CanonicalSyncService {
	private readonly previews = new WeakSet<CanonicalPreviewResult>();
	constructor(private readonly options: CanonicalSyncServiceOptions) {}

	async preview(): Promise<CanonicalPreviewResult> {
		await this.assertCurrent();
		const overridden = this.options.snapshotOverride?.();
		const base = overridden ?? (this.options.requireSnapshotOverride ? unavailableSnapshot(this.options.provider.id) : await this.options.provider.getSnapshot());
		await this.assertCurrent();
		this.options.onLibrarySnapshot?.(base);
		if (base.status !== 'complete') return { snapshot: base };
		const enrichments = await Promise.all((this.options.enrichers ?? []).map((enricher) => this.runEnricher(enricher, base)));
		const snapshot = mergeEnrichmentResults(base, enrichments);
		await this.assertCurrent();
		const revision = `${base.revision ?? 'base'}:${enrichedRevision(snapshot.games, enrichments)}`;
		const preview = { snapshot, enrichments, plan: await planCanonicalSync(snapshot.games, { ...this.options.planner, protectedCanonicalProperties: unavailableEnrichmentProperties(enrichments) }, revision) };
		await this.assertCurrent();
		this.previews.add(preview);
		return preview;
	}

	async sync(selection?: CanonicalSyncSelection): Promise<{ preview: CanonicalPreviewResult; appliedOperationIds: readonly string[] }> {
		const preview = await this.preview();
		const appliedOperationIds = await this.applyPreview(preview, selection);
		return { preview, appliedOperationIds };
	}

	async applyPreview(preview: CanonicalPreviewResult, selection?: CanonicalSyncSelection): Promise<readonly string[]> {
		await this.assertCurrent();
		if (preview.snapshot.status !== 'complete' || preview.plan === undefined) {
			throw new CanonicalProviderError('Library snapshot is not complete; no vault changes were made.');
		}
		if (!this.previews.has(preview)) throw new CanonicalProviderError('This preview belongs to another sync service. Preview the sync again.');
		const currentBase = this.options.snapshotOverride?.() ?? await this.options.provider.getSnapshot();
		await this.assertCurrent();
		if (currentBase.status !== 'complete') {
			throw new CanonicalProviderError('The library snapshot is no longer complete; this preview is no longer valid. Preview the sync again.');
		}
		const currentResults = await Promise.all((this.options.enrichers ?? []).map((enricher) => this.runEnricher(enricher, currentBase)));
		const currentSnapshot = mergeEnrichmentResults(currentBase, currentResults);
		await this.assertCurrent();
		const currentRevision = `${currentBase.revision ?? 'base'}:${enrichedRevision(currentSnapshot.games, currentResults)}`;
		if (currentRevision !== preview.plan.planRevision) {
			throw new CanonicalProviderError('The library source changed; this preview is no longer valid. Preview the sync again.');
		}
		return this.options.writer.apply(preview.plan, selection, () => this.assertCurrent());
	}

	private async assertCurrent(): Promise<void> {
		if (this.options.isActive?.() === false) throw new CanonicalProviderError('Sync runtime is inactive; no further writes will be made.');
		if (this.options.readConfigurationRevision !== undefined && await this.options.readConfigurationRevision() !== this.options.configurationRevision) {
			throw new CanonicalProviderError('Sync configuration changed. Preview the sync again.');
		}
		if (this.options.isActive?.() === false) throw new CanonicalProviderError('Sync runtime is inactive; no further writes will be made.');
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
	const input = JSON.stringify({ games: games.map(canonicalGameFingerprint).sort(), results: results.map((result) => ({ source: result.source, status: result.status })) });
	for (const character of input) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
	return (value >>> 0).toString(16).padStart(8, '0');
}

function unavailableEnrichmentProperties(results: readonly GameEnrichmentResult[]): readonly import('../vault/canonical-projection').CanonicalPropertyKey[] {
	const protectedProperties = new Set<import('../vault/canonical-projection').CanonicalPropertyKey>();
	for (const result of results) {
		if (result.status === 'success') continue;
		if (result.source === 'steam') {
			for (const key of ['steamPlaytime', 'steamLastPlayed', 'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress'] as const) protectedProperties.add(key);
		}
		if (result.source === 'playstation') {
			for (const key of ['playstationPlaytime', 'playstationLastPlayed', 'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum'] as const) protectedProperties.add(key);
		}
	}
	return [...protectedProperties];
}
