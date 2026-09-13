import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { NormalizedGame } from '../model/game';
import type { Operation } from '../model/operations';
import type { PlannedGame, PlannedGameStatus } from '../sync/planner';
import type { PreparedSync } from '../sync/service';

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

export type PreviewCategory = 'all' | 'new' | 'adopt' | 'update' | 'matches' | 'conflicts' | 'skipped';

type PreviewGroup = {
	canonicalGameId: string;
	games: NormalizedGame[];
	statuses: PlannedGame[];
	operations: Operation[];
	categories: Set<PreviewCategory>;
};

const CATEGORY_ORDER: readonly PreviewCategory[] = ['all', 'new', 'adopt', 'update', 'matches', 'conflicts', 'skipped'];

function translation(injected: PreviewModalInjected | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
	return injected?.t?.(key, params) ?? t(key, params as never);
}

function statusCategory(status: PlannedGameStatus): PreviewCategory | undefined {
	if (status === 'create') return 'new';
	if (status === 'adopt') return 'adopt';
	if (status === 'update') return 'update';
	if (status === 'review' || status === 'unchanged') return 'matches';
	if (status === 'conflict') return 'conflicts';
	if (status === 'ignored') return 'skipped';
	return undefined;
}

function operationCategory(kind: Operation['kind']): PreviewCategory {
	if (kind === 'create-note') return 'new';
	if (kind === 'adopt-note') return 'adopt';
	return 'update';
}

function groupTitle(group: PreviewGroup): string {
	return group.games[0]?.title ?? group.statuses[0]?.path ?? group.canonicalGameId;
}

export class PreviewModal extends Modal {
	private readonly selectedOperationIds = new Set<string>();
	private readonly groups: PreviewGroup[];
	private lifecycle = 0;
	private isOpen = false;
	private closeNotified = false;
	private pendingApply = false;
	private category: PreviewCategory = 'all';
	private search = '';
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
		this.category = 'all';
		this.search = '';
		this.lifecycle += 1;
		this.setTitle(translation(this.options.injected, 'sync.preview.title'));
		this.contentEl.replaceChildren();
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
			const created: PreviewGroup = { canonicalGameId, games: [], statuses: [], operations: [], categories: new Set(['all']) };
			byId.set(canonicalGameId, created);
			return created;
		};
		for (const game of prepared.games) get(game.canonicalId).games.push(game);
		for (const status of prepared.plan.statuses) {
			const group = get(status.canonicalGameId);
			group.statuses.push(status);
			const category = statusCategory(status.status);
			if (category !== undefined) group.categories.add(category);
		}
		for (const operation of prepared.plan.operations) {
			const group = get(operation.canonicalGameId);
			group.operations.push(operation);
			group.categories.add(operationCategory(operation.kind));
		}
		return [...byId.values()].sort((left, right) => left.canonicalGameId.localeCompare(right.canonicalGameId));
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K, parent = this.contentEl): HTMLElementTagNameMap[K] {
		return parent.createEl(tag);
	}

	private render(): void {
		const search = new Setting(this.contentEl).setName(translation(this.options.injected, 'sync.preview.search'));
		search.addText((component) => {
			component.inputEl.dataset.previewSearch = 'true';
			component.inputEl.addEventListener('input', () => {
				this.search = component.inputEl.value;
				this.updateVisibility();
			});
		});

		const categories = this.element('div');
		categories.dataset.previewCategories = 'true';
		for (const category of CATEGORY_ORDER) {
			const button = this.element('button', categories);
			button.type = 'button';
			button.dataset.previewCategory = category;
			button.textContent = translation(this.options.injected, `sync.preview.categories.${category}` as TranslationKey);
			button.addEventListener('click', () => {
				this.category = category;
				this.updateVisibility();
			});
		}

		const selection = new Setting(this.contentEl);
		selection.addButton((button) => {
			button.setButtonText(translation(this.options.injected, 'sync.preview.selectVisible'));
			button.buttonEl.dataset.previewSelectVisible = 'all';
			button.onClick(() => this.selectVisible(true));
		});
		selection.addButton((button) => {
			button.setButtonText(translation(this.options.injected, 'sync.preview.deselectVisible'));
			button.buttonEl.dataset.previewSelectVisible = 'none';
			button.onClick(() => this.selectVisible(false));
		});

		this.statusEl = this.element('p');
		this.statusEl.dataset.previewStatus = 'true';
		if (this.options.prepared.warnings.length > 0) {
			const warnings = this.element('section');
			warnings.dataset.previewWarnings = 'true';
			for (const warning of this.options.prepared.warnings) {
				const item = this.element('p', warnings);
				item.dataset.previewWarning = 'true';
				item.textContent = warning;
			}
		}
		const groupsEl = this.element('div');
		groupsEl.dataset.previewGroups = 'true';
		for (const group of this.groups) this.renderGroup(group, groupsEl);

		const footer = new Setting(this.contentEl);
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
		this.updateVisibility();
	}

	private renderGroup(group: PreviewGroup, parent: HTMLElement): void {
		const section = this.element('section', parent);
		section.dataset.previewGroup = group.canonicalGameId;
		const heading = new Setting(section).setName(groupTitle(group));
		heading.settingEl.dataset.previewGroupHeader = group.canonicalGameId;
		heading.addToggle((toggle) => {
			const checkbox = toggle.toggleEl;
			checkbox.dataset.previewGroupCheckbox = group.canonicalGameId;
			toggle.onChange((checked) => {
				for (const operation of group.operations) {
					if (checked) this.selectedOperationIds.add(operation.id);
					else this.selectedOperationIds.delete(operation.id);
				}
				this.refreshSelection();
			});
		});
		for (const status of group.statuses) {
			if (status.status !== 'review' && status.status !== 'conflict') continue;
			const actions = new Setting(section).setName(status.reason ?? translation(this.options.injected, 'sync.preview.unresolvedWarning'));
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

	private matches(group: PreviewGroup): boolean {
		const query = this.search.trim().toLocaleLowerCase();
		if (!query) return true;
		return [group.canonicalGameId, groupTitle(group), ...group.statuses.flatMap((status) => [status.path ?? '', status.reason ?? '']), ...group.operations.map((operation) => operation.summary)]
			.some((value) => value.toLocaleLowerCase().includes(query));
	}

	private isVisible(group: PreviewGroup): boolean {
		return (this.category === 'all' || group.categories.has(this.category)) && this.matches(group);
	}

	private updateVisibility(): void {
		for (const group of this.groups) {
			const element = Array.from(this.contentEl.querySelectorAll<HTMLElement>('[data-preview-group]')).find((candidate) => candidate.dataset.previewGroup === group.canonicalGameId);
			if (element !== undefined) element.hidden = !this.isVisible(group);
		}
		this.refreshSelection();
	}

	private selectVisible(selected: boolean): void {
		for (const group of this.groups) {
			if (!this.isVisible(group)) continue;
			for (const operation of group.operations) {
				if (selected) this.selectedOperationIds.add(operation.id);
				else this.selectedOperationIds.delete(operation.id);
			}
		}
		this.refreshSelection();
	}

	private refreshSelection(): void {
		for (const group of this.groups) {
			const checked = group.operations.filter((operation) => this.selectedOperationIds.has(operation.id)).length;
			const checkbox = Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-group-checkbox]')).find((candidate) => candidate.dataset.previewGroupCheckbox === group.canonicalGameId);
			if (checkbox !== undefined) {
				checkbox.checked = group.operations.length > 0 && checked === group.operations.length;
				checkbox.indeterminate = checked > 0 && checked < group.operations.length;
				checkbox.disabled = group.operations.length === 0;
			}
			for (const operation of group.operations) {
				const operationCheckbox = Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-preview-operation]')).find((candidate) => candidate.dataset.previewOperation === operation.id);
				if (operationCheckbox !== undefined) operationCheckbox.checked = this.selectedOperationIds.has(operation.id);
			}
			if (group.operations.some((operation) => !this.selectedOperationIds.has(operation.id))) group.categories.add('skipped');
			else if (!group.statuses.some((status) => status.status === 'ignored')) group.categories.delete('skipped');
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
