import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { GameProvider } from '../model/provider';

export type IgnoredGameKind = 'canonical' | 'providerRef';

export interface IgnoredGameEntry {
	kind: IgnoredGameKind;
	id: string;
	label: string;
	provider: GameProvider;
}

export interface IgnoredGamesAdapter {
	entries: readonly IgnoredGameEntry[];
	list?: () => readonly IgnoredGameEntry[] | Promise<readonly IgnoredGameEntry[]>;
	restore(ids: readonly string[]): Promise<void>;
}

export interface IgnoredGamesModalOptions {
	adapter: IgnoredGamesAdapter;
}

function translation(key: string): string {
	return t(key as TranslationKey);
}

export class IgnoredGamesModal extends Modal {
	private lifecycle = 0;
	private isOpen = false;
	private search = '';
	private entries: readonly IgnoredGameEntry[] = [];
	private selected = new Set<string>();
	private statusEl?: HTMLElement;
	private rows: Array<{ entry: IgnoredGameEntry; element: HTMLElement }> = [];

	constructor(app: App, private readonly options: IgnoredGamesModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.lifecycle += 1;
		this.search = '';
		this.selected.clear();
		this.entries = this.options.adapter.entries;
		this.setTitle(translation('ignoredGames.title'));
		this.contentEl.replaceChildren();
		this.render();
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		this.selected.clear();
	}

	private element<K extends keyof HTMLElementTagNameMap>(tag: K, parent = this.contentEl): HTMLElementTagNameMap[K] {
		return parent.createEl(tag);
	}

	private render(): void {
		const search = new Setting(this.contentEl).setName(translation('ignoredGames.search'));
		search.addText((component) => {
			component.inputEl.type = 'search';
			component.inputEl.dataset.ignoredGamesSearch = 'true';
			component.inputEl.addEventListener('input', () => {
				this.search = component.inputEl.value;
				this.updateVisibility();
			});
		});

		const actions = new Setting(this.contentEl);
		actions.addButton((button) => {
			button.setButtonText(translation('ignoredGames.restoreSelected'));
			button.buttonEl.dataset.ignoredGamesRestoreSelected = 'true';
			button.setDisabled(true);
			button.onClick(() => void this.restoreSelected(button.buttonEl));
		});

		this.statusEl = this.element('p');
		this.statusEl.dataset.ignoredGamesStatus = 'true';
		const rows = this.element('div');
		rows.dataset.ignoredGamesRows = 'true';
		this.renderRows(rows);

		const footer = new Setting(this.contentEl);
		footer.addButton((button) => {
			button.setButtonText(translation('sync.summary.close'));
			button.onClick(() => this.close());
		});
	}

	private renderRows(parent: HTMLElement): void {
		parent.replaceChildren();
		this.rows = [];
		if (this.entries.length === 0) {
			if (this.statusEl !== undefined) this.statusEl.textContent = translation('ignoredGames.noEntries');
			this.updateRestoreSelectedButton();
			return;
		}
		if (this.statusEl !== undefined) this.statusEl.textContent = '';
		for (const entry of this.entries) {
			const row = this.element('section', parent);
			row.dataset.ignoredGameRow = entry.id;
			row.dataset.ignoredGameKind = entry.kind;
			const setting = new Setting(row).setName(entry.label).setDesc(`${entry.provider}: ${entry.id}`);
			setting.addToggle((toggle) => {
				toggle.toggleEl.dataset.ignoredGameCheckbox = entry.id;
				toggle.setValue(this.selected.has(entry.id));
				toggle.onChange((checked) => {
					if (checked) this.selected.add(entry.id);
					else this.selected.delete(entry.id);
					this.updateRestoreSelectedButton();
				});
			});
			setting.addButton((button) => {
				button.setButtonText(translation('ignoredGames.restore'));
				button.buttonEl.dataset.ignoredGameRestore = entry.id;
				button.onClick(() => void this.restore([entry.id], button.buttonEl));
			});
			this.rows.push({ entry, element: row });
		}
		this.updateVisibility();
		this.updateRestoreSelectedButton();
	}

	private updateVisibility(): void {
		const query = this.search.trim().toLocaleLowerCase();
		for (const { entry, element } of this.rows) {
			const values = [entry.id, entry.label, entry.provider, entry.kind];
			element.hidden = query.length > 0 && !values.some((value) => value.toLocaleLowerCase().includes(query));
		}
	}

	private updateRestoreSelectedButton(): void {
		const button = this.contentEl.querySelector<HTMLButtonElement>('[data-ignored-games-restore-selected]');
		if (button !== null) button.disabled = this.selected.size === 0 || !this.isOpen;
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private async restore(ids: readonly string[], button: HTMLButtonElement): Promise<void> {
		if (!this.isOpen || ids.length === 0) return;
		const version = this.lifecycle;
		button.disabled = true;
		try {
			await this.options.adapter.restore(ids);
			if (!this.isCurrent(version)) return;
			this.selected = new Set([...this.selected].filter((id) => !ids.includes(id)));
			this.entries = await (this.options.adapter.list?.() ?? this.options.adapter.entries);
			if (!this.isCurrent(version)) return;
			const rows = this.contentEl.querySelector<HTMLElement>('[data-ignored-games-rows]');
			if (rows !== null) this.renderRows(rows);
		} catch {
			if (this.isCurrent(version)) this.setStatus(translation('ignoredGames.restoreFailed'));
		} finally {
			if (this.isCurrent(version)) this.updateRestoreSelectedButton();
		}
	}

	private async restoreSelected(button: HTMLButtonElement): Promise<void> {
		const ids = [...this.selected];
		await this.restore(ids, button);
	}
}

export { IgnoredGamesModal as GameSyncIgnoredGamesModal };
