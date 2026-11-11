import { Modal, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { NormalizedGame } from '../model/game';
import type { GameOperationKind, Operation } from '../model/operations';
import type { PlannedGame } from '../sync/planner';
import type { PreparedSync } from '../sync/service';
import type { GameProvider } from '../model/provider';

export type ReviewDecisionAction = 'merge' | 'keep-separate' | 'skip';

export interface ReviewDecision {
	planId: string;
	canonicalGameId: string;
	action: ReviewDecisionAction;
	candidatePath?: string;
	/** Another library entry that would create the same note; merging joins both into one game. */
	candidateCanonicalId?: string;
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

/** One selectable game row; kept so search, section and global selection share one source of truth. */
type RowState = {
	group: PreviewGroup;
	kind: DetailKind;
	rowEl: HTMLElement;
	checkbox?: HTMLInputElement;
	operationCheckboxes: Map<string, HTMLInputElement>;
	searchText: string;
};

type SectionState = {
	kind: DetailKind;
	sectionEl: HTMLElement;
	checkbox?: HTMLInputElement;
	countEl: HTMLElement;
	rows: RowState[];
};

// Least effort first: ready-to-sync games, then what is skipped, and decisions last.
const SECTION_ORDER: readonly DetailKind[] = ['new', 'updates', 'ignored', 'review'];
const PROVIDERS: readonly GameProvider[] = ['steam', 'playstation'];

function translation(injected: PreviewModalInjected | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
	return injected?.t?.(key, params) ?? t(key, params as never);
}

function groupTitle(group: PreviewGroup): string {
	const fromPath = group.statuses[0]?.path?.split('/').at(-1)?.replace(/\.md$/iu, '');
	return group.games[0]?.title ?? fromPath ?? group.canonicalGameId;
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

function playtimeLabel(minutes: number | undefined): string | undefined {
	if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return undefined;
	return minutes < 60 ? `${Math.round(minutes)} min` : `${Math.round(minutes / 60)} h`;
}

function normalizedSearch(value: string): string {
	return value.toLocaleLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim();
}

export class PreviewModal extends Modal {
	private readonly selectedOperationIds = new Set<string>();
	private readonly groups: PreviewGroup[];
	private rows: RowState[] = [];
	private sections: SectionState[] = [];
	private query = '';
	private lifecycle = 0;
	private isOpen = false;
	private closeNotified = false;
	private pendingApply = false;
	private applyButton?: HTMLButtonElement;
	private statusEl?: HTMLElement;
	private emptySearchEl?: HTMLElement;

	constructor(app: App, private readonly options: PreviewModalOptions) {
		super(app);
		this.groups = this.buildGroups(options.prepared);
		for (const group of this.groups) {
			// Operations of an undecided match stay unselected; the rest of the library can still sync.
			if (isReview(group)) continue;
			for (const operation of group.operations) if (operation.risk === 'safe') this.selectedOperationIds.add(operation.id);
		}
	}

	override onOpen(): void {
		this.isOpen = true;
		this.closeNotified = false;
		this.pendingApply = false;
		this.lifecycle += 1;
		this.setTitle(this.tr('sync.preview.title'));
		this.modalEl.classList.add('game-sync-preview');
		this.contentEl.replaceChildren();
		this.contentEl.classList.add('game-sync-preview-modal');
		this.rows = [];
		this.sections = [];
		this.query = '';
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

	private tr(key: TranslationKey, params?: Record<string, string | number>): string {
		return translation(this.options.injected, key, params);
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
		return [...byId.values()].sort((left, right) => groupTitle(left).localeCompare(groupTitle(right), undefined, { sensitivity: 'base', numeric: true }));
	}

	private el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
		const element = parent.createEl(tag);
		if (className !== undefined) element.className = className;
		if (text !== undefined) element.textContent = text;
		return element;
	}

	private checkbox(parent: HTMLElement, label: string): HTMLInputElement {
		const input = this.el(parent, 'input', 'game-sync-preview-checkbox');
		input.type = 'checkbox';
		input.setAttribute('aria-label', label);
		return input;
	}

	private render(): void {
		this.el(this.contentEl, 'p', 'game-sync-preview-intro', this.tr('sync.preview.intro'));
		this.renderWarnings();
		this.renderToolbar();

		const list = this.el(this.contentEl, 'div', 'game-sync-preview-list');
		for (const kind of SECTION_ORDER) {
			const groups = this.groups.filter((group) => detailKind(group) === kind);
			if (groups.length > 0) this.renderSection(list, kind, groups);
		}
		this.emptySearchEl = this.el(list, 'p', 'game-sync-preview-empty', this.tr('sync.preview.noResults'));
		this.emptySearchEl.hidden = true;

		const footer = this.el(this.contentEl, 'div', 'modal-button-container game-sync-preview-footer');
		this.statusEl = this.el(footer, 'span', 'game-sync-preview-status');
		this.statusEl.dataset.previewStatus = 'true';
		this.statusEl.setAttribute('aria-live', 'polite');
		const close = this.el(footer, 'button', undefined, this.tr('sync.preview.close'));
		close.addEventListener('click', () => this.close());
		this.applyButton = this.el(footer, 'button', 'mod-cta');
		this.applyButton.dataset.previewApply = 'true';
		this.applyButton.addEventListener('click', () => void this.apply());
		this.refreshSelection();
	}

	private renderWarnings(): void {
		if (this.options.prepared.warnings.length === 0) return;
		const warnings = this.el(this.contentEl, 'div', 'game-sync-preview-warnings');
		warnings.dataset.previewWarnings = 'true';
		for (const warning of this.options.prepared.warnings) {
			const item = this.el(warnings, 'p', undefined, warning);
			item.dataset.previewWarning = 'true';
		}
	}

	private renderToolbar(): void {
		const toolbar = this.el(this.contentEl, 'div', 'game-sync-preview-toolbar');
		const search = this.el(toolbar, 'input', 'game-sync-preview-search');
		search.type = 'search';
		search.placeholder = this.tr('sync.preview.search');
		search.setAttribute('aria-label', this.tr('sync.preview.search'));
		search.dataset.previewSearch = 'true';
		search.addEventListener('input', () => {
			this.query = normalizedSearch(search.value);
			this.applySearch();
		});
		const selectAll = this.el(toolbar, 'button', undefined, this.tr('sync.preview.selectAll'));
		selectAll.dataset.previewSelectAll = 'true';
		selectAll.addEventListener('click', () => this.setRowsSelected(this.visibleSelectableRows(), true));
		const deselectAll = this.el(toolbar, 'button', undefined, this.tr('sync.preview.deselectAll'));
		deselectAll.dataset.previewDeselectAll = 'true';
		deselectAll.addEventListener('click', () => this.setRowsSelected(this.visibleSelectableRows(), false));
	}

	private renderSection(parent: HTMLElement, kind: DetailKind, groups: readonly PreviewGroup[]): void {
		const sectionEl = this.el(parent, 'section', 'game-sync-preview-section');
		sectionEl.dataset.previewDetails = kind;
		const header = this.el(sectionEl, 'div', 'game-sync-preview-section-header');
		const selectable = kind === 'new' || kind === 'updates';
		const section: SectionState = { kind, sectionEl, countEl: header, rows: [] };
		const title = this.tr(`sync.preview.details.${kind}` as TranslationKey);
		if (selectable) {
			section.checkbox = this.checkbox(header, title);
			section.checkbox.dataset.previewSectionCheckbox = kind;
			section.checkbox.addEventListener('change', () => this.setRowsSelected(section.rows.filter((row) => !row.rowEl.hidden), section.checkbox?.checked === true));
		}
		this.el(header, 'span', 'game-sync-preview-section-title', title);
		section.countEl = this.el(header, 'span', 'game-sync-preview-section-count');
		if (kind === 'review') this.el(sectionEl, 'p', 'game-sync-preview-section-description', this.tr('sync.preview.reviewDescription'));
		if (kind === 'ignored') this.el(sectionEl, 'p', 'game-sync-preview-section-description', this.tr('sync.preview.ignoredDescription'));
		const body = this.el(sectionEl, 'div', 'game-sync-preview-rows');
		const rendered = new Set<string>();
		for (const group of groups) {
			// Two library entries colliding on one note are a single decision, so they share one card.
			if (rendered.has(group.canonicalGameId)) continue;
			const row = kind === 'review' ? this.renderReviewCard(body, group, rendered) : this.renderRow(body, group, kind);
			rendered.add(group.canonicalGameId);
			section.rows.push(row);
			this.rows.push(row);
		}
		this.sections.push(section);
	}

	private renderRow(parent: HTMLElement, group: PreviewGroup, kind: DetailKind): RowState {
		const title = groupTitle(group);
		const selectable = kind !== 'ignored' && group.operations.length > 0;
		const rowEl = this.el(parent, selectable ? 'label' : 'div', 'game-sync-preview-row');
		rowEl.dataset.previewGroup = group.canonicalGameId;
		const row: RowState = { group, kind, rowEl, operationCheckboxes: new Map(), searchText: normalizedSearch(title) };
		if (selectable) {
			row.checkbox = this.checkbox(rowEl, title);
			row.checkbox.dataset.previewGroupCheckbox = group.canonicalGameId;
			row.checkbox.addEventListener('change', () => this.setRowsSelected([row], row.checkbox?.checked === true));
		} else {
			rowEl.classList.add('is-muted');
		}
		const text = this.el(rowEl, 'div', 'game-sync-preview-row-text');
		this.el(text, 'div', 'game-sync-preview-row-title', title);
		const meta = this.rowMeta(group);
		if (meta.length > 0) this.el(text, 'div', 'game-sync-preview-row-meta', meta);
		const tags = this.el(rowEl, 'div', 'game-sync-preview-row-tags');
		for (const provider of this.providersOf(group)) this.el(tags, 'span', 'game-sync-preview-tag', this.tr(`sync.providers.${provider}` as TranslationKey));
		// Several operations for one game are listed under the row so they can be chosen individually.
		if (selectable && group.operations.length > 1) {
			const operations = this.el(parent, 'div', 'game-sync-preview-operations');
			operations.dataset.previewOperations = group.canonicalGameId;
			for (const operation of group.operations) {
				const label = this.el(operations, 'label', 'game-sync-preview-operation');
				label.dataset.previewOperationRow = operation.id;
				const checkbox = this.checkbox(label, this.operationLabel(operation.kind));
				checkbox.dataset.previewOperation = operation.id;
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selectedOperationIds.add(operation.id);
					else this.selectedOperationIds.delete(operation.id);
					this.refreshSelection();
				});
				this.el(label, 'span', undefined, this.operationLabel(operation.kind));
				row.operationCheckboxes.set(operation.id, checkbox);
			}
			row.rowEl.dataset.previewHasOperations = 'true';
			const originalRow = row.rowEl;
			row.rowEl = this.wrapRow(parent, originalRow, operations);
		}
		return row;
	}

	/** Keeps a game row and its operation sub-list together so search hides both. */
	private wrapRow(parent: HTMLElement, rowEl: HTMLElement, operations: HTMLElement): HTMLElement {
		const wrapper = this.el(parent, 'div', 'game-sync-preview-row-group');
		wrapper.append(rowEl, operations);
		return wrapper;
	}

	private rowMeta(group: PreviewGroup): string {
		const parts: string[] = [];
		// The section already says "new" or "update"; only mention extra work and multi-step games list it below.
		const implied = new Set<GameOperationKind>(['create-note', 'update-properties']);
		const kinds = group.operations.length > 1 ? [] : [...new Set(group.operations.map((operation) => operation.kind))].filter((kind) => !implied.has(kind));
		if (kinds.length > 0) parts.push(kinds.map((kind) => this.operationLabel(kind)).join(', '));
		const path = group.operations.find((operation) => operation.path !== undefined)?.path ?? group.statuses.find((status) => status.path !== undefined)?.path;
		const fileName = path?.split('/').at(-1)?.replace(/\.md$/iu, '');
		if (path !== undefined && fileName !== groupTitle(group)) parts.push(path);
		const playtime = playtimeLabel(group.games[0]?.playtimeMinutes);
		if (playtime !== undefined) parts.push(playtime);
		return parts.join(' · ');
	}

	private providersOf(group: PreviewGroup): GameProvider[] {
		const game = group.games[0];
		return game === undefined ? [] : PROVIDERS.filter((provider) => game.providers[provider] !== undefined);
	}

	private operationLabel(kind: GameOperationKind): string {
		return this.tr(`sync.preview.operations.${kind}` as TranslationKey);
	}

	/** Other library entries whose planned note path is the same as this game's (no vault note involved). */
	private pathCollisions(group: PreviewGroup, status: PlannedGame | undefined): PreviewGroup[] {
		if (status?.path === undefined || status.match?.note !== undefined || (status.match?.candidates.length ?? 0) > 0) return [];
		return this.groups.filter((other) => other !== group && isReview(other) && other.statuses.some((candidate) => candidate.path === status.path && candidate.match?.note === undefined));
	}

	private renderReviewCard(parent: HTMLElement, group: PreviewGroup, rendered: Set<string>): RowState {
		const card = this.el(parent, 'div', 'game-sync-preview-review');
		card.dataset.previewGroup = group.canonicalGameId;
		const status = group.statuses.find((candidate) => candidate.status === 'review' || candidate.status === 'conflict');
		const header = this.el(card, 'div', 'game-sync-preview-review-header');
		header.dataset.previewGroupHeader = group.canonicalGameId;
		this.el(header, 'span', 'game-sync-preview-review-title', groupTitle(group));
		const tags = this.el(header, 'span', 'game-sync-preview-row-tags');
		for (const provider of this.providersOf(group)) this.el(tags, 'span', 'game-sync-preview-tag', this.tr(`sync.providers.${provider}` as TranslationKey));

		const actions = this.el(card, 'div', 'game-sync-preview-review-actions');
		const buttons: HTMLButtonElement[] = [];
		const decision = (action: ReviewDecisionAction, extra: Partial<ReviewDecision>): ReviewDecision => ({ planId: this.options.prepared.plan.id, canonicalGameId: group.canonicalGameId, action, ...extra });
		const addButton = (label: string, key: string, cta: boolean, onClick: () => void): void => {
			const button = this.el(actions, 'button', cta ? 'mod-cta' : undefined, label);
			button.dataset.previewReviewAction = `${key}:${group.canonicalGameId}`;
			button.addEventListener('click', onClick);
			buttons.push(button);
		};
		const note = status?.match?.note;
		const candidates = status?.match?.candidates ?? [];
		const collisions = this.pathCollisions(group, status);
		const searchTitles = [groupTitle(group)];
		if (note !== undefined) {
			this.renderExistingNote(card, group, note, actions);
			addButton(this.tr('sync.preview.actions.merge'), 'merge', true, () => void this.review(decision('merge', { candidatePath: note.path }), card, buttons));
			addButton(this.tr('sync.preview.actions.keep-separate'), 'keep-separate', false, () => void this.review(decision('keep-separate', { candidatePath: note.path }), card, buttons));
		} else if (candidates.length > 0) {
			const list = this.el(card, 'div', 'game-sync-preview-comparison');
			card.insertBefore(list, actions);
			this.matchValue(list, 'existing', candidates.map((candidate) => candidate.path).join(', '), 'sync.preview.matchingNotes');
			for (const candidate of candidates.slice(0, 3)) {
				const name = candidate.path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? candidate.path;
				addButton(this.tr('sync.preview.mergeWith', { name }), `merge-${candidate.path}`, false, () => void this.review(decision('merge', { candidatePath: candidate.path }), card, buttons));
			}
		} else if (collisions.length > 0) {
			const list = this.el(card, 'div', 'game-sync-preview-comparison');
			card.insertBefore(list, actions);
			for (const other of collisions) {
				rendered.add(other.canonicalGameId);
				searchTitles.push(groupTitle(other));
				const providers = this.providersOf(other).map((provider) => this.tr(`sync.providers.${provider}` as TranslationKey)).join(', ');
				this.matchValue(list, 'existing', providers.length === 0 ? groupTitle(other) : `${groupTitle(other)} (${providers})`, 'sync.preview.sameGameAs');
			}
			const target = collisions[0];
			addButton(this.tr('sync.preview.actions.join'), 'merge', true, () => void this.review(decision('merge', { candidateCanonicalId: target.canonicalGameId }), card, buttons));
		}
		addButton(this.tr('sync.preview.actions.skip'), 'skip', false, () => this.defer(card, buttons));
		return { group, kind: 'review', rowEl: card, operationCheckboxes: new Map(), searchText: normalizedSearch(searchTitles.join(' ')) };
	}

	/** "Decide later" changes nothing: the game is just left out of this sync. */
	private defer(card: HTMLElement, buttons: readonly HTMLButtonElement[]): void {
		for (const button of buttons) button.disabled = true;
		card.dataset.previewDecided = 'skip';
		card.classList.add('is-decided');
		this.el(card, 'p', 'game-sync-preview-review-result', this.tr('sync.preview.deferred'));
	}

	private renderExistingNote(card: HTMLElement, group: PreviewGroup, candidate: NonNullable<NonNullable<PlannedGame['match']>['note']>, before: HTMLElement): void {
		const comparison = this.el(card, 'div', 'game-sync-preview-comparison');
		comparison.dataset.previewMatchComparison = group.canonicalGameId;
		card.insertBefore(comparison, before);
		this.matchValue(comparison, 'existing', candidate.path);
		const game = group.games[0];
		const facts = this.el(card, 'div', 'game-sync-preview-facts');
		facts.dataset.previewMatchFacts = group.canonicalGameId;
		card.insertBefore(facts, before);
		const gameYear = releaseYear(game?.releaseDate);
		const candidateYear = releaseYear(propertyValues(candidate.properties, ['released', 'releaseDate'])[0]);
		if (game !== undefined && candidate.title !== undefined && game.title.localeCompare(candidate.title, undefined, { sensitivity: 'accent' }) === 0) this.matchFact(facts, 'sync.preview.matchSameTitle');
		if (gameYear !== undefined && gameYear === candidateYear) this.matchFact(facts, 'sync.preview.matchSameReleaseYear');
		const developers = game?.developers ?? [];
		const candidateDevelopers = propertyValues(candidate.properties, ['developers', 'developer']);
		if (developers.some((developer) => candidateDevelopers.some((candidateDeveloper) => developer.localeCompare(candidateDeveloper, undefined, { sensitivity: 'accent' }) === 0))) this.matchFact(facts, 'sync.preview.matchSameDeveloper');
		if (facts.childElementCount === 0) facts.remove();
	}

	private matchValue(parent: HTMLElement, provider: GameProvider | 'existing', value: string, labelKey: TranslationKey = 'sync.preview.matchExistingNote'): void {
		const label = provider === 'existing' ? this.tr(labelKey) : this.tr(`sync.providers.${provider}` as TranslationKey);
		const row = this.el(parent, 'div', 'game-sync-preview-comparison-row');
		row.dataset.previewMatchProvider = provider;
		this.el(row, 'span', 'game-sync-preview-comparison-label', `${label}: `);
		this.el(row, 'span', 'game-sync-preview-comparison-value', value);
	}

	private matchFact(parent: HTMLElement, key: TranslationKey): void {
		const fact = this.el(parent, 'span', 'game-sync-preview-tag', this.tr(key));
		fact.dataset.previewMatchFact = key.split('.').at(-1);
	}

	private visibleSelectableRows(): RowState[] {
		return this.rows.filter((row) => row.checkbox !== undefined && !row.rowEl.hidden);
	}

	private setRowsSelected(rows: readonly RowState[], selected: boolean): void {
		for (const row of rows) {
			if (row.checkbox === undefined) continue;
			for (const operation of row.group.operations) {
				if (selected) this.selectedOperationIds.add(operation.id);
				else this.selectedOperationIds.delete(operation.id);
			}
		}
		this.refreshSelection();
	}

	private applySearch(): void {
		let visible = 0;
		for (const section of this.sections) {
			let sectionVisible = 0;
			for (const row of section.rows) {
				row.rowEl.hidden = this.query.length > 0 && !row.searchText.includes(this.query);
				if (!row.rowEl.hidden) sectionVisible += 1;
			}
			section.sectionEl.hidden = sectionVisible === 0;
			visible += sectionVisible;
		}
		if (this.emptySearchEl !== undefined) this.emptySearchEl.hidden = visible > 0;
		this.refreshSelection();
	}

	private refreshSelection(): void {
		for (const row of this.rows) {
			const total = row.group.operations.length;
			const checked = row.group.operations.filter((operation) => this.selectedOperationIds.has(operation.id)).length;
			if (row.checkbox !== undefined) {
				row.checkbox.checked = total > 0 && checked === total;
				row.checkbox.indeterminate = checked > 0 && checked < total;
			}
			for (const [id, checkbox] of row.operationCheckboxes) checkbox.checked = this.selectedOperationIds.has(id);
		}
		for (const section of this.sections) {
			const visibleRows = section.rows.filter((row) => !row.rowEl.hidden);
			const selectedRows = section.rows.filter((row) => row.group.operations.some((operation) => this.selectedOperationIds.has(operation.id)));
			section.countEl.textContent = section.checkbox !== undefined && selectedRows.length < section.rows.length
				? this.tr('sync.preview.sectionSelected', { selected: selectedRows.length, total: section.rows.length })
				: String(section.rows.length);
			if (section.checkbox !== undefined) {
				const selectedVisible = visibleRows.filter((row) => row.checkbox?.checked === true).length;
				section.checkbox.checked = visibleRows.length > 0 && selectedVisible === visibleRows.length;
				section.checkbox.indeterminate = visibleRows.some((row) => row.checkbox?.checked === true || row.checkbox?.indeterminate === true) && !section.checkbox.checked;
			}
		}
		const selectedGames = this.rows.filter((row) => row.group.operations.some((operation) => this.selectedOperationIds.has(operation.id))).length;
		if (this.applyButton !== undefined) {
			this.applyButton.textContent = this.pendingApply ? this.tr('sync.preview.applying') : this.tr('sync.preview.applyCount', { count: selectedGames });
			this.applyButton.classList.toggle('is-loading', this.pendingApply);
			this.applyButton.disabled = this.selectedOperationIds.size === 0 || this.pendingApply || !this.isOpen;
		}
	}

	private async review(decision: ReviewDecision, card: HTMLElement, buttons: readonly HTMLButtonElement[]): Promise<void> {
		if (!this.isOpen) return;
		const version = this.lifecycle;
		for (const button of buttons) button.disabled = true;
		try {
			await this.options.onReviewDecision(decision);
			if (!this.isOpen || this.lifecycle !== version) return;
			card.dataset.previewDecided = decision.action;
			card.classList.add('is-decided');
			this.el(card, 'p', 'game-sync-preview-review-result', this.tr('sync.preview.decisionSaved'));
			this.refreshSelection();
		} catch {
			if (!this.isOpen || this.lifecycle !== version) return;
			for (const button of buttons) button.disabled = false;
			if (this.statusEl !== undefined) this.statusEl.textContent = this.tr('sync.preview.decisionFailed');
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
			if (this.isOpen && this.lifecycle === version && this.statusEl !== undefined) this.statusEl.textContent = this.tr('sync.preview.applyFailed');
		} finally {
			if (this.isOpen && this.lifecycle === version) {
				this.pendingApply = false;
				this.refreshSelection();
			}
		}
	}
}

export { PreviewModal as GameSyncPreviewModal };
