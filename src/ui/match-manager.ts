import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { GameProvider } from '../model/provider';
import type { MatchManagerAdapter, MatchManagerCategory, MatchManagerRow, MatchResolutionAction, PreparedUnmerge, UnmergePreview } from '../model/match-manager';

export type { MatchManagerAdapter, MatchManagerCategory, MatchManagerProvider, MatchManagerRow, MatchResolutionAction, PreparedUnmerge, UnmergePlan, UnmergePreview, UnmergePropertyChange } from '../model/match-manager';

export interface MatchManagerModalOptions {
	adapter: MatchManagerAdapter;
}

const CATEGORIES: readonly MatchManagerCategory[] = ['merged', 'kept-separate', 'unresolved'];

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function rowKey(row: MatchManagerRow): string {
	if (row.category === 'kept-separate') return `${row.leftCanonicalId}:${row.rightCanonicalId}`;
	return row.canonicalId;
}

function rowLabel(row: MatchManagerRow): string {
	if (row.title !== undefined && row.title.trim().length > 0) return row.title;
	if (row.category === 'kept-separate') return `${row.leftCanonicalId} / ${row.rightCanonicalId}`;
	return row.canonicalId;
}

export class MatchManagerModal extends Modal {
	private readonly selectedProviders = new Map<string, GameProvider>();
	private readonly selectedCandidates = new Map<string, string>();
	private lifecycle = 0;
	private isOpen = false;
	private category: MatchManagerCategory = 'merged';
	private search = '';
	private statusEl?: HTMLElement;
	private rows: Array<{ row: MatchManagerRow; element: HTMLElement }> = [];

	constructor(app: App, private readonly options: MatchManagerModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.lifecycle += 1;
		this.category = 'merged';
		this.search = '';
		this.selectedProviders.clear();
		this.selectedCandidates.clear();
		this.rows = [];
		this.setTitle(translation('matchManager.title'));
		this.contentEl.replaceChildren();
		this.render();
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K, parent = this.contentEl): HTMLElementTagNameMap[K] {
		return parent.createEl(tag);
	}

	private render(): void {
		const search = new Setting(this.contentEl)
			.setName(translation('matchManager.search'))
			.setDesc(translation('matchManager.searchDescription'));
		search.addText((component) => {
			component.inputEl.type = 'search';
			component.inputEl.dataset.matchManagerSearch = 'true';
			component.inputEl.placeholder = translation('matchManager.searchPlaceholder');
			component.inputEl.addEventListener('input', () => {
				this.search = component.inputEl.value;
				this.updateVisibility();
			});
		});

		const tabs = this.element('div');
		tabs.dataset.matchManagerTabs = 'true';
		for (const category of CATEGORIES) {
			const tab = this.element('button', tabs);
			tab.type = 'button';
			tab.dataset.matchManagerTab = category;
			tab.textContent = translation(`matchManager.tabs.${category === 'kept-separate' ? 'keptSeparate' : category}`);
			tab.addEventListener('click', () => {
				this.category = category;
				this.updateVisibility();
			});
		}

		this.statusEl = this.element('p');
		this.statusEl.dataset.matchManagerStatus = 'true';
		const rowsEl = this.element('div');
		rowsEl.dataset.matchManagerRows = 'true';
		for (const row of this.options.adapter.rows) this.renderRow(row, rowsEl);
		if (this.options.adapter.rows.length === 0) this.statusEl.textContent = translation('matchManager.noRows');
		this.updateVisibility();

		const footer = new Setting(this.contentEl);
		footer.addButton((button) => {
			button.setButtonText(translation('sync.summary.close'));
			button.onClick(() => this.close());
		});
	}

	private renderRow(row: MatchManagerRow, parent: HTMLElement): void {
		const section = this.element('section', parent);
		section.dataset.matchManagerRow = rowKey(row);
		section.dataset.matchManagerCategory = row.category;
		this.rows.push({ row, element: section });

		const heading = new Setting(section).setName(rowLabel(row));
		heading.settingEl.dataset.matchManagerRowHeader = rowKey(row);
		if (row.existingPath !== undefined) heading.setDesc(row.existingPath);

		if (row.providers.length > 0) {
			const providerList = this.element('ul', section);
			providerList.dataset.matchManagerProviders = rowKey(row);
			for (const provider of row.providers) {
				const item = this.element('li', providerList);
				item.dataset.matchProviderOption = provider.provider;
				item.textContent = `${provider.providerName} (${provider.providerRef})`;
			}
		}

		if (row.category === 'merged') this.renderMergedActions(row, section);
		if (row.category === 'kept-separate') this.renderKeptSeparateActions(row, section);
		if (row.category === 'unresolved') {
			this.renderUnresolvedActions(row, section);
		}
	}

	private renderUnresolvedActions(row: Extract<MatchManagerRow, { category: 'unresolved' }>, parent: HTMLElement): void {
		const action = new Setting(parent).setName(translation('matchManager.reviewStatus'));
		const candidates = row.candidatePaths ?? (row.candidatePath === undefined ? [] : [row.candidatePath]);
		if (candidates.length > 1) {
			const candidateSelect = new Setting(parent).setName(translation('matchManager.candidate'));
			candidateSelect.addDropdown((dropdown) => {
				dropdown.selectEl.dataset.matchManagerCandidateSelect = rowKey(row);
				dropdown.addOption('', translation('matchManager.chooseCandidate'));
				for (const path of candidates) dropdown.addOption(path, path);
				dropdown.setValue('');
				dropdown.onChange((value) => {
					if (value === '') this.selectedCandidates.delete(rowKey(row));
					else this.selectedCandidates.set(rowKey(row), value);
					this.updateUnresolvedButtons(row);
				});
			});
		} else if (candidates.length === 1) {
			action.setDesc(candidates[0]);
		} else if (row.reason !== undefined) {
			action.setDesc(row.reason);
		}
		for (const resolution of ['merge', 'keep-separate', 'skip'] as const) {
			action.addButton((button) => {
				button.setButtonText(translation(`sync.preview.actions.${resolution}`));
				button.buttonEl.dataset.matchManagerResolution = `${resolution}:${rowKey(row)}`;
				button.setDisabled(resolution !== 'skip' && this.unresolvedCandidate(row) === undefined);
				button.onClick(() => void this.resolveUnresolved(row, resolution, button.buttonEl));
			});
		}
	}

	private unresolvedCandidate(row: Extract<MatchManagerRow, { category: 'unresolved' }>): string | undefined {
		const candidates = row.candidatePaths ?? (row.candidatePath === undefined ? [] : [row.candidatePath]);
		return this.selectedCandidates.get(rowKey(row)) ?? (candidates.length === 1 ? candidates[0] : undefined);
	}

	private updateUnresolvedButtons(row: Extract<MatchManagerRow, { category: 'unresolved' }>): void {
		const candidate = this.unresolvedCandidate(row);
		for (const resolution of ['merge', 'keep-separate'] as const) {
			const button = this.contentEl.querySelector<HTMLButtonElement>(`[data-match-manager-resolution="${resolution}:${rowKey(row)}"]`);
			if (button !== null) button.disabled = candidate === undefined;
		}
	}

	private renderMergedActions(row: Extract<MatchManagerRow, { category: 'merged' }>, parent: HTMLElement): void {
		const setting = new Setting(parent).setName(translation('matchManager.providerToKeep'));
		setting.addDropdown((dropdown) => {
			dropdown.selectEl.dataset.matchManagerProviderSelect = row.canonicalId;
			dropdown.addOption('', translation('matchManager.chooseProvider'));
			for (const provider of row.providers) {
				dropdown.addOption(provider.provider, provider.providerName);
			}
			dropdown.setValue('');
			dropdown.onChange((value) => {
				if (value === '') this.selectedProviders.delete(row.canonicalId);
				else this.selectedProviders.set(row.canonicalId, value as GameProvider);
				this.updatePrepareButton(row.canonicalId);
			});
		});

		const action = new Setting(parent);
		action.addButton((button) => {
			button.setButtonText(translation('matchManager.prepareUnmerge'));
			button.buttonEl.dataset.matchManagerPrepare = row.canonicalId;
			button.setDisabled(true);
			button.onClick(() => void this.prepare(row, button.buttonEl));
		});
	}

	private renderKeptSeparateActions(row: Extract<MatchManagerRow, { category: 'kept-separate' }>, parent: HTMLElement): void {
		const action = new Setting(parent);
		action.addButton((button) => {
			button.setButtonText(translation('matchManager.allowMatchingAgain'));
			button.buttonEl.dataset.matchManagerAllow = rowKey(row);
			button.onClick(() => void this.allowMatchingAgain(row, button.buttonEl));
		});
	}

	private updatePrepareButton(canonicalId: string): void {
		const button = this.contentEl.querySelector<HTMLButtonElement>(`[data-match-manager-prepare="${canonicalId}"]`);
		if (button !== null) button.disabled = !this.selectedProviders.has(canonicalId);
	}

	private matches(row: MatchManagerRow): boolean {
		const query = this.search.trim().toLocaleLowerCase();
		if (query.length === 0) return true;
		const providerValues = row.providers.flatMap((provider) => [provider.provider, provider.providerRef, provider.providerName]);
		const values = row.category === 'kept-separate'
			? [row.leftCanonicalId, row.rightCanonicalId, row.title ?? '', row.existingPath ?? '', ...providerValues]
			: [row.canonicalId, row.title ?? '', row.existingPath ?? '', ...providerValues];
		return values.some((value) => value.toLocaleLowerCase().includes(query));
	}

	private updateVisibility(): void {
		for (const { row, element } of this.rows) element.hidden = row.category !== this.category || !this.matches(row);
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private async prepare(row: Extract<MatchManagerRow, { category: 'merged' }>, button: HTMLButtonElement): Promise<void> {
		const providerToKeep = this.selectedProviders.get(row.canonicalId);
		if (providerToKeep === undefined || !this.isOpen) return;
		const version = this.lifecycle;
		button.disabled = true;
		try {
			const prepared = await this.options.adapter.prepareUnmerge(row.canonicalId, providerToKeep);
			if (!this.isCurrent(version)) return;
			this.renderPrepared(row, button.parentElement?.parentElement ?? this.contentEl, prepared);
		} catch {
			if (this.isCurrent(version)) this.setStatus(translation('matchManager.prepareFailed'));
		} finally {
			if (this.isCurrent(version)) button.disabled = false;
		}
	}

	private renderPrepared(row: Extract<MatchManagerRow, { category: 'merged' }>, parent: HTMLElement, prepared: PreparedUnmerge): void {
		parent.querySelector('[data-match-manager-preview]')?.remove();
		const preview = this.element('div', parent);
		preview.dataset.matchManagerPreview = row.canonicalId;
		const details: UnmergePreview = prepared.preview;
		if (prepared.conflict !== undefined) {
			preview.textContent = translation('matchManager.conflict');
			return;
		}
		preview.textContent = [
			`${details.existingPath} -> ${details.newPath}`,
			`${details.providerToKeep}: ${details.providerToKeepId}; ${details.providerToSplit}: ${details.providerToSplitId}`,
			`${translation('matchManager.propertiesRemoved')}: ${details.propertiesRemoved.map((property) => property.name).join(', ')}`,
			`${translation('matchManager.propertiesAdded')}: ${details.propertiesAdded.map((property) => property.name).join(', ')}`,
		].join(' | ');
		const action = new Setting(parent);
		action.addButton((button) => {
			button.setButtonText(translation('matchManager.applyUnmerge'));
			button.buttonEl.dataset.matchManagerApply = row.canonicalId;
			button.onClick(() => void this.applyPrepared(row, prepared, button.buttonEl, preview));
		});
	}

	private async applyPrepared(row: Extract<MatchManagerRow, { category: 'merged' }>, prepared: PreparedUnmerge, button: HTMLButtonElement, preview: HTMLElement): Promise<void> {
		if (!this.isOpen) return;
		const version = this.lifecycle;
		button.disabled = true;
		try {
			await this.options.adapter.applyUnmerge(prepared);
			if (this.isCurrent(version)) {
				preview.dataset.matchManagerPrepared = row.canonicalId;
				preview.textContent = `${translation('matchManager.prepared', { planId: prepared.planId })} ${translation('matchManager.applied')}`;
			}
		} catch {
			if (this.isCurrent(version)) this.setStatus(translation('matchManager.applyFailed'));
		} finally {
			if (this.isCurrent(version)) button.disabled = false;
		}
	}

	private async allowMatchingAgain(row: Extract<MatchManagerRow, { category: 'kept-separate' }>, button: HTMLButtonElement): Promise<void> {
		if (!this.isOpen) return;
		const version = this.lifecycle;
		button.disabled = true;
		try {
			await this.options.adapter.allowMatchingAgain(row.leftCanonicalId, row.rightCanonicalId);
		} catch {
			if (this.isCurrent(version)) this.setStatus(translation('matchManager.allowFailed'));
		} finally {
			if (this.isCurrent(version)) button.disabled = false;
		}
	}

	private async resolveUnresolved(row: Extract<MatchManagerRow, { category: 'unresolved' }>, resolution: MatchResolutionAction, button: HTMLButtonElement): Promise<void> {
		if (!this.isOpen) return;
		const version = this.lifecycle;
		button.disabled = true;
		try { await this.options.adapter.resolveUnresolved(row.canonicalId, resolution, this.unresolvedCandidate(row)); } catch { if (this.isCurrent(version)) this.setStatus(translation('matchManager.resolveFailed')); }
		finally { if (this.isCurrent(version)) button.disabled = false; }
	}
}

export { MatchManagerModal as GameSyncMatchManagerModal };
