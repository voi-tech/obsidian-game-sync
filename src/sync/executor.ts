import type { NormalizedGame } from '../model/game';
import type { Operation, SyncPlan } from '../model/operations';
import { VaultConflictError } from '../network/errors';
import { VaultWriter } from '../vault/writer';

export type ExecutorHook = (game: NormalizedGame, operation: Operation) => void | Promise<void>;

export interface ExecutorProgress {
	noteApplied: boolean;
	noteFingerprintAfter?: string;
	providerStateApplied: boolean;
	historyApplied: boolean;
	cacheApplied: boolean;
}

export interface SyncExecutorOptions {
	writer: VaultWriter;
	games: readonly NormalizedGame[] | Readonly<Record<string, NormalizedGame>>;
	currentRevision?: string | (() => string | Promise<string>);
	currentNoteFingerprints?: Readonly<Record<string, string | null | undefined>> | (() => Readonly<Record<string, string | null | undefined>> | Promise<Readonly<Record<string, string | null | undefined>>>);
	onProviderState?: ExecutorHook;
	onHistory?: ExecutorHook;
	onCache?: ExecutorHook;
	initialProgress?: Readonly<Record<string, ExecutorProgress>>;
	onBeforeNote?: (operation: Operation, game: NormalizedGame) => void | Promise<void>;
	onProgress?: (operation: Operation, progress: ExecutorProgress, game: NormalizedGame) => void | Promise<void>;
}

export interface ApplyResult {
	appliedOperationIds: string[];
	pendingOperationIds: string[];
	deselectedOperationIds: string[];
	failedOperationIds: string[];
}

function operationGame(games: SyncExecutorOptions['games'], canonicalGameId: string): NormalizedGame | undefined {
	if (Array.isArray(games)) {
		const gameList = games as readonly NormalizedGame[];
		return gameList.find((game: NormalizedGame) => game.canonicalId === canonicalGameId);
	}
	const gameMap = games as Readonly<Record<string, NormalizedGame>>;
	return gameMap[canonicalGameId];
}

export class SyncExecutor {
	private readonly completed = new Set<string>();
	private readonly progress = new Map<string, ExecutorProgress>();

	constructor(private readonly options: SyncExecutorOptions) {
		for (const [operationId, progress] of Object.entries(options.initialProgress ?? {})) {
			const copy = { ...progress };
			this.progress.set(operationId, copy);
			if (copy.noteApplied && copy.providerStateApplied && copy.historyApplied && copy.cacheApplied) this.completed.add(operationId);
		}
	}

	private async reportProgress(operation: Operation, progress: ExecutorProgress, game: NormalizedGame): Promise<void> {
		this.progress.set(operation.id, progress);
		if (this.options.onProgress !== undefined) await this.options.onProgress(operation, { ...progress }, game);
	}

	private async currentRevision(plan: SyncPlan): Promise<string> {
		if (this.options.currentRevision === undefined) return plan.planRevision;
		return typeof this.options.currentRevision === 'function' ? await this.options.currentRevision() : this.options.currentRevision;
	}

	private async currentFingerprints(): Promise<Readonly<Record<string, string | null | undefined>> | undefined> {
		const source = this.options.currentNoteFingerprints;
		if (source === undefined) return undefined;
		return typeof source === 'function' ? await source() : source;
	}

	private async applyNote(operation: Operation, game: NormalizedGame): Promise<void> {
		if (operation.kind === 'create-note') {
			await this.options.writer.createNote({ path: operation.path, game, expectedNoteFingerprint: null });
			return;
		}
		if (operation.kind === 'adopt-note') {
			await this.options.writer.adoptNote({ path: operation.path, game, expectedNoteFingerprint: operation.expectedNoteFingerprint });
			return;
		}
		if (operation.kind === 'update-properties' || operation.kind === 'add-achievement-block' || operation.kind === 'update-achievement-block') {
			await this.options.writer.updateNote({ path: operation.path, game, expectedNoteFingerprint: operation.expectedNoteFingerprint });
			return;
		}
		throw new Error(`Unsupported sync operation ${operation.kind}.`);
	}

	async apply(plan: SyncPlan, selectedOperationIds?: readonly string[]): Promise<ApplyResult> {
		const currentRevision = await this.currentRevision(plan);
		const fingerprints = await this.currentFingerprints();
		const selected = selectedOperationIds === undefined ? new Set(plan.operations.map((operation) => operation.id)) : new Set(selectedOperationIds);
		const selectedOperations = plan.operations.filter((operation) => selected.has(operation.id));
		const revisionStale = currentRevision !== plan.planRevision;
		if (revisionStale) throw new VaultConflictError('Sync plan is stale; prepare a new plan.');
		const staleForNewNoteWork = selectedOperations.some((operation) => {
			const progress = this.progress.get(operation.id);
			const noteApplied = progress?.noteApplied === true;
			const pathMismatch = fingerprints !== undefined && operation.path !== undefined && (fingerprints[operation.path] ?? null) !== operation.expectedNoteFingerprint;
			const postWriteMismatch = fingerprints !== undefined && noteApplied && progress?.noteFingerprintAfter !== undefined && operation.path !== undefined && (fingerprints[operation.path] ?? null) !== progress.noteFingerprintAfter;
			return postWriteMismatch || (!noteApplied && pathMismatch);
		});
		if (staleForNewNoteWork) {
			throw new VaultConflictError('Sync plan is stale; prepare a new plan.');
		}
		const appliedOperationIds: string[] = [];
		const failedOperationIds: string[] = [];
		const pendingOperationIds: string[] = [];
		const deselectedOperationIds: string[] = [];

		for (const operation of plan.operations) {
			if (this.completed.has(operation.id)) continue;
			if (!selected.has(operation.id)) {
				pendingOperationIds.push(operation.id);
				deselectedOperationIds.push(operation.id);
				continue;
			}
			const game = operationGame(this.options.games, operation.canonicalGameId);
			if (game === undefined) {
				pendingOperationIds.push(operation.id);
				failedOperationIds.push(operation.id);
				continue;
			}
			try {
				const progress = this.progress.get(operation.id) ?? {
					noteApplied: false,
					providerStateApplied: false,
					historyApplied: false,
					cacheApplied: false,
				};
				if (!progress.noteApplied) {
					if (this.options.onBeforeNote !== undefined) await this.options.onBeforeNote(operation, game);
					await this.applyNote(operation, game);
					progress.noteApplied = true;
					const afterWriteFingerprints = await this.currentFingerprints();
					if (afterWriteFingerprints !== undefined && operation.path !== undefined) {
						const fingerprintAfter = afterWriteFingerprints[operation.path];
						if (fingerprintAfter === undefined || fingerprintAfter === null) throw new VaultConflictError(`Written note is missing after ${operation.path} was updated.`);
						progress.noteFingerprintAfter = fingerprintAfter;
					}
					await this.reportProgress(operation, progress, game);
				}
				if (!progress.providerStateApplied) {
					if (this.options.onProviderState !== undefined) await this.options.onProviderState(game, operation);
					progress.providerStateApplied = true;
					await this.reportProgress(operation, progress, game);
				}
				if (!progress.historyApplied) {
					if (this.options.onHistory !== undefined) await this.options.onHistory(game, operation);
					progress.historyApplied = true;
					await this.reportProgress(operation, progress, game);
				}
				if (!progress.cacheApplied) {
					if (this.options.onCache !== undefined) await this.options.onCache(game, operation);
					progress.cacheApplied = true;
					await this.reportProgress(operation, progress, game);
				}
				this.completed.add(operation.id);
				appliedOperationIds.push(operation.id);
			} catch {
				pendingOperationIds.push(operation.id);
				failedOperationIds.push(operation.id);
			}
		}
		for (const operation of plan.operations) {
			if (!this.completed.has(operation.id) && !pendingOperationIds.includes(operation.id)) pendingOperationIds.push(operation.id);
		}
		return { appliedOperationIds, pendingOperationIds, deselectedOperationIds, failedOperationIds };
	}

	async execute(plan: SyncPlan, selectedOperationIds?: readonly string[]): Promise<ApplyResult> {
		return this.apply(plan, selectedOperationIds);
	}
}
