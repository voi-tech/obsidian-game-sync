import type { PreparedSync, SyncApplyResult, SyncService } from '../sync/service';
import type { CanonicalPreviewResult, CanonicalSyncService } from '../sync/canonical-service';
import type { CanonicalSyncSelection } from '../sync/canonical-planner';
import type { SyncExecutor, SyncExecutorAttention, SyncExecutorPreview } from '../sync/background-executor';

function legacyAttention(prepared: PreparedSync): SyncExecutorAttention[] {
		return prepared.plan.statuses
			.filter((status) => status.status === 'review' || status.status === 'conflict')
			.map((status) => ({
				id: status.canonicalGameId,
				kind: status.status === 'review' ? 'review' as const : 'conflict' as const,
				reason: status.reason ?? 'The item requires explicit review.',
			}));
}

function legacyPreview(prepared: PreparedSync): SyncExecutorPreview {
	const providerStatuses = Object.values(prepared.providerStatuses).map((status) => ({ id: status.provider, state: status.state }));
	const status = providerStatuses.some((candidate) => candidate.state === 'failed')
		? 'failed' as const
		: providerStatuses.some((candidate) => candidate.state === 'partial') ? 'partial' as const : 'complete' as const;
	return {
		status,
		operations: prepared.plan.operations.map((operation) => ({ id: operation.id, risk: operation.risk })),
		attention: legacyAttention(prepared),
		warnings: [...prepared.warnings],
		gamesFetched: prepared.gamesFetched,
		providerStatuses,
		approvalRequired: prepared.previewRequired,
		token: prepared,
	};
}

function legacyResult(result: SyncApplyResult) {
	return {
		appliedOperationIds: [...result.operationsAppliedIds],
		pendingOperationIds: [...result.pendingOperationIds],
		warnings: [...result.warnings],
	};
}

export function createLegacySyncExecutor(service: SyncService): SyncExecutor {
	return {
		async preview() {
			return legacyPreview(await service.prepareAll());
		},
		async apply(preview, selectedOperationIds) {
			const prepared = preview.token as PreparedSync;
			return legacyResult(await service.applySelection(prepared, selectedOperationIds, { background: true }));
		},
	};
}

function canonicalAttention(preview: CanonicalPreviewResult): SyncExecutorAttention[] {
	return (preview.plan?.statuses ?? [])
		.filter((status) => status.status === 'conflict')
		.map((status) => ({ id: status.canonicalKey, kind: 'conflict' as const, reason: status.reason ?? 'The item requires explicit review.' }));
}

function canonicalSelection(preview: CanonicalPreviewResult, operationIds: readonly string[]): CanonicalSyncSelection {
	const operations = preview.plan?.operations ?? [];
	return {
		operationIds: [...operationIds],
		fieldIdsByOperation: Object.fromEntries(operationIds.map((operationId) => [
			operationId,
			operations.find((operation) => operation.id === operationId)?.preview.changes.map((change) => change.fieldId) ?? [],
		])),
	};
}

export function createCanonicalSyncExecutor(service: CanonicalSyncService, isApproved: () => boolean): SyncExecutor {
	return {
		async preview() {
			const result = await service.preview();
			const providerState = result.snapshot.status === 'complete' ? 'success' as const : result.snapshot.status;
			const enrichmentStatuses = (result.enrichments ?? []).map((enrichment) => ({ id: enrichment.source, state: enrichment.status === 'success' ? 'success' as const : enrichment.status }));
			return {
				status: result.snapshot.status,
				operations: (result.plan?.operations ?? []).map((operation) => ({ id: operation.id, risk: operation.risk })),
				attention: canonicalAttention(result),
				warnings: [
					...result.snapshot.diagnostics.diagnostics.map((diagnostic) => diagnostic.message),
					...(result.enrichments ?? []).flatMap((enrichment) => enrichment.diagnostics.map((diagnostic) => diagnostic.message)),
				],
				gamesFetched: result.snapshot.games.length,
				providerStatuses: [{ id: result.snapshot.diagnostics.provider, state: providerState }, ...enrichmentStatuses],
				approvalRequired: !isApproved(),
				token: result,
			};
		},
		async apply(preview, selectedOperationIds) {
			if (preview.approvalRequired) throw new Error('Background sync requires explicit preview approval.');
			const canonicalPreview = preview.token as CanonicalPreviewResult;
			const result = await service.applyPreview(canonicalPreview, canonicalSelection(canonicalPreview, selectedOperationIds));
			return { appliedOperationIds: [...result], pendingOperationIds: [], warnings: [] };
		},
	};
}
