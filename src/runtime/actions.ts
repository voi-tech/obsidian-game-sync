import type { LibrarySummaryViewModel } from '../model/library-summary';
import { buildLibrarySummary } from '../model/library-summary';
import type { GameProvider } from '../model/provider';
import type { GameSyncData } from '../state/schema';
import type { StateStore } from '../state/store';
import type { BackgroundSyncService } from '../sync/scheduler';
import type { PreparedSync, SyncApplyResult } from '../sync/service';
import type { ReviewDecision } from '../ui/preview-modal';
import type { GameSyncRuntimeComposition } from './composition';
import type { GameSyncCommandActions } from './commands';

export type RuntimeSummary = SyncApplyResult | LibrarySummaryViewModel;

export interface RuntimeUiPort {
	openPreview(
		prepared: PreparedSync,
		onApply: (prepared: PreparedSync, selectedOperationIds: readonly string[]) => void | PromiseLike<void>,
		onReviewDecision: (decision: ReviewDecision) => void | PromiseLike<void>,
	): void | PromiseLike<void>;
	openSummary(
		summary: RuntimeSummary,
		onOpenBase: () => void | PromiseLike<void>,
		onSyncNow: () => void | PromiseLike<void>,
	): void | PromiseLike<void>;
	openIgnoredGames(): void | PromiseLike<void>;
	openSetupWizard(): void | PromiseLike<void>;
	copyDiagnostics(): void | PromiseLike<void>;
	showUnavailable(commandId: string): void | PromiseLike<void>;
}

export interface GameSyncCommandActionsOptions {
	composition: GameSyncRuntimeComposition;
	ui: RuntimeUiPort;
	stateStore?: StateStore;
	getBackgroundService?: () => BackgroundSyncService | undefined;
	runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>;
}

type ProviderScope = readonly GameProvider[] | undefined;

function createLock(): <T>(operation: () => Promise<T>) => Promise<T> {
	let tail = Promise.resolve();
	return <T>(operation: () => Promise<T>): Promise<T> => {
		const previous = tail;
		let release!: () => void;
		tail = new Promise<void>((resolve) => { release = resolve; });
		return previous.then(operation).finally(release);
	};
}

function noop(): void {}

export function createGameSyncCommandActions(options: GameSyncCommandActionsOptions): GameSyncCommandActions {
	const runExclusive = options.runExclusive ?? createLock();
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
			async () => undefined,
		);
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

	actions.syncAll = () => openPreview(undefined, false);
	actions.syncSteam = () => openPreview(['steam'], false);
	actions.syncPlayStation = () => openPreview(['playstation'], false);
	actions.previewAllChanges = () => openPreview(undefined, false);
	actions.previewSteamChanges = () => openPreview(['steam'], false);
	actions.previewPlayStationChanges = () => openPreview(['playstation'], false);
	actions.reviewPendingMatches = () => openPreview(undefined, false);
	actions.manageGameMatches = () => options.ui.showUnavailable('manage-game-matches');
	actions.manageIgnoredGames = () => options.ui.openIgnoredGames();
	actions.openLibrarySummary = openLibrarySummary;
	actions.forceRefreshAllData = () => openPreview(undefined, true);
	actions.copyDiagnosticInformation = () => options.ui.copyDiagnostics();
	actions.runSetupWizard = () => options.ui.openSetupWizard();

	return actions;
}
