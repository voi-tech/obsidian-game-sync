import type { LibrarySummaryViewModel } from '../model/library-summary';
import { buildLibrarySummary } from '../model/library-summary';
import type { GameProvider } from '../model/provider';
import type { GameSyncData } from '../state/schema';
import type { StateStore } from '../state/store';
import type { PreparedSync, SyncApplyResult } from '../sync/service';
import type { ReviewDecision } from '../ui/preview-modal';
import type { GameSyncRuntimeComposition } from './composition';
import type { GameSyncCommandActions } from './commands';
import type { MatchManagerAdapter } from '../model/match-manager';
import type { CanonicalPreviewResult } from '../sync/canonical-service';
import { createSyncConcurrencyGuard, type SyncExclusiveRunner } from '../sync/concurrency';

export type RuntimeSummary = SyncApplyResult | LibrarySummaryViewModel;

export interface RuntimeUiPort {
	openPreview(
		prepared: PreparedSync,
		onApply: (prepared: PreparedSync, selectedOperationIds: readonly string[]) => void | PromiseLike<void>,
		onReviewDecision: (decision: ReviewDecision) => void | PromiseLike<void>,
	): void | PromiseLike<void>;
	openCanonicalPreview?: (
		preview: CanonicalPreviewResult,
		onApply: (operationIds: readonly string[]) => void | PromiseLike<void>,
	) => void | PromiseLike<void>;
	openSummary(
		summary: RuntimeSummary,
		onOpenBase: () => void | PromiseLike<void>,
		onSyncNow: () => void | PromiseLike<void>,
	): void | PromiseLike<void>;
	openIgnoredGames(): void | PromiseLike<void>;
	openSetupWizard(): void | PromiseLike<void>;
	copyDiagnostics(): void | PromiseLike<void>;
	openMatchManager(adapter: MatchManagerAdapter): void | PromiseLike<void>;
	showUnavailable(commandId: string): void | PromiseLike<void>;
}

export interface GameSyncCommandActionsOptions {
	composition: GameSyncRuntimeComposition;
	ui: RuntimeUiPort;
	stateStore?: StateStore;
	runExclusive?: SyncExclusiveRunner;
}

type ProviderScope = readonly GameProvider[] | undefined;

function noop(): void {}

export function createGameSyncCommandActions(options: GameSyncCommandActionsOptions): GameSyncCommandActions {
	const runExclusive = options.runExclusive ?? createSyncConcurrencyGuard();
	const actions = {} as GameSyncCommandActions;

	const openPreview = async (scope: ProviderScope, force: boolean): Promise<void> => {
		const { service, prepared } = await runExclusive(async () => {
			const service = await options.composition.createService(scope);
			const prepared = await service.prepareAll(force ? { force: true } : {});
			return { service, prepared };
		});

		await options.ui.openPreview(
			prepared,
			(preview, selectedOperationIds) => runExclusive(async () => service.applySelection(preview, selectedOperationIds, { explicit: true }))
				.then((result) => options.ui.openSummary(result, noop, () => actions.syncAll()))
				.then(() => undefined),
			(decision) => runExclusive(async () => { await service.applyReviewDecision?.(decision); }),
		);
	};

	const openSelectedPreview = async (force: boolean): Promise<void> => {
		if (options.stateStore !== undefined) {
			const state = await options.stateStore.load();
			if (state.settings.libraryProvider !== undefined) {
				if (options.ui.openCanonicalPreview === undefined) {
					await options.ui.showUnavailable(`${state.settings.libraryProvider}-preview`);
					return;
				}
				const prepared = await runExclusive(async () => {
					const service = await options.composition.createCanonicalService();
					if (service === undefined) return undefined;
					return { service, preview: await service.preview() };
				});
				if (prepared === undefined) {
					await options.ui.showUnavailable(state.settings.libraryProvider);
					return;
				}
				await options.ui.openCanonicalPreview(prepared.preview, (operationIds) => runExclusive(async () => {
					await prepared.service.applyPreview(prepared.preview, operationIds);
					await markGameTrackImport();
					await options.composition.approveCanonicalBackgroundSync();
				}));
				return;
			}
		}
		await openPreview(undefined, force);
	};

	const markGameTrackImport = async (): Promise<void> => {
		if (options.stateStore === undefined) return;
		const state = await options.stateStore.load();
		if (state.settings.libraryProvider !== 'gametrack') return;
		state.settings.gametrackLastImportedAt = new Date().toISOString();
		await options.stateStore.save(state);
	};

	const openLibrarySummary = async (): Promise<void> => {
		const summary = await runExclusive(async () => {
			let state: GameSyncData;
			if (options.stateStore !== undefined) state = await options.stateStore.load();
			else {
				const compositionWithState = options.composition as GameSyncRuntimeComposition & {
					getState?: () => Promise<GameSyncData>;
				};
				state = compositionWithState.getState === undefined
					? await (await options.composition.createService(undefined)).getState()
					: await compositionWithState.getState();
			}
			return buildLibrarySummary(state);
		});

		await options.ui.openSummary(summary, noop, () => actions.syncAll());
	};

	actions.syncAll = () => openSelectedPreview(false);
	actions.previewAllChanges = () => openSelectedPreview(false);
	actions.reviewPendingMatches = () => openSelectedPreview(false);
	actions.manageGameMatches = async () => {
		const adapter = await runExclusive(() => options.composition.createMatchManager());
		await options.ui.openMatchManager(adapter);
	};
	actions.manageIgnoredGames = () => options.ui.openIgnoredGames();
	actions.openLibrarySummary = openLibrarySummary;
	actions.forceRefreshAllData = () => openSelectedPreview(true);
	actions.copyDiagnosticInformation = () => options.ui.copyDiagnostics();
	actions.runSetupWizard = () => options.ui.openSetupWizard();

	return actions;
}
