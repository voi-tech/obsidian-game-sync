import { Modal, Setting } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import { TEMPLATE_HELPERS, TEMPLATE_PARTIALS, TEMPLATE_PUBLIC_KEYS } from '../vault/template-reference';

type TemplateKeyCategory = 'common' | 'steam' | 'playstation' | 'achievements' | 'purchase' | 'convenience' | 'helpers';

interface TemplateKeyEntry {
	key: string;
	category: TemplateKeyCategory;
	copyText: string;
}

const COMMON_KEYS = new Set([
	'id', 'title', 'original', 'year', 'released', 'description', 'cover', 'developers', 'publishers', 'genres', 'platforms', 'providers',
	'owned', 'acquisitionType', 'playtime', 'playtimeHours', 'lastPlayed', 'updated',
]);
const STEAM_KEYS = new Set<string>(TEMPLATE_PUBLIC_KEYS.filter((key) => key.startsWith('steam')));
const PLAYSTATION_KEYS = new Set<string>(TEMPLATE_PUBLIC_KEYS.filter((key) => key.startsWith('playstation') || key.startsWith('psn')));
const ACHIEVEMENT_KEYS = new Set([
	'steamAchievementsEarned', 'steamAchievementsTotal', 'steamAchievementsProgress', 'steamAchievements',
	'psnTrophiesEarned', 'psnTrophiesTotal', 'psnTrophiesProgress', 'psnBronze', 'psnSilver', 'psnGold', 'psnPlatinum', 'playstationTrophies',
]);
const PURCHASE_KEYS = new Set(['purchaseDate', 'purchasePrice', 'purchaseCurrency', 'purchaseSource']);
const CONVENIENCE_KEYS = new Set(['developersText', 'publishersText', 'genresText', 'platformsText', 'providersText']);

const CATEGORY_ORDER: readonly TemplateKeyCategory[] = ['common', 'steam', 'playstation', 'achievements', 'purchase', 'convenience', 'helpers'];

function translation(key: string): string {
	return t(key as TranslationKey);
}

function categoryForKey(key: string): TemplateKeyCategory {
	if (COMMON_KEYS.has(key)) return 'common';
	if (ACHIEVEMENT_KEYS.has(key)) return 'achievements';
	if (STEAM_KEYS.has(key)) return 'steam';
	if (PLAYSTATION_KEYS.has(key)) return 'playstation';
	if (PURCHASE_KEYS.has(key)) return 'purchase';
	if (CONVENIENCE_KEYS.has(key)) return 'convenience';
	return 'achievements';
}

function buildEntries(): TemplateKeyEntry[] {
	const entries: TemplateKeyEntry[] = [];
	const seen = new Set<string>();
	const add = (entry: TemplateKeyEntry): void => {
		if (seen.has(entry.key)) return;
		seen.add(entry.key);
		entries.push(entry);
	};
	for (const key of TEMPLATE_PUBLIC_KEYS) add({ key, category: categoryForKey(key), copyText: `{{${key}}}` });
	for (const key of TEMPLATE_PARTIALS) add({ key, category: 'achievements', copyText: `{{> ${key}}}` });
	for (const key of TEMPLATE_HELPERS) add({ key, category: 'helpers', copyText: `{{${key}}}` });
	return entries;
}

export class TemplateKeysModal extends Modal {
	private statusEl?: HTMLElement;
	private searchEl?: HTMLInputElement;
	private rows: Array<{ row: HTMLElement; entry: TemplateKeyEntry }> = [];

	override onOpen(): void {
		this.setTitle(translation('settings.templateKeys.title'));
		this.contentEl.replaceChildren();
		this.rows = [];
		const searchSetting = new Setting(this.contentEl).setName(translation('settings.templateKeys.search'));
		searchSetting.addText((component) => {
			this.searchEl = component.inputEl;
			this.searchEl.dataset.templateSearch = 'true';
			this.searchEl.addEventListener('input', () => this.filter(this.searchEl?.value ?? ''));
		});
		this.statusEl = this.contentEl.createEl('p');
		this.statusEl.dataset.templateStatus = 'true';
		this.contentEl.append(this.statusEl);

		const entries = buildEntries();
		for (const category of CATEGORY_ORDER) {
			const section = this.contentEl.createEl('section');
			section.dataset.templateCategorySection = category;
			const heading = section.createEl('h2');
			heading.textContent = translation(`settings.templateKeys.categories.${category}`);
			section.append(heading);
			if (category === 'purchase') {
				const note = section.createEl('p');
				note.textContent = translation('settings.templateKeys.purchaseNote');
			}
			for (const entry of entries.filter((candidate) => candidate.category === category)) {
				const setting = new Setting(section).setName(entry.key);
				const row = setting.settingEl;
				row.dataset.templateKey = entry.key;
				row.dataset.templateCategory = translation(`settings.templateKeys.categories.${category}`);
				setting.addButton((button) => {
					button.setButtonText(translation('settings.templateKeys.copy'));
					button.buttonEl.dataset.templateCopy = entry.key;
					button.onClick(() => void this.copy(entry));
				});
				this.rows.push({ row, entry });
			}
			this.contentEl.append(section);
		}
	}

	private filter(value: string): void {
		const query = value.trim().toLocaleLowerCase();
		for (const { row, entry } of this.rows) {
			const category = row.dataset.templateCategory ?? '';
			const label = row.dataset.settingName ?? entry.key;
			row.hidden = query.length > 0 && ![entry.key, category, label].some((candidate) => candidate.toLocaleLowerCase().includes(query));
		}
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private async copy(entry: TemplateKeyEntry): Promise<void> {
		if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') {
			this.setStatus(translation('settings.templateKeys.clipboardUnavailable'));
			return;
		}
		try {
			await navigator.clipboard.writeText(entry.copyText);
			this.setStatus(translation('settings.templateKeys.copied'));
		} catch {
			this.setStatus(translation('settings.templateKeys.copyFailed'));
		}
	}
}

export { TemplateKeysModal as GameSyncTemplateKeysModal };
