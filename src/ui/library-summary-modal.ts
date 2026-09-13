import { Modal, type App } from 'obsidian';
import type { LibrarySummaryViewModel } from '../model/library-summary';

export interface LibrarySummaryModalInjected {
	t?: (key: string, params?: Record<string, string | number>) => string;
}

export interface LibrarySummaryModalOptions {
	summary: LibrarySummaryViewModel;
	onOpenBase: () => void | Promise<void>;
	onSyncNow: () => void | Promise<void>;
	injected?: LibrarySummaryModalInjected;
}

type LibrarySummaryMetric = Exclude<keyof LibrarySummaryViewModel, 'lastSyncAt'> | 'lastSyncAt';

const METRICS: readonly LibrarySummaryMetric[] = [
	'totalGames',
	'owned',
	'previouslyPlayedNoLongerOwned',
	'steamGames',
	'playstationGames',
	'crossPlatform',
	'neverPlayed',
	'steam100Percent',
	'playstationPlatinum',
	'lastSyncAt',
];

const LABELS: Record<LibrarySummaryMetric | 'title', string> = {
	title: 'Library summary',
	totalGames: 'Total games',
	owned: 'Owned',
	previouslyPlayedNoLongerOwned: 'Previously played, no longer owned',
	steamGames: 'Steam games',
	playstationGames: 'PlayStation games',
	crossPlatform: 'Cross-platform',
	neverPlayed: 'Never played',
	steam100Percent: 'Steam 100%',
	playstationPlatinum: 'PlayStation platinum',
	lastSyncAt: 'Last sync',
};

function fallbackKey(key: string): string {
	return `librarySummary.${key}`;
}

export class LibrarySummaryModal extends Modal {
	private readonly options: LibrarySummaryModalOptions;

	constructor(app: App, options: LibrarySummaryModalOptions) {
		super(app);
		this.options = options;
	}

	override onOpen(): void {
		this.contentEl.replaceChildren();
		this.setTitle(this.translate('title'));
		this.render();
	}

	override onClose(): void {
		// Closing the modal must not invoke either action callback.
	}

	private render(): void {
		const metrics = this.contentEl.createEl('section');
		metrics.dataset.librarySummarySection = 'metrics';
		for (const metric of METRICS) this.renderMetric(metrics, metric);
		this.contentEl.append(metrics);

		const actions = this.contentEl.createEl('section');
		actions.dataset.librarySummarySection = 'actions';
		actions.append(this.actionButton('openBase', 'Open Games.base', this.options.onOpenBase));
		actions.append(this.actionButton('syncNow', 'Sync now', this.options.onSyncNow));
		this.contentEl.append(actions);
	}

	private renderMetric(parent: HTMLElement, metric: LibrarySummaryMetric): void {
		const row = parent.createDiv();
		row.dataset.librarySummary = metric;
		const label = row.createSpan();
		label.textContent = `${this.translate(metric)}: `;
		const value = row.createSpan();
		value.textContent = metric === 'lastSyncAt' ? (this.options.summary.lastSyncAt ?? '—') : String(this.options.summary[metric]);
		row.append(label, value);
		parent.append(row);
	}

	private actionButton(action: 'openBase' | 'syncNow', fallback: string, callback: () => void | Promise<void>): HTMLButtonElement {
		const button = this.contentEl.createEl('button');
		button.type = 'button';
		button.dataset.librarySummaryAction = action;
		button.textContent = this.translate(action, fallback);
		button.addEventListener('click', () => {
			try {
				void Promise.resolve(callback()).catch(() => undefined);
			} catch {
				// Action errors are handled by the caller and are never rendered here.
			}
		});
		return button;
	}

	private translate(key: string, fallback = LABELS[key as LibrarySummaryMetric | 'title'] ?? fallbackKey(key)): string {
		try {
			const translated = this.options.injected?.t?.(fallbackKey(key));
			if (translated !== undefined && translated.trim().length > 0 && translated !== fallbackKey(key)) return translated;
		} catch {
			// Keep the safe English fallback when translation is unavailable.
		}
		return fallback;
	}
}
