import { Modal, Notice, Setting, type App } from 'obsidian';
import { t } from '../i18n';
import type { PropertyMapping } from '../model/property-mapping';
import { applyPurchase, parsePurchaseCsv, planPurchaseImport, type PurchaseImportPlan, type PurchaseMatch } from '../purchases/playstation-purchases';
import { PLAYSTATION_EXPORT_SCRIPT } from '../purchases/playstation-export-script';
import type { IndexedNote } from '../vault/note-index';

export const PLAYSTATION_TRANSACTIONS_URL = 'https://id.sonyentertainmentnetwork.com/id/management_ca/#/p/transaction_history';

export interface PurchaseImportModalOptions {
	readonly notesFolder: string;
	readonly propertyMapping: PropertyMapping;
	readonly loadNotes: () => Promise<readonly IndexedNote[]>;
	readonly writeFrontmatter: (path: string, update: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
	readonly readClipboard: () => Promise<string>;
	readonly writeClipboard: (text: string) => Promise<void>;
	readonly openUrl: (url: string) => void;
}

/** Import of PlayStation purchase dates and prices from the CSV produced by the console script. */
export class PurchaseImportModal extends Modal {
	private plan?: PurchaseImportPlan;
	private selected = new Set<string>();
	private busy = false;

	constructor(app: App, private readonly options: PurchaseImportModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('purchases.title'));
		this.modalEl.classList.add('game-sync-purchase-import');
		this.renderInstructions();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderInstructions(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: t('purchases.intro'), cls: 'game-sync-preview-intro' });
		const steps = this.contentEl.createEl('ol', { cls: 'game-sync-purchase-steps' });
		steps.createEl('li', { text: t('purchases.stepOpen') });
		steps.createEl('li', { text: t('purchases.stepScript') });
		steps.createEl('li', { text: t('purchases.stepRange') });
		steps.createEl('li', { text: t('purchases.stepPaste') });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t('purchases.openHistory')).onClick(() => this.options.openUrl(PLAYSTATION_TRANSACTIONS_URL)))
			.addButton((button) => button.setButtonText(t('purchases.copyScript')).onClick(() => void this.copyScript()));
		const status = this.contentEl.createEl('p', { cls: 'game-sync-purchase-status' });
		status.dataset.purchaseStatus = 'true';
		const footer = this.contentEl.createDiv({ cls: 'modal-button-container' });
		footer.createEl('button', { text: t('sync.preview.close') }).addEventListener('click', () => this.close());
		const paste = footer.createEl('button', { text: t('purchases.paste'), cls: 'mod-cta' });
		paste.dataset.purchasePaste = 'true';
		paste.addEventListener('click', () => void this.readFromClipboard(status, paste));
	}

	private async copyScript(): Promise<void> {
		try {
			await this.options.writeClipboard(PLAYSTATION_EXPORT_SCRIPT);
			new Notice(t('purchases.scriptCopied'));
		} catch {
			new Notice(t('purchases.clipboardFailed'));
		}
	}

	private async readFromClipboard(status: HTMLElement, button: HTMLButtonElement): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		button.disabled = true;
		status.textContent = t('purchases.reading');
		try {
			const text = await this.options.readClipboard();
			const rows = parsePurchaseCsv(text);
			if (rows.length === 0) throw new Error('empty');
			this.plan = planPurchaseImport(rows, await this.options.loadNotes(), { notesFolder: this.options.notesFolder, propertyMapping: this.options.propertyMapping });
			this.selected = new Set(this.plan.matches.filter((match) => match.changed).map((match) => match.path));
			this.renderPlan(this.plan);
		} catch {
			status.textContent = t('purchases.invalidClipboard');
		} finally {
			this.busy = false;
			button.disabled = false;
		}
	}

	private renderPlan(plan: PurchaseImportPlan): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			cls: 'game-sync-preview-intro',
			text: t('purchases.summary', { rows: plan.rows, purchases: plan.purchases, refunded: plan.refunded, matched: plan.matches.length }),
		});
		const list = this.contentEl.createDiv({ cls: 'game-sync-preview-list' });
		const changed = plan.matches.filter((match) => match.changed);
		const unchanged = plan.matches.filter((match) => !match.changed);
		if (changed.length > 0) this.section(list, t('purchases.toUpdate'), changed, true);
		if (unchanged.length > 0) this.section(list, t('purchases.upToDate'), unchanged, false);
		if (plan.ambiguous.length > 0) this.textSection(list, t('purchases.ambiguous'), plan.ambiguous);
		if (plan.unmatched.length > 0) this.textSection(list, t('purchases.unmatched'), plan.unmatched);
		const footer = this.contentEl.createDiv({ cls: 'modal-button-container game-sync-preview-footer' });
		const status = footer.createSpan({ cls: 'game-sync-preview-status' });
		footer.createEl('button', { text: t('purchases.back') }).addEventListener('click', () => this.renderInstructions());
		const apply = footer.createEl('button', { cls: 'mod-cta' });
		apply.dataset.purchaseApply = 'true';
		const refresh = (): void => {
			apply.textContent = t('purchases.apply', { count: this.selected.size });
			apply.disabled = this.selected.size === 0 || this.busy;
		};
		apply.addEventListener('click', () => void this.apply(plan, status, apply, refresh));
		this.refreshApply = refresh;
		refresh();
	}

	private refreshApply: () => void = () => undefined;

	private section(parent: HTMLElement, title: string, matches: readonly PurchaseMatch[], selectable: boolean): void {
		const section = parent.createEl('section', { cls: 'game-sync-preview-section' });
		const header = section.createDiv({ cls: 'game-sync-preview-section-header' });
		header.createSpan({ cls: 'game-sync-preview-section-title', text: title });
		header.createSpan({ cls: 'game-sync-preview-section-count', text: String(matches.length) });
		const rows = section.createDiv({ cls: 'game-sync-preview-rows' });
		for (const match of matches) {
			const row = rows.createEl(selectable ? 'label' : 'div', { cls: `game-sync-preview-row${selectable ? '' : ' is-muted'}` });
			row.dataset.purchaseRow = match.path;
			if (selectable) {
				const checkbox = row.createEl('input', { cls: 'game-sync-preview-checkbox' });
				checkbox.type = 'checkbox';
				checkbox.checked = this.selected.has(match.path);
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selected.add(match.path); else this.selected.delete(match.path);
					this.refreshApply();
				});
			}
			const text = row.createDiv({ cls: 'game-sync-preview-row-text' });
			text.createDiv({ cls: 'game-sync-preview-row-title', text: match.title });
			const product = match.productNames.find((name) => name !== match.title);
			if (product !== undefined) text.createDiv({ cls: 'game-sync-preview-row-meta', text: product });
			const price = match.price === undefined ? '' : ` · ${match.price.toFixed(2)}${match.currency === undefined ? '' : ` ${match.currency}`}`;
			row.createDiv({ cls: 'game-sync-preview-row-tags' }).createSpan({ cls: 'game-sync-preview-tag', text: `${match.date}${price}` });
		}
	}

	private textSection(parent: HTMLElement, title: string, names: readonly string[]): void {
		const section = parent.createEl('section', { cls: 'game-sync-preview-section' });
		const header = section.createDiv({ cls: 'game-sync-preview-section-header' });
		header.createSpan({ cls: 'game-sync-preview-section-title', text: title });
		header.createSpan({ cls: 'game-sync-preview-section-count', text: String(names.length) });
		const rows = section.createDiv({ cls: 'game-sync-preview-rows' });
		for (const name of names) rows.createDiv({ cls: 'game-sync-preview-row is-muted', text: name });
	}

	private async apply(plan: PurchaseImportPlan, status: HTMLElement, button: HTMLButtonElement, refresh: () => void): Promise<void> {
		if (this.busy || this.selected.size === 0) return;
		this.busy = true;
		button.classList.add('is-loading');
		refresh();
		let written = 0;
		let failed = 0;
		for (const match of plan.matches) {
			if (!this.selected.has(match.path)) continue;
			try {
				await this.options.writeFrontmatter(match.path, (frontmatter) => applyPurchase(frontmatter, match, this.options.propertyMapping));
				written += 1;
			} catch {
				failed += 1;
			}
		}
		this.busy = false;
		button.classList.remove('is-loading');
		if (failed === 0) {
			new Notice(t('purchases.done', { count: written }));
			this.close();
			return;
		}
		status.textContent = t('purchases.partial', { written, failed });
		refresh();
	}
}
