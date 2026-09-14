import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { GameOperationKind, Operation } from '../model/operations';
import type { ProviderStatusSummary, SyncApplyResult } from '../sync/service';

export interface SyncSummaryViewModel {
	providerStatuses: Readonly<Partial<Record<'steam' | 'playstation', ProviderStatusSummary>>>;
	gamesFetched?: number;
	operations: readonly Pick<Operation, 'id' | 'kind'>[];
	appliedOperationIds: readonly string[];
	pendingOperationIds: readonly string[];
	deselectedOperationIds: readonly string[];
	ignored: number;
	warnings: readonly string[];
	unlockedCount?: number;
	notesFolder?: string;
}

export interface SummaryModalInjected {
	t?: (key: string, params?: Record<string, string | number>) => string;
}

export interface SummaryModalOptions {
	result?: SyncApplyResult;
	viewModel?: SyncSummaryViewModel;
	notesFolder?: string;
	onClose?: () => void | Promise<void>;
	onOpenGames?: () => void | Promise<void>;
	injected?: SummaryModalInjected;
}

type SummaryInput = SummaryModalOptions | SyncApplyResult | SyncSummaryViewModel;

function translation(injected: SummaryModalInjected | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
	return injected?.t?.(key, params) ?? t(key, params as never);
}

function isApplyResult(input: SyncApplyResult | SyncSummaryViewModel): input is SyncApplyResult {
	return 'plan' in input;
}

function isOptions(input: SummaryInput): input is SummaryModalOptions {
	return 'result' in input || 'viewModel' in input;
}

function viewModelFrom(input: SummaryInput): { viewModel: SyncSummaryViewModel; onClose?: () => void | Promise<void>; onOpenGames?: () => void | Promise<void>; injected?: SummaryModalInjected } {
	if (isOptions(input)) {
		const source = input.result ?? input.viewModel;
		if (source === undefined) throw new Error('Summary input is required.');
		const viewModel = isApplyResult(source) ? fromResult(source) : { ...source };
		if (input.notesFolder !== undefined) viewModel.notesFolder = input.notesFolder;
		return {
			viewModel,
			onClose: input.onClose,
			onOpenGames: input.onOpenGames,
			injected: input.injected,
		};
	}
	return { viewModel: isApplyResult(input) ? fromResult(input) : input };
}

function fromResult(result: SyncApplyResult): SyncSummaryViewModel {
	return {
		providerStatuses: result.providerStatuses,
		gamesFetched: result.gamesFetched,
		operations: result.plan.operations,
		appliedOperationIds: result.operationsAppliedIds,
		pendingOperationIds: result.pendingOperationIds,
		deselectedOperationIds: result.deselectedOperationIds,
		ignored: result.ignored,
		warnings: result.warnings,
	};
}

function countApplied(viewModel: SyncSummaryViewModel, kinds: readonly GameOperationKind[]): number {
	const applied = new Set(viewModel.appliedOperationIds);
	return viewModel.operations.filter((operation) => applied.has(operation.id) && kinds.includes(operation.kind)).length;
}

export class SummaryModal extends Modal {
	private readonly viewModel: SyncSummaryViewModel;
	private readonly injected?: SummaryModalInjected;
	private readonly closeCallback?: () => void | Promise<void>;
	private readonly openGamesCallback?: () => void | Promise<void>;
	private closeNotified = false;

	constructor(app: App, input: SummaryInput) {
		super(app);
		const normalized = viewModelFrom(input);
		this.viewModel = normalized.viewModel;
		this.injected = normalized.injected;
		this.closeCallback = normalized.onClose;
		this.openGamesCallback = normalized.onOpenGames;
	}

	override onOpen(): void {
		this.closeNotified = false;
		this.setTitle(translation(this.injected, 'sync.summary.title'));
		this.contentEl.replaceChildren();
		this.render();
	}

	override onClose(): void {
		if (this.closeNotified) return;
		this.closeNotified = true;
		if (this.closeCallback !== undefined) void Promise.resolve(this.closeCallback()).catch(() => undefined);
	}

	private render(): void {
		const intro = this.contentEl.createEl('p');
		intro.textContent = translation(this.injected, 'sync.summary.ready');

		const metrics = this.contentEl.createEl('section');
		metrics.dataset.summaryMetrics = 'true';
		this.metric(metrics, 'gameNotesCreated', countApplied(this.viewModel, ['create-note']));
		this.metric(metrics, 'notesUpdated', countApplied(this.viewModel, ['adopt-note', 'update-properties', 'link-providers']));
		this.metric(metrics, 'achievementsAdded', countApplied(this.viewModel, ['add-achievement-block']));

		const destination = this.contentEl.createEl('p');
		destination.dataset.summaryDestination = 'true';
		destination.textContent = `${translation(this.injected, 'sync.summary.savedIn')} ${this.viewModel.notesFolder ?? 'Games'}/`;

		if (this.viewModel.warnings.length > 0) {
			const warnings = this.contentEl.createEl('section');
			warnings.dataset.summaryWarnings = 'true';
			for (const warning of this.viewModel.warnings) {
				const item = this.contentEl.createEl('p');
				item.dataset.summaryWarning = 'true';
				item.textContent = warning;
			}
		}

		const footer = new Setting(this.contentEl);
		footer.settingEl.dataset.gameSyncActionRow = 'true';
		if (this.openGamesCallback !== undefined) {
			footer.addButton((button) => {
				button.setButtonText(translation(this.injected, 'sync.summary.openGames'));
				button.buttonEl.dataset.summaryOpenGames = 'true';
				button.onClick(() => void this.openGamesCallback?.());
			});
		}
		footer.addButton((button) => {
			button.setButtonText(translation(this.injected, 'sync.summary.done'));
			button.setCta();
			button.buttonEl.dataset.summaryDone = 'true';
			button.onClick(() => this.close());
		});
	}

	private metric(parent: HTMLElement, key: 'gameNotesCreated' | 'notesUpdated' | 'achievementsAdded', value: number): void {
		const row = parent.createEl('p');
		row.dataset[`summary${key[0].toUpperCase()}${key.slice(1)}` as 'summaryGameNotesCreated'] = String(value);
		row.textContent = translation(this.injected, `sync.summary.${key}` as TranslationKey, { count: value });
	}
}

export { SummaryModal as GameSyncSummaryModal };
