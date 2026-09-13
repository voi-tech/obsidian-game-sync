import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { GameProvider } from '../model/provider';
import type { GameOperationKind, Operation } from '../model/operations';
import type { ProviderStatusSummary, SyncApplyResult } from '../sync/service';

export interface SyncSummaryViewModel {
	providerStatuses: Readonly<Partial<Record<GameProvider, ProviderStatusSummary>>>;
	gamesFetched?: number;
	operations: readonly Pick<Operation, 'id' | 'kind'>[];
	appliedOperationIds: readonly string[];
	pendingOperationIds: readonly string[];
	deselectedOperationIds: readonly string[];
	ignored: number;
	warnings: readonly string[];
	unlockedCount?: number;
}

export interface SummaryModalInjected {
	t?: (key: string, params?: Record<string, string | number>) => string;
}

export interface SummaryModalOptions {
	result?: SyncApplyResult;
	viewModel?: SyncSummaryViewModel;
	onClose?: () => void | Promise<void>;
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

function viewModelFrom(input: SummaryInput): { viewModel: SyncSummaryViewModel; onClose?: () => void | Promise<void>; injected?: SummaryModalInjected } {
	if (isOptions(input)) {
		const options = input;
		const source = options.result ?? options.viewModel;
		if (source === undefined) throw new Error('Summary input is required.');
		return { viewModel: isApplyResult(source) ? fromResult(source) : source, onClose: options.onClose, injected: options.injected };
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
	private closeNotified = false;

	constructor(app: App, input: SummaryInput) {
		super(app);
		const normalized = viewModelFrom(input);
		this.viewModel = normalized.viewModel;
		this.injected = normalized.injected;
		this.closeCallback = normalized.onClose;
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
		const providers = this.element('section');
		providers.dataset.summaryProviders = 'true';
		for (const provider of ['steam', 'playstation'] as const) {
			const status = this.viewModel.providerStatuses[provider];
			if (status === undefined) continue;
			const row = new Setting(providers).setName(translation(this.injected, `sync.providers.${provider}` as TranslationKey));
			row.settingEl.dataset.summaryProvider = provider;
			const label = `${this.statusLabel(status.state)} · ${status.gamesFetched}`;
			row.setDesc(label);
			row.settingEl.textContent = `${translation(this.injected, `sync.providers.${provider}` as TranslationKey)}: ${label}`;
		}

		const metrics = this.element('section');
		metrics.dataset.summaryMetrics = 'true';
		this.metric(metrics, 'notesCreated', countApplied(this.viewModel, ['create-note']));
		this.metric(metrics, 'notesUpdated', countApplied(this.viewModel, ['adopt-note', 'update-properties', 'add-achievement-block', 'update-achievement-block']));
		if (this.viewModel.gamesFetched !== undefined) this.metric(metrics, 'gamesFetched', this.viewModel.gamesFetched);
		this.metric(metrics, 'pending', this.viewModel.pendingOperationIds.length);
		this.metric(metrics, 'deselected', this.viewModel.deselectedOperationIds.length);
		this.metric(metrics, 'ignored', this.viewModel.ignored);
		if (this.viewModel.unlockedCount !== undefined) this.metric(metrics, 'unlocked', this.viewModel.unlockedCount);

		if (this.viewModel.warnings.length > 0) {
			const warnings = this.element('section');
			warnings.dataset.summaryWarnings = 'true';
			for (const warning of this.viewModel.warnings) {
				const item = this.element('p', warnings);
				item.dataset.summaryWarning = 'true';
				item.textContent = warning;
			}
		}

		const footer = new Setting(this.contentEl);
		footer.addButton((button) => {
			button.setButtonText(translation(this.injected, 'sync.summary.close'));
			button.onClick(() => this.close());
		});
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K, parent = this.contentEl): HTMLElementTagNameMap[K] {
		return parent.createEl(tag);
	}

	private metric(parent: HTMLElement, key: 'notesCreated' | 'notesUpdated' | 'gamesFetched' | 'pending' | 'deselected' | 'ignored' | 'unlocked', value: number): void {
		const row = new Setting(parent).setName(translation(this.injected, `sync.summary.${key}` as TranslationKey));
		row.settingEl.dataset[`summary${key[0].toUpperCase()}${key.slice(1)}` as 'summaryNotesCreated'] = String(value);
		row.settingEl.textContent = `${translation(this.injected, `sync.summary.${key}` as TranslationKey)}: ${value}`;
	}

	private statusLabel(state: ProviderStatusSummary['state']): string {
		return translation(this.injected, `sync.status.${state}` as TranslationKey);
	}
}

export { SummaryModal as GameSyncSummaryModal };
