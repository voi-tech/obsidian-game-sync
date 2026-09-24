import { Modal, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { CanonicalPreviewResult } from '../sync/canonical-service';
import type { CanonicalOperation, CanonicalSyncSelection } from '../sync/canonical-planner';
import type { CanonicalGame } from '../model/canonical-game';
import { normalizeTitle } from '../identity/normalize-title';

export interface CanonicalPreviewModalOptions {
	readonly preview: CanonicalPreviewResult;
	readonly onApply: (selection: CanonicalSyncSelection) => void | Promise<void>;
}

type OperationKind = 'create' | 'update';

interface PreviewGameLabel {
	readonly title: string;
	readonly subtitle?: string;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
	steam: 'Steam',
	'playstation-3': 'PlayStation 3',
	'playstation-4': 'PlayStation 4',
	'playstation-5': 'PlayStation 5',
	'xbox-360': 'Xbox 360',
	'xbox-one': 'Xbox One',
	'xbox-series': 'Xbox Series',
	'pc': 'PC',
	'nintendo-switch': 'Nintendo Switch',
};

function releaseYear(game: CanonicalGame): string | undefined {
	const year = game.metadata.releaseDate?.slice(0, 4);
	return year !== undefined && /^\d{4}$/u.test(year) ? year : undefined;
}

function previewLabels(games: readonly CanonicalGame[]): ReadonlyMap<string, PreviewGameLabel> {
	const groups = new Map<string, CanonicalGame[]>();
	for (const game of games) {
		const key = normalizeTitle(game.title);
		groups.set(key, [...(groups.get(key) ?? []), game]);
	}
	const result = new Map<string, PreviewGameLabel>();
	for (const group of groups.values()) {
		const duplicate = group.length > 1;
		const years = group.map(releaseYear);
		const hasUniqueYears = duplicate && years.every((year): year is string => year !== undefined) && new Set(years).size === group.length;
		for (const game of group) {
			const year = releaseYear(game);
			const title = hasUniqueYears && year !== undefined && !/\(\d{4}\)$/u.test(game.title.trim()) ? `${game.title} (${year})` : game.title;
			const platforms = duplicate && !hasUniqueYears
				? [...new Set(game.platforms.map((platform) => PLATFORM_LABELS[platform.id]).filter((label): label is string => label !== undefined))].sort().join(' · ')
				: '';
			result.set(game.identity.canonicalKey, platforms.length === 0 ? { title } : { title, subtitle: platforms });
		}
	}
	return result;
}

function previewValue(value: unknown): string {
	if (value === undefined) return '—';
	if (value === null) return 'null';
	if (typeof value === 'string') return value;
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? Object.prototype.toString.call(value) : serialized;
	} catch {
		return Object.prototype.toString.call(value);
	}
}

export class CanonicalPreviewModal extends Modal {
	private applying = false;
	private selectedOperationIds = new Set<string>();
	private selectedFieldIdsByOperation = new Map<string, Set<string>>();

	constructor(app: App, private readonly options: CanonicalPreviewModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('sync.canonicalPreview.title'));
		this.contentEl.replaceChildren();
		this.contentEl.dataset.canonicalPreviewModal = 'true';
		const { snapshot, plan } = this.options.preview;

		if (snapshot.status !== 'complete' || plan === undefined) {
			this.contentEl.createEl('p', { text: t('sync.canonicalPreview.incomplete') });
			this.contentEl.createEl('p', { text: t('sync.canonicalPreview.noChanges') });
			this.addButton(this.contentEl, t('sync.preview.close'), () => this.close());
			return;
		}

		this.contentEl.createEl('p', { text: t('sync.canonicalPreview.gamesRead', { count: snapshot.games.length }) });
		const warnings = (this.options.preview.enrichments ?? []).flatMap((enrichment) => enrichment.diagnostics);
		if (warnings.length > 0) this.contentEl.createEl('p', { text: t('sync.canonicalPreview.optionalWarnings', { count: warnings.length }) });

		const groups: Record<OperationKind, readonly CanonicalOperation[]> = {
			create: plan.operations.filter((operation) => operation.kind === 'create'),
			update: plan.operations.filter((operation) => operation.kind === 'update'),
		};
		const unchanged = plan.statuses.filter((status) => status.status === 'unchanged');
		const conflicts = plan.statuses.filter((status) => status.status === 'conflict');
		const skipped = plan.statuses.filter((status) => status.status === 'skip');
		const labels = previewLabels(plan.games);
		const operations = [...groups.create, ...groups.update];
		this.selectedOperationIds = new Set(operations.map((operation) => operation.id));
		this.selectedFieldIdsByOperation = new Map(operations.map((operation) => [operation.id, new Set(operation.preview.changes.map((change) => change.fieldId))]));

		for (const kind of ['create', 'update'] as const) this.renderOperationGroup(kind, groups[kind], labels);
		this.renderStatusList('unchanged', unchanged.map((status) => this.statusLabel(status, labels)));
		this.renderStatusList('conflict', conflicts.map((status) => this.statusLabel(status, labels, true)));
		this.renderStatusList('skip', skipped.map((status) => this.statusLabel(status, labels, true)));

		const footer = this.contentEl.createDiv();
		footer.dataset.canonicalPreviewFooter = 'true';
		const summary = footer.createEl('p', { text: '' });
		summary.dataset.canonicalPreviewSelection = 'true';
		const apply = this.addButton(footer, '', () => void this.apply());
		apply.dataset.canonicalPreviewApply = 'true';
		const error = footer.createEl('p', { text: '' });
		error.dataset.canonicalPreviewError = 'true';
		error.hidden = true;
		this.refreshSummary(summary, apply, conflicts.length > 0, plan);
	}

	private renderOperationGroup(kind: OperationKind, operations: readonly CanonicalOperation[], labels: ReadonlyMap<string, PreviewGameLabel>): void {
		if (operations.length === 0) return;
		const section = this.contentEl.createDiv();
		section.dataset.canonicalPreviewSection = kind;
		const heading = section.createEl('h3', { text: t(`sync.canonicalPreview.${kind}`, { count: operations.length }) });
		heading.dataset.canonicalPreviewHeading = kind;
		section.createEl('p', { text: t(`sync.canonicalPreview.${kind}Description` as TranslationKey) });

		const actions = section.createDiv();
		actions.dataset.canonicalPreviewSectionActions = kind;
		this.addActionButton(actions, t('sync.canonicalPreview.selectAll'), `select-all-${kind}`, () => {
			for (const operation of operations) {
				this.selectedOperationIds.add(operation.id);
				this.selectedFieldIdsByOperation.set(operation.id, new Set(operation.preview.changes.map((change) => change.fieldId)));
			}
			this.refreshControls();
		});
		this.addActionButton(actions, t('sync.canonicalPreview.deselectAll'), `deselect-all-${kind}`, () => {
			for (const operation of operations) {
				this.selectedOperationIds.delete(operation.id);
				this.setOperationFields(operation, new Set(operation.kind === 'create' ? operation.preview.requiredIdentityFieldIds : []), false);
			}
			this.refreshControls();
		});

		const list = section.createDiv();
		list.dataset.canonicalPreviewList = kind;
		for (const operation of operations) {
			const row = list.createDiv();
			row.className = 'game-sync-preview-game';
			row.dataset.canonicalPreviewOperation = operation.id;
			const label = row.createEl('label');
			label.className = 'game-sync-preview-game';
			const checkbox = label.createEl('input');
			checkbox.type = 'checkbox';
			checkbox.checked = this.isOperationSelected(operation);
			checkbox.id = `canonical-preview-operation-${operation.id}`;
			checkbox.dataset.canonicalPreviewOperationToggle = operation.id;
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedOperationIds.add(operation.id);
					this.setOperationFields(operation, new Set(operation.preview.changes.map((change) => change.fieldId)));
				} else {
					this.selectedOperationIds.delete(operation.id);
					this.setOperationFields(operation, new Set(operation.kind === 'create' ? operation.preview.requiredIdentityFieldIds : []), false);
				}
				this.refreshControls();
			});
			label.append(checkbox);
			const gameLabel = labels.get(operation.game.identity.canonicalKey) ?? { title: operation.game.title };
			label.createSpan({ text: gameLabel.title });
			if (gameLabel.subtitle !== undefined) {
				const platformText = label.createEl('small', { text: gameLabel.subtitle });
				platformText.dataset.canonicalPreviewPlatforms = operation.id;
			}
			const changes = row.createDiv();
			changes.dataset.canonicalPreviewChanges = operation.id;
			for (const change of operation.preview.changes) this.renderFieldChange(changes, operation, change.fieldId, change.property, change.previous, change.next);
			if (operation.kind === 'create' && operation.preview.body !== undefined) {
				row.createEl('h4', { text: t('sync.canonicalPreview.previewBody') });
				const body = row.createEl('pre', { text: operation.preview.body });
				body.dataset.canonicalPreviewBody = operation.id;
			}
			list.append(row);
		}
	}

	private renderFieldChange(container: HTMLElement, operation: CanonicalOperation, fieldId: string, property: string, previous: unknown, next: unknown): void {
		const row = container.createDiv();
		row.className = 'game-sync-preview-field';
		row.dataset.canonicalPreviewField = fieldId;
		const label = row.createEl('label');
		const checkbox = label.createEl('input');
		checkbox.type = 'checkbox';
		checkbox.checked = this.selectedFieldIdsByOperation.get(operation.id)?.has(fieldId) ?? false;
		checkbox.dataset.canonicalPreviewFieldToggle = fieldId;
		checkbox.dataset.canonicalPreviewFieldOperation = operation.id;
		const required = operation.kind === 'create' && operation.preview.requiredIdentityFieldIds.includes(fieldId);
		const technical = operation.preview.changes.find((change) => change.fieldId === fieldId)?.sourceField === 'updated';
		checkbox.disabled = this.isLastSelectedIdentityField(operation, fieldId) || (technical && this.hasSelectedNonTechnical(operation));
		checkbox.addEventListener('change', () => {
			const selected = this.selectedFieldIdsByOperation.get(operation.id) ?? new Set<string>();
			if (checkbox.checked) selected.add(fieldId);
			else if (!required || this.selectedIdentityFieldCount(operation, selected) > 1) selected.delete(fieldId);
			this.setOperationFields(operation, selected);
			if (checkbox.checked) this.selectedOperationIds.add(operation.id);
			else if (!this.hasSelectedNonTechnical(operation)) this.selectedOperationIds.delete(operation.id);
			this.refreshControls();
		});
		label.append(checkbox);
		const propertyLabel = label.createSpan({ text: `${t('sync.canonicalPreview.property')}: ${property}` });
		propertyLabel.dataset.canonicalPreviewFieldProperty = fieldId;
		const values = row.createDiv();
		values.className = 'game-sync-preview-field-values';
		const previousValue = values.createSpan({ text: `${t('sync.canonicalPreview.previous')}: ${previewValue(previous)}` });
		previousValue.dataset.canonicalPreviewPrevious = fieldId;
		const nextValue = values.createSpan({ text: `${t('sync.canonicalPreview.next')}: ${previewValue(next)}` });
		nextValue.dataset.canonicalPreviewNext = fieldId;
		if (required) row.createEl('small', { text: t('sync.canonicalPreview.requiredIdentity') });
		if (technical) row.createEl('small', { text: t('sync.canonicalPreview.technical') });
	}

	private renderStatusList(kind: 'unchanged' | 'conflict' | 'skip', labels: readonly string[]): void {
		const section = this.contentEl.createDiv();
		section.dataset.canonicalPreviewSection = kind;
		section.createEl('h3', { text: t(`sync.canonicalPreview.${kind}`, { count: labels.length }) });
		if (labels.length === 0) return;
		section.createEl('p', { text: t(`sync.canonicalPreview.${kind}Description` as TranslationKey) });
		const list = section.createDiv();
		list.dataset.canonicalPreviewList = kind;
		for (const label of labels) list.createEl('p', { text: label });
	}

	private statusLabel(status: { canonicalKey: string; reason?: string }, labels: ReadonlyMap<string, PreviewGameLabel>, attention = false): string {
		const title = labels.get(status.canonicalKey)?.title ?? status.canonicalKey;
		return attention && status.reason !== undefined ? `${title}: ${status.reason}` : title;
	}

	private addActionButton(container: HTMLElement, text: string, action: string, onClick: () => void): void {
		const button = this.addButton(container, text, onClick);
		button.dataset.canonicalPreviewAction = action;
		if (action.startsWith('select-all-')) button.dataset.canonicalPreviewSelectAll = action.slice('select-all-'.length);
		if (action.startsWith('deselect-all-')) button.dataset.canonicalPreviewDeselectAll = action.slice('deselect-all-'.length);
	}

	private addButton(container: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
		const button = container.createEl('button');
		button.type = 'button';
		button.textContent = text;
		button.addEventListener('click', onClick);
		return button;
	}

	private refreshControls(): void {
		const summary = this.contentEl.querySelector<HTMLElement>('[data-canonical-preview-selection]');
		const apply = this.contentEl.querySelector<HTMLButtonElement>('[data-canonical-preview-apply]');
		if (summary === null || apply === null) return;
		const conflicts = this.contentEl.querySelector('[data-canonical-preview-section="conflict"] [data-canonical-preview-list]') !== null;
		this.refreshSummary(summary, apply, conflicts);
		for (const checkbox of Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-canonical-preview-operation-toggle]'))) {
			const operation = this.operation(checkbox.dataset.canonicalPreviewOperationToggle ?? '');
			checkbox.checked = operation === undefined ? false : this.isOperationSelected(operation);
		}
		for (const checkbox of Array.from(this.contentEl.querySelectorAll<HTMLInputElement>('[data-canonical-preview-field-toggle]'))) {
			const operationId = checkbox.dataset.canonicalPreviewFieldOperation ?? '';
			const operation = this.operation(operationId);
			checkbox.checked = this.selectedFieldIdsByOperation.get(operationId)?.has(checkbox.dataset.canonicalPreviewFieldToggle ?? '') ?? false;
			const field = operation?.preview.changes.find((change) => change.fieldId === checkbox.dataset.canonicalPreviewFieldToggle);
			checkbox.disabled = operation !== undefined && (this.isLastSelectedIdentityField(operation, checkbox.dataset.canonicalPreviewFieldToggle ?? '') || (field?.sourceField === 'updated' && this.hasSelectedNonTechnical(operation)));
		}
	}

	private refreshSummary(summary: HTMLElement, apply: HTMLButtonElement, hasConflicts: boolean, plan?: NonNullable<CanonicalPreviewResult['plan']>): void {
		const total = plan === undefined ? this.totalOperations() : plan.operations.length;
		const count = this.selectedOperationCount();
		summary.textContent = t('sync.canonicalPreview.selectionSummary', { selected: count, total });
		apply.textContent = t('sync.canonicalPreview.apply', { count });
		apply.disabled = count === 0 || hasConflicts;
	}

	private totalOperations(): number {
		return this.contentEl.querySelectorAll<HTMLElement>('[data-canonical-preview-operation]').length;
	}

	private operation(id: string): CanonicalOperation | undefined {
		return this.options.preview.plan?.operations.find((operation) => operation.id === id);
	}

	private isOperationSelected(operation: CanonicalOperation): boolean {
		return this.selectedOperationIds.has(operation.id);
	}

	private selectedOperationCount(): number {
		return this.selectedOperationIds.size;
	}

	private setOperationFields(operation: CanonicalOperation, fieldIds: Set<string>, includeTechnical = true): void {
		if (includeTechnical && this.hasFieldsExceptTechnical(operation, fieldIds)) {
			for (const change of operation.preview.changes) if (change.sourceField === 'updated') fieldIds.add(change.fieldId);
		} else if (!this.hasFieldsExceptTechnical(operation, fieldIds)) {
			for (const change of operation.preview.changes) if (change.sourceField === 'updated') fieldIds.delete(change.fieldId);
		}
		this.selectedFieldIdsByOperation.set(operation.id, fieldIds);
	}

	private hasFieldsExceptTechnical(operation: CanonicalOperation, fieldIds: ReadonlySet<string>): boolean {
		return operation.preview.changes.some((change) => fieldIds.has(change.fieldId) && change.sourceField !== 'updated');
	}

	private hasSelectedNonTechnical(operation: CanonicalOperation): boolean {
		return this.hasFieldsExceptTechnical(operation, this.selectedFieldIdsByOperation.get(operation.id) ?? new Set<string>());
	}

	private selectedIdentityFieldCount(operation: CanonicalOperation, fieldIds: ReadonlySet<string>): number {
		return operation.preview.requiredIdentityFieldIds.filter((fieldId) => fieldIds.has(fieldId)).length;
	}

	private isLastSelectedIdentityField(operation: CanonicalOperation, fieldId: string): boolean {
		if (operation.kind !== 'create' || !operation.preview.requiredIdentityFieldIds.includes(fieldId)) return false;
		const selected = this.selectedFieldIdsByOperation.get(operation.id) ?? new Set<string>();
		return selected.has(fieldId) && this.selectedIdentityFieldCount(operation, selected) <= 1;
	}

	private async apply(): Promise<void> {
		if (this.applying || this.selectedOperationCount() === 0) return;
		this.applying = true;
		const error = this.contentEl.querySelector<HTMLElement>('[data-canonical-preview-error]');
		if (error !== null) {
			error.textContent = '';
			error.hidden = true;
		}
		try {
			const operationIds: string[] = [];
			const fieldIdsByOperation: Record<string, readonly string[]> = {};
			for (const operation of this.options.preview.plan?.operations ?? []) {
				if (!this.selectedOperationIds.has(operation.id)) continue;
				const fields = this.selectedFieldIdsByOperation.get(operation.id);
				if (fields === undefined || fields.size === 0) continue;
				if (operation.kind === 'create' && this.selectedIdentityFieldCount(operation, fields) === 0) continue;
				operationIds.push(operation.id);
				fieldIdsByOperation[operation.id] = [...fields];
			}
			if (operationIds.length === 0) return;
			await this.options.onApply({ operationIds, fieldIdsByOperation });
			this.close();
		} catch {
			if (error !== null) {
				error.textContent = t('sync.canonicalPreview.applyFailed');
				error.hidden = false;
			}
		} finally {
			this.applying = false;
			this.refreshControls();
		}
	}
}
