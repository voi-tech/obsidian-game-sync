import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import type { CanonicalPreviewResult } from '../sync/canonical-service';

export interface CanonicalPreviewModalOptions {
	readonly preview: CanonicalPreviewResult;
	readonly onApply: (operationIds: readonly string[]) => void | Promise<void>;
}

export class CanonicalPreviewModal extends Modal {
	private applying = false;

	constructor(app: App, private readonly options: CanonicalPreviewModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('sync.canonicalPreview.title'));
		this.contentEl.replaceChildren();
		const { snapshot, plan } = this.options.preview;
		if (snapshot.status !== 'complete' || plan === undefined) {
			this.contentEl.createEl('p', { text: t('sync.canonicalPreview.incomplete') });
			this.contentEl.createEl('p', { text: t('sync.canonicalPreview.noChanges') });
			new Setting(this.contentEl).addButton((button) => button.setButtonText(t('sync.preview.close')).onClick(() => this.close()));
			return;
		}

		this.contentEl.createEl('p', { text: t('sync.canonicalPreview.gamesRead', { count: snapshot.games.length }) });
		const warnings = (this.options.preview.enrichments ?? []).flatMap((enrichment) => enrichment.diagnostics);
		if (warnings.length > 0) this.contentEl.createEl('p', { text: `${warnings.length} optional data warning${warnings.length === 1 ? '' : 's'}.` });
		const counts = {
			create: plan.statuses.filter((status) => status.status === 'create').length,
			update: plan.statuses.filter((status) => status.status === 'update').length,
			unchanged: plan.statuses.filter((status) => status.status === 'unchanged').length,
			conflict: plan.statuses.filter((status) => status.status === 'conflict').length,
			skip: plan.statuses.filter((status) => status.status === 'skip').length,
		};
		const summary = this.contentEl.createDiv();
		summary.dataset.canonicalPreviewSummary = 'true';
		for (const [kind, count] of Object.entries(counts)) {
			const item = summary.createEl('p');
			item.dataset.canonicalPreviewCount = kind;
			item.textContent = t(`sync.canonicalPreview.${kind}` as TranslationKey, { count });
		}
		if (counts.conflict > 0) this.contentEl.createEl('p', { text: t('sync.canonicalPreview.reviewRequired') });

		const footer = new Setting(this.contentEl);
		footer.addButton((button) => button.setButtonText(t('sync.preview.close')).onClick(() => this.close()));
		footer.addButton((button) => {
			button.setButtonText(t('sync.canonicalPreview.apply'));
			button.setCta();
			button.buttonEl.dataset.canonicalPreviewApply = 'true';
			button.setDisabled(plan.operations.length === 0 || counts.conflict > 0);
			button.onClick(() => void this.apply(plan.operations.map((operation) => operation.id)));
		});
	}

	private async apply(operationIds: readonly string[]): Promise<void> {
		if (this.applying) return;
		this.applying = true;
		try {
			await this.options.onApply(operationIds);
			this.close();
		} finally {
			this.applying = false;
		}
	}
}
