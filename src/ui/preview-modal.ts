import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { NormalizedGame } from '../model/game';
import type { Operation } from '../model/operations';
import type { PlannedGame } from '../sync/planner';
import type { PreparedSync } from '../sync/service';
import type { GameProvider } from '../model/provider';

export type ReviewDecisionAction = 'merge' | 'keep-separate' | 'skip';

export interface ReviewDecision {
	planId: string;
	canonicalGameId: string;
	action: ReviewDecisionAction;
	candidatePath?: string;
}

export interface PreviewModalInjected {
	t?: (key: string, params?: Record<string, string | number>) => string;
}

export interface PreviewModalOptions {
	prepared: PreparedSync;
	onApply: (prepared: PreparedSync, selectedOperationIds: readonly string[]) => void | Promise<void>;
	onReviewDecision: (decision: ReviewDecision) => void | Promise<void>;
	onClose?: () => void | Promise<void>;
	injected?: PreviewModalInjected;
}

/** Kept as a public compatibility type for integrations that imported it before the UX redesign. */
export type PreviewCategory = 'all' | 'new' | 'adopt' | 'update' | 'matches' | 'conflicts' | 'skipped';

type PreviewGroup = {
	canonicalGameId: string;
	games: NormalizedGame[];
	statuses: PlannedGame[];
	operations: Operation[];
};

type DetailKind = 'new' | 'updates' | 'review' | 'ignored';

function translation(injected: PreviewModalInjected | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
	return injected?.t?.(key, params) ?? t(key, params as never);
}

function groupTitle(group: PreviewGroup): string {
	return group.games[0]?.title ?? group.statuses[0]?.path ?? group.canonicalGameId;
}

function isReview(group: PreviewGroup): boolean {
	return group.statuses.some((status) => status.status === 'review' || status.status === 'conflict');
}

function isIgnored(group: PreviewGroup): boolean {
	return group.statuses.some((status) => status.status === 'ignored');
}

function detailKind(group: PreviewGroup): DetailKind | undefined {
	if (isReview(group)) return 'review';
	if (isIgnored(group)) return 'ignored';
	if (group.statuses.some((status) => status.status === 'create') || group.operations.some((operation) => operation.kind === 'create-note')) return 'new';
	if (group.operations.length > 0 || group.statuses.some((status) => status.status === 'adopt' || status.status === 'update')) return 'updates';
	return undefined;
}

function groupCounts(groups: readonly PreviewGroup[]): Record<DetailKind, number> {
	return {
		new: groups.filter((group) => detailKind(group) === 'new').length,
		updates: groups.filter((group) => detailKind(group) === 'updates').length,
		review: groups.filter((group) => detailKind(group) === 'review').length,
		ignored: groups.filter((group) => detailKind(group) === 'ignored').length,
	};
}

function plural(count: number, singular: string, pluralForm: string): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

function releaseYear(value: string | undefined): string | undefined {
	const year = value?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function propertyValues(properties: Record<string, unknown>, keys: readonly string[]): string[] {
	return keys.flatMap((key) => {
		const value = properties[key];
		if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
		return typeof value === 'string' ? [value] : [];
	});
}

export class PreviewModal extends Modal {
	private readonly selectedOperationIds = new Set<string>();
	private readonly groups: PreviewGroup[];
	private lifecycle = 0;
	private isOpen = false;
	private closeNotified = false;
	private pendingApply = false;
	private applyButton?: HTMLButtonElement;
	private statusEl?: HTMLElement;

	constructor(app: App, private readonly options: PreviewModalOptions) {
		super(app);
		this.groups = this.buildGroups(options.prepared);
		for (const operation of options.prepared.plan.operations) {
			if (operation.risk === 'safe') this.selectedOperationIds.add(operation.id);
		}
	}

	override onOpen(): void {
		this.isOpen = true;
		this.closeNotified = false;
		this.pendingApply = false;
		this.lifecycle += 1;
		this.setTitle(translation(this.options.injected, 'sync.preview.title'));
		this.contentEl.replaceChildren();
		this.contentEl.className = 'game-sync-preview-modal';
		this.render();
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		this.pendingApply = false;
		if (this.closeNotified) return;
		this.closeNotified = true;
		if (this.options.onClose !== undefined) void Promise.resolve(this.options.onClose()).catch(() => undefined);
	}

	private buildGroups(prepared: PreparedSync): PreviewGroup[] {
		const byId = new Map<string, PreviewGroup>();
		const get = (canonicalGameId: string): PreviewGroup => {
			const existing = byId.get(canonicalGameId);
			if (existing !== undefined) return existing;
			const created: PreviewGroup = { canonicalGameId, games: [], statuses: [], operations: [] };
			byId.set(canonicalGameId, created);
			return created;
		};
		for (const game of prepared.games) get(game.canonicalId).games.push(game);
		for (const status of prepared.plan.statuses) get(status.canonicalGameId).statuses.push(status);
		for (const operation of prepared.plan.operations) get(operation.canonicalGameId).operations.push(operation);
		return [...byId.values()].sort((left, right) => left.canonicalGameId.localeCompare(right.canonicalGameId));
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K, parent = this.contentEl): HTMLElementTagNameMap[K] {
		return parent.createEl(tag);
	}

	private render(): void {
		const intro = this.element('p');
		intro.textContent = translation(this.options.injected, 'sync.preview.ready');

		const counts = groupCounts(this.groups);
		const summary = this.element('div');
		summary.dataset.previewSummary = 'true';
		this.summaryMetric(summary, 'new', plural(counts.new, translation(this.options.injected, 'sync.preview.newGame'), translation(this.options.injected, 'sync.preview.newGames')));
		this.summaryMetric(summary, 'updates', plural(counts.updates, translation(this.options.injected, 'sync.preview.update'), translation(this.options.injected, 'sync.preview.updates')));
		this.summaryMetric(summary, 'review', plural(counts.review, translation(this.options.injected, 'sync.preview.matchToReview'), translation(this.options.injected, 'sync.preview.matchesToReview')));

		this.statusEl = this.element('p');
		this.statusEl.dataset.previewStatus = 'true';
		this.statusEl.setAttribute('aria-live', 'polite');
		if (this.options.prepared.warnings.length > 0) {
			const warnings = this.element('section');
			warnings.dataset.previewWarnings = 'true';
			for (const warning of this.options.prepared.warnings) {
				const item = this.element('p', warnings);
				item.dataset.previewWarning = 'true';
				item.textContent = warning;
			}
		}

		for (const kind of ['new', 'updates', 'review', 'ignored'] as const) {
			const groups = this.groups.filter((group) => detailKind(group) === kind);
			if (groups.length === 0) continue;
			const details = this.element('details');
			details.dataset.previewDetails = kind;
			const summary = this.element('summary', details);
			summary.textContent = translation(this.options.injected, `sync.preview.details.${kind}` as TranslationKey);
			for (const group of groups) this.renderGroup(group, details);
		}

		const footer = new Setting(this.contentEl);
		footer.settingEl.dataset.gameSyncActionRow = 'true';
		footer.addButton((button) => {
			button.setButtonText(translation(this.options.injected, 'sync.preview.close'));
			button.onClick(() => this.close());
		});
		footer.addButton((button) => {
			button.setButtonText(translation(this.options.injected, 'sync.preview.apply'));
			button.setCta();
			button.buttonEl.dataset.previewApply = 'true';
			this.applyButton = button.buttonEl;
			button.onClick(() => void this.apply());
		});
		this.refreshSelection();
	}

	private summaryMetric(parent: HTMLElement, kind: DetailKind, text: string): void {
		const metric = this.element('p', parent);
		metric.dataset.previewMetric = kind;
		metric.textContent = text;
	}

	private renderGroup(group: PreviewGroup, parent: HTMLElement): void {
		const section = this.element('section', parent);
		section.dataset.previewGroup = group.canonicalGameId;
		const reviewStatus = group.statuses.find((status) => status.status === 'review' || status.status === 'conflict');
		const header = new Setting(section).setName(reviewStatus === undefined ? groupTitle(group) : translation(this.options.injected, reviewStatus.status === 'conflict' ? 'sync.preview.matchConflict' : 'sync.preview.matchQuestion'));
		header.settingEl.dataset.previewGroupHeader = group.canonicalGameId;
		if (reviewStatus !== undefined) this.renderMatchCandidate(group, reviewStatus, section);
		if (group.operations.length > 0) {
			header.addToggle((toggle) => {
				const checkbox = toggle.toggleEl as HTMLInputElement;
				checkbox.dataset.previewGroupCheckbox = group.canonicalGameId;
				checkbox.checked = group.operations.every((operation) => this.selectedOperationIds.has(operation.id));
				toggle.onChange((checked) => {
					for (const operation of group.operations) {
						if (checked) this.selectedOperationIds.add(operation.id);
						else this.selectedOperationIds.delete(operation.id);
					}
					this.refreshSelection();
				});
			});
		}
		for (const status of group.statuses) {
			if (status.status !== 'review' && status.status !== 'conflict') continue;
			const actions = new Setting(section).setName(translation(this.options.injected, 'sync.preview.actionsLabel'));
			for (const action of ['merge', 'keep-separate', 'skip'] as const) {
				actions.addButton((button) => {
					button.setButtonText(translation(this.options.injected, `sync.preview.actions.${action}` as TranslationKey));
					button.buttonEl.dataset.previewReviewAction = `${action}:${group.canonicalGameId}`;
					button.onClick(() => void this.review({
						planId: this.options.prepared.plan.id,
						canonicalGameId: group.canonicalGameId,
						action,
						...(status.path === undefined ? {} : { candidatePath: status.path }),
					}));
				});
			}
		}
		for (const operation of group.operations) {
			const setting = new Setting(section).setName(operation.summary);
			setting.settingEl.dataset.previewOperationRow = operation.id;
			setting.addToggle((toggle) => {
				const checkbox = toggle.toggleEl as HTMLInputElement;
				checkbox.dataset.previewOperation = operation.id;
				checkbox.checked = this.selectedOperationIds.has(operation.id);
				toggle.onChange((checked) => {
					if (checked) this.selectedOperationIds.add(operation.id);
					else this.selectedOperationIds.delete(operation.id);
					this.refreshSelection();
				});
			});
		}
	}

	private renderMatchCandidate(group: PreviewGroup, status: PlannedGame, parent: HTMLElement): void {
		const comparison = this.element('div', parent);
		comparison.dataset.previewMatchComparison = group.canonicalGameId;
		const game = group.games[0];
		for (const provider of ['steam', 'playstation'] as const) {
			const providerGame = game?.providers[provider];
			if (providerGame === undefined) continue;
			this.matchValue(comparison, provider, providerGame.title);
		}
		const candidate = status.match?.note;
		if (candidate !== undefined) this.matchValue(comparison, 'existing', candidate.title ?? candidate.path);
		else if (status.path !== undefined) this.matchValue(comparison, 'existing', status.path);

		const facts = this.element('div', comparison);
		facts.dataset.previewMatchFacts = group.canonicalGameId;
		const gameYear = releaseYear(game?.releaseDate);
		const candidateYear = candidate === undefined ? undefined : releaseYear(propertyValues(candidate.properties, ['released', 'releaseDate'])[0]);
		if (game !== undefined && candidate?.title !== undefined && game.title.localeCompare(candidate.title, undefined, { sensitivity: 'accent' }) === 0) this.matchFact(facts, 'sync.preview.matchSameTitle');
		if (gameYear !== undefined && gameYear === candidateYear) this.matchFact(facts, 'sync.preview.matchSameReleaseYear');
		const developers = game?.developers ?? [];
		const candidateDevelopers = candidate === undefined ? [] : propertyValues(candidate.properties, ['developers', 'developer']);
		if (developers.some((developer) => candidateDevelopers.some((candidateDeveloper) => developer.localeCompare(candidateDeveloper, undefined, { sensitivity: 'accent' }) === 0))) this.matchFact(facts, 'sync.preview.matchSameDeveloper');
	}

	private matchValue(parent: HTMLElement, provider: GameProvider | 'existing', value: string): void {
		const row = this.element('p', parent);
		row.dataset.previewMatchProvider = provider;
		row.textContent = `${provider === 'existing' ? translation(this.options.injected, 'sync.preview.matchExistingNote') : translation(this.options.injected, `sync.providers.${provider}` as TranslationKey)}: ${value}`;
	}

	private matchFact(parent: HTMLElement, key: TranslationKey): void {
		const fact = this.element('span', parent);
		fact.dataset.previewMatchFact = key.split('.').at(-1);
		fact.textContent = translation(this.options.injected, key);
	}

	private refreshSelection(): void {
		for (const group of this.groups) {
			const checkbox = Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-group-checkbox]'))
				.find((candidate) => candidate.dataset.previewGroupCheckbox === group.canonicalGameId);
				if (checkbox !== undefined) {
				const checked = group.operations.filter((operation) => this.selectedOperationIds.has(operation.id)).length;
				checkbox.checked = group.operations.length > 0 && checked === group.operations.length;
				checkbox.indeterminate = checked > 0 && checked < group.operations.length;
			}
			for (const operation of group.operations) {
				const operationCheckbox = Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-operation]'))
					.find((candidate) => candidate.dataset.previewOperation === operation.id);
				if (operationCheckbox !== undefined) operationCheckbox.checked = this.selectedOperationIds.has(operation.id);
			}
		}
		const unresolved = this.options.prepared.plan.statuses.some((status) => status.status === 'review' || status.status === 'conflict');
		if (this.applyButton !== undefined) this.applyButton.disabled = unresolved || this.selectedOperationIds.size === 0 || this.pendingApply || !this.isOpen;
		if (this.statusEl !== undefined) this.statusEl.textContent = unresolved
			? translation(this.options.injected, 'sync.preview.unresolvedWarning')
			: translation(this.options.injected, 'sync.preview.selectionSummary', { count: this.selectedOperationIds.size });
	}

	private async review(decision: ReviewDecision): Promise<void> {
		if (!this.isOpen) return;
		const version = this.lifecycle;
		try {
			await this.options.onReviewDecision(decision);
		} catch {
			if (this.isOpen && this.lifecycle === version && this.statusEl !== undefined) this.statusEl.textContent = translation(this.options.injected, 'sync.preview.decisionFailed');
		}
	}

	private async apply(): Promise<void> {
		if (!this.isOpen || this.pendingApply || this.applyButton?.disabled) return;
		const version = this.lifecycle;
		const selected = [...this.selectedOperationIds].filter((id) => this.options.prepared.plan.operations.some((operation) => operation.id === id));
		if (selected.length === 0) return;
		this.pendingApply = true;
		this.refreshSelection();
		try {
			await this.options.onApply(this.options.prepared, selected);
		} catch {
			if (this.isOpen && this.lifecycle === version && this.statusEl !== undefined) this.statusEl.textContent = translation(this.options.injected, 'sync.preview.applyFailed');
		} finally {
			if (this.isOpen && this.lifecycle === version) {
				this.pendingApply = false;
				this.refreshSelection();
			}
		}
	}
}

export { PreviewModal as GameSyncPreviewModal };
