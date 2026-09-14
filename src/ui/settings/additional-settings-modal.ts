import { Modal, Setting, type App } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { PropertyMapping } from '../../model/property-mapping';
import type { GameSyncSettings, MetadataLanguage, MetadataPreference } from '../../model/settings';
import { PropertySettings } from './property-settings';

export interface AdditionalSettingsHost {
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	writeSettings: (settings: GameSyncSettings) => void | Promise<void>;
	readPropertyMapping: () => PropertyMapping | undefined | Promise<PropertyMapping | undefined>;
	writePropertyMapping: (mapping: PropertyMapping) => void | Promise<void>;
	openIgnoredGames: () => void | Promise<void>;
	openMatchManager: () => void | Promise<void>;
	copyDiagnostics: () => void | Promise<void>;
}

type AdditionalView = 'library' | 'properties' | 'metadata' | 'additional-data' | 'history';
type BooleanField = 'includeUnplayed' | 'includeFreeToPlay' | 'includePreviouslyPlayedNoLongerOwned' | 'includeDemosTrials' | 'includeBetasTestApps' | 'showAchievementRarity' | 'showTrophyType' | 'showUnlockDate' | 'recordHistory' | 'steamEnricherEnabled' | 'playstationEnricherEnabled';

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function settingCopy(settings: GameSyncSettings): GameSyncSettings {
	return { ...settings, enabledProviders: { ...settings.enabledProviders } };
}

export class AdditionalSettingsModal extends Modal {
	private settings?: GameSyncSettings;
	private propertyMapping: PropertyMapping = {};
	private lifecycle = 0;
	private isOpen = false;
	private statusEl?: HTMLElement;
	public ready: Promise<void> = Promise.resolve();

	constructor(app: App, private readonly host: AdditionalSettingsHost) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		const version = ++this.lifecycle;
		this.setTitle(translation('settings.advanced.additionalTitle'));
		this.contentEl.replaceChildren();
		this.ready = this.load(version);
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
	}

	private async load(version: number): Promise<void> {
		try {
			this.settings = settingCopy(await this.host.readSettings());
			if (this.isCurrent(version)) this.renderLauncher();
		} catch {
			if (this.isCurrent(version)) this.setStatus(translation('settings.common.loadError'));
		}
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private currentSettings(): GameSyncSettings {
		if (this.settings === undefined) throw new Error('Game Sync settings are not loaded.');
		return this.settings;
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private addStatus(parent: HTMLElement): void {
		this.statusEl = parent.createEl('p');
		this.statusEl.dataset.additionalSettingsStatus = 'true';
		this.statusEl.setAttribute('aria-live', 'polite');
	}

	private renderLauncher(): void {
		this.contentEl.replaceChildren();
		const root = this.contentEl.createDiv();
		root.dataset.additionalSettings = 'true';
		this.launcherRow(root, 'settings.advanced.libraryFilters', 'settings.advanced.libraryFiltersDescription', 'configure', () => this.renderLibrary());
		this.launcherRow(root, 'settings.advanced.noteProperties', 'settings.advanced.notePropertiesDescription', 'configure', () => void this.renderProperties());
		this.launcherRow(root, 'settings.advanced.metadata', 'settings.advanced.metadataDescription', 'configure', () => this.renderMetadata());
		this.launcherRow(root, 'settings.advanced.additionalData', 'settings.advanced.additionalDataDescription', 'configure', () => this.renderAdditionalData());
		this.launcherRow(root, 'settings.advanced.gameHistory', 'settings.advanced.gameHistoryDescription', 'configure', () => this.renderHistory());
		this.launcherRow(root, 'settings.advanced.ignoredGames', 'settings.advanced.ignoredGamesDescription', 'manage', () => void this.host.openIgnoredGames());
		this.launcherRow(root, 'settings.advanced.matchManager', 'settings.advanced.matchManagerDescription', 'manage', () => void this.host.openMatchManager());
		this.launcherRow(root, 'settings.advanced.diagnostics', 'settings.advanced.diagnosticsDescription', 'open', () => void this.host.copyDiagnostics());
		this.addStatus(this.contentEl);
	}

	private launcherRow(parent: HTMLElement, nameKey: string, descriptionKey: string, actionKey: 'configure' | 'manage' | 'open', callback: () => void): void {
		const setting = new Setting(parent).setName(translation(nameKey)).setDesc(translation(descriptionKey));
		setting.settingEl.dataset.gameSyncActionRow = 'true';
		setting.addButton((button) => {
			button.setButtonText(translation(`settings.advanced.${actionKey}`));
			button.buttonEl.dataset.additionalAction = nameKey.split('.').at(-1) ?? nameKey;
			button.onClick(callback);
		});
	}

	private startView(view: AdditionalView, titleKey: string): HTMLElement {
		this.contentEl.replaceChildren();
		const root = this.contentEl.createDiv();
		root.dataset.additionalView = view;
		new Setting(root).setName(translation(titleKey)).setHeading();
		return root;
	}

	private addBack(parent: HTMLElement): void {
		const back = new Setting(parent);
		back.settingEl.dataset.gameSyncActionRow = 'true';
		back.addButton((button) => {
			button.setButtonText(translation('settings.advanced.back'));
			button.buttonEl.dataset.additionalBack = 'true';
			button.onClick(() => this.renderLauncher());
		});
		this.addStatus(parent);
	}

	private addToggle(parent: HTMLElement, field: BooleanField, labelKey: string, afterChange?: () => void): void {
		const settings = this.currentSettings();
		new Setting(parent).setName(translation(labelKey)).addToggle((toggle) => {
			toggle.toggleEl.dataset.settingsField = field;
			toggle.setValue(settings[field]);
			toggle.onChange((value) => {
				settings[field] = value;
				void this.saveSettings().then(() => afterChange?.());
			});
		});
	}

	private addDropdown<T extends MetadataLanguage | MetadataPreference>(parent: HTMLElement, field: 'metadataLanguage' | 'metadataPreference', labelKey: string, options: readonly [T, string][]): void {
		const settings = this.currentSettings();
		new Setting(parent).setName(translation(labelKey)).addDropdown((dropdown) => {
			dropdown.selectEl.dataset.settingsField = field;
			for (const [value, optionKey] of options) dropdown.addOption(value, translation(optionKey));
			dropdown.setValue(settings[field]);
			dropdown.onChange((value) => {
				settings[field] = value as never;
				void this.saveSettings();
			});
		});
	}

	private addText(parent: HTMLElement, field: 'historyPath', labelKey: string, descriptionKey: string, placeholderKey: string): void {
		const settings = this.currentSettings();
		new Setting(parent).setName(translation(labelKey)).setDesc(translation(descriptionKey)).addText((component) => {
			component.inputEl.dataset.settingsField = field;
			component.inputEl.value = settings[field];
			component.setPlaceholder(translation(placeholderKey));
			component.onChange((value) => {
				settings[field] = value;
				void this.saveSettings();
			});
		});
	}

	private async saveSettings(): Promise<void> {
		try {
			await this.host.writeSettings(settingCopy(this.currentSettings()));
			this.setStatus('');
		} catch {
			this.setStatus(translation('settings.common.saveError'));
		}
	}

	private renderLibrary(): void {
		const root = this.startView('library', 'settings.advanced.libraryFilters');
		this.addToggle(root, 'includeUnplayed', 'settings.library.includeUnplayed');
		this.addToggle(root, 'includeFreeToPlay', 'settings.library.includeFreeToPlay');
		this.addToggle(root, 'includePreviouslyPlayedNoLongerOwned', 'settings.library.includePreviouslyPlayedNoLongerOwned');
		this.addToggle(root, 'includeDemosTrials', 'settings.library.includeDemosTrials');
		this.addToggle(root, 'includeBetasTestApps', 'settings.library.includeBetasTestApps');
		this.addBack(root);
	}

	private async renderProperties(): Promise<void> {
		const root = this.startView('properties', 'settings.advanced.noteProperties');
		const mapping = root.createDiv();
		mapping.dataset.propertyMapping = 'true';
		try {
			this.propertyMapping = { ...(await this.host.readPropertyMapping() ?? {}) };
			if (!this.isOpen) return;
			new PropertySettings(mapping, {
				mapping: this.propertyMapping,
				writeMapping: async (next) => {
					await this.host.writePropertyMapping(next);
					this.propertyMapping = { ...next };
				},
			}).render();
		} catch {
			mapping.textContent = translation('settings.common.loadError');
		}
		this.addBack(root);
	}

	private renderMetadata(): void {
		const root = this.startView('metadata', 'settings.advanced.metadata');
		this.addDropdown(root, 'metadataLanguage', 'settings.advanced.metadataLanguage', [
			['follow-obsidian', 'settings.advanced.followObsidian'], ['english', 'settings.advanced.english'], ['polish', 'settings.advanced.polish'],
		]);
		this.addDropdown(root, 'metadataPreference', 'settings.advanced.metadataPreference', [
			['automatic', 'settings.advanced.automatic'], ['english', 'settings.advanced.english'], ['polish', 'settings.advanced.polish'],
		]);
		this.addToggle(root, 'showAchievementRarity', 'settings.achievements.showAchievementRarity');
		this.addToggle(root, 'showTrophyType', 'settings.achievements.showTrophyType');
		this.addToggle(root, 'showUnlockDate', 'settings.achievements.showUnlockDate');
		this.addBack(root);
	}

	private renderAdditionalData(): void {
		const root = this.startView('additional-data', 'settings.advanced.additionalData');
		this.addToggle(root, 'steamEnricherEnabled', 'settings.advanced.steamEnricher');
		this.addToggle(root, 'playstationEnricherEnabled', 'settings.advanced.playstationEnricher');
		this.addBack(root);
	}

	private renderHistory(): void {
		const root = this.startView('history', 'settings.advanced.gameHistory');
		this.addToggle(root, 'recordHistory', 'settings.history.recordHistory', () => this.renderHistory());
		if (this.currentSettings().recordHistory) this.addText(root, 'historyPath', 'settings.history.historyPath', 'settings.history.historyPathDescription', 'settings.history.historyPathPlaceholder');
		this.addBack(root);
	}
}
