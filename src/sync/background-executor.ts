export type SyncExecutorSnapshotStatus = 'complete' | 'partial' | 'failed';
export type SyncExecutorOperationRisk = 'safe' | 'review';
export type SyncExecutorProviderState = 'success' | 'partial' | 'failed';

export interface SyncExecutorOperation {
	readonly id: string;
	readonly risk: SyncExecutorOperationRisk;
}

export interface SyncExecutorAttention {
	readonly id: string;
	readonly kind: 'review' | 'conflict' | 'warning';
	readonly reason: string;
}

export interface SyncExecutorProviderStatus {
	readonly id: string;
	readonly state: SyncExecutorProviderState;
}

export interface SyncExecutorPreview {
	readonly status: SyncExecutorSnapshotStatus;
	readonly operations: readonly SyncExecutorOperation[];
	readonly attention: readonly SyncExecutorAttention[];
	readonly warnings: readonly string[];
	readonly gamesFetched: number;
	readonly providerStatuses: readonly SyncExecutorProviderStatus[];
	readonly approvalRequired: boolean;
	/** Opaque plan handle owned by the executor; the scheduler must not inspect it. */
	readonly token: unknown;
}

export interface SyncExecutorResult {
	readonly appliedOperationIds: readonly string[];
	readonly pendingOperationIds: readonly string[];
	readonly warnings: readonly string[];
}

export interface SyncExecutor {
	preview(): Promise<SyncExecutorPreview>;
	apply(preview: SyncExecutorPreview, selectedOperationIds: readonly string[]): Promise<SyncExecutorResult>;
	/** Returns whether this executor has work that may be started by the background scheduler. */
	canRunAutomatically?(): boolean | Promise<boolean>;
}
