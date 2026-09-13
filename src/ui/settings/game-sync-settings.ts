import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { GameProvider } from '../../model/provider';
import type { PropertyMapping } from '../../model/property-mapping';
import { isSupportedBackgroundIntervalMinutes, type GameSyncSettings, type MetadataLanguage, type MetadataPreference } from '../../model/settings';
import type { ProviderConnectionStatus } from '../../providers/provider';
import { PropertySettings } from './property-settings';

export interface GameSyncSettingsHost {
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	writeSettings: (settings: GameSyncSettings) => void | Promise<void>;
	readPropertyMapping: () => PropertyMapping | undefined | Promise<PropertyMapping | undefined>;
	writePropertyMapping: (mapping: PropertyMapping) => void | Promise<void>;
	getConnectionStatus: (provider: GameProvider) => ProviderConnectionStatus | Promise<ProviderConnectionStatus>;
	connect: (provider: GameProvider) => void | Promise<void>;
	disconnect: (provider: GameProvider) => void | Promise<void>;
	confirm: (message: string) => boolean | Promise<boolean>;
	openTemplate: () => void;
	openTemplateKeys: () => void;
}

export type GameSyncSettingsAdapter = GameSyncSettingsHost;

const NativePluginSettingTab = PluginSettingTab;

function translation(key: string): string {
	return t(key as TranslationKey);
}

function settingCopy(settings: GameSyncSettings): GameSyncSettings {
	return { ...settings, enabledProviders: { ...settings.enabledProviders } };
}

function statusText(status: ProviderConnectionStatus): string {
	if (status.state === 'connected') return translation('settings.common.statusConnected');
	if (status.state === 'needs-auth') return translation('settings.common.statusNeedsAuth');
	if (status.state === 'error') return translation('settings.common.statusError');
	return translation('settings.common.statusDisconnected');
}

function validateSettings(settings: GameSyncSettings): string | undefined {
	if (settings.notesFolder.trim().length === 0 || settings.filenamePattern.trim().length === 0 || settings.basePath.trim().length === 0 || settings.historyPath.trim().length === 0) {
		return translation('settings.common.saveError');
	}
	if (!isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) {
		return translation('settings.common.saveError');
	}
	return undefined;
}

export class GameSyncSettingsTab extends NativePluginSettingTab {
	private settings?: GameSyncSettings;
	private propertyMapping: PropertyMapping = {};
	private statusEl?: HTMLElement;
	private lifecycle = 0;
	public ready: Promise<void> = Promise.resolve();

	constructor(app: App, plugin: Plugin, private readonly host: GameSyncSettingsHost) {
		super(app, plugin);
	}

	override display(): void {
		this.lifecycle += 1;
		const version = this.lifecycle;
		this.containerEl.replaceChildren();
		this.statusEl = this.containerEl.createEl('p');
		this.statusEl.dataset.settingsStatus = 'true';
		this.containerEl.append(this.statusEl);
		this.statusEl.textContent = '';
		this.ready = this.load(version);
	}

	private async load(version: number): Promise<void> {
		try {
			const [settings, propertyMapping] = await Promise.all([this.host.readSettings(), this.host.readPropertyMapping()]);
			if (version !== this.lifecycle) return;
			this.settings = settingCopy(settings);
			this.propertyMapping = { ...(propertyMapping ?? {}) };
			this.render();
		} catch {
			if (version === this.lifecycle) this.setStatus(translation('settings.common.loadError'));
		}
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private section(key: string): HTMLElement {
		const section = this.containerEl.createEl('section');
		section.dataset.gameSyncSection = key;
		section.dataset.gameSyncSectionLabel = translation(`settings.sections.${key}`);
		new Setting(section).setName(section.dataset.gameSyncSectionLabel ?? '').setHeading();
		this.containerEl.append(section);
		return section;
	}

	private settingText(container: HTMLElement, field: keyof GameSyncSettings, labelKey: string, type: 'text' | 'number' = 'text'): void {
		const settings = this.currentSettings();
		new Setting(container).setName(translation(labelKey)).addText((component) => {
			component.inputEl.type = type;
			component.inputEl.dataset.settingsField = field;
			component.inputEl.value = type === 'number' ? String(settings.backgroundIntervalMinutes) : settings[field] as string;
			component.onChange((value) => {
				if (type === 'number') settings[field] = Number(value) as never;
				else settings[field] = value as never;
				void this.saveSettings();
			});
		});
	}

	private settingToggle(container: HTMLElement, field: keyof GameSyncSettings, labelKey: string): void {
		const settings = this.currentSettings();
		new Setting(container).setName(translation(labelKey)).addToggle((component) => {
			component.setValue(settings[field] as boolean);
			component.onChange((value) => {
				settings[field] = value as never;
				void this.saveSettings();
			});
		});
	}

	private settingDropdown<T extends string>(container: HTMLElement, field: keyof GameSyncSettings, labelKey: string, options: readonly [T, string][]): void {
		const settings = this.currentSettings();
		new Setting(container).setName(translation(labelKey)).addDropdown((component) => {
			for (const [value, label] of options) component.addOption(value, translation(label));
			component.setValue(settings[field] as string);
			component.onChange((value) => {
				settings[field] = value as never;
				void this.saveSettings();
			});
		});
	}

	private action(container: HTMLElement, labelKey: string, callback: () => void, dataset?: Record<string, string>): void {
		new Setting(container).addButton((button) => {
			button.setButtonText(translation(labelKey));
			if (dataset !== undefined) Object.assign(button.buttonEl.dataset, dataset);
			button.onClick(callback);
		});
	}

	private async saveSettings(): Promise<void> {
		const settings = this.currentSettings();
		const validationError = validateSettings(settings);
		if (validationError !== undefined) {
			this.setStatus(validationError);
			return;
		}
		try {
			await this.host.writeSettings(settingCopy(settings));
			this.setStatus('');
		} catch {
			this.setStatus(translation('settings.common.saveError'));
		}
	}

	private currentSettings(): GameSyncSettings {
		if (this.settings === undefined) throw new Error('Game Sync settings are not loaded.');
		return this.settings;
	}

	private render(): void {
		this.containerEl.replaceChildren();
		this.containerEl.append(this.statusEl!);
		this.renderAccounts(this.section('accounts'));
		this.renderSync(this.section('sync'));
		this.renderLibrary(this.section('library'));
		this.renderNotesTemplates(this.section('notesTemplates'));
		this.renderProperties(this.section('properties'));
		this.renderAchievements(this.section('achievements'));
		this.renderHistory(this.section('history'));
		this.renderAdvanced(this.section('advanced'));
		this.renderAbout(this.section('about'));
	}

	private renderAccounts(section: HTMLElement): void {
		for (const provider of ['steam', 'playstation'] as const) {
			const providerLabel = translation(`settings.accounts.${provider}`);
			this.settingProviderToggle(section, provider, providerLabel);
			const status = section.createEl('p');
			status.dataset.providerStatus = provider;
			status.textContent = translation('settings.common.statusUnknown');
			section.append(status);
			this.action(section, 'settings.accounts.connect', () => void this.connect(provider), { providerAction: `connect:${provider}` });
			this.action(section, 'settings.accounts.disconnect', () => void this.disconnect(provider), { providerAction: `disconnect:${provider}` });
			void this.loadProviderStatus(provider, status);
		}
	}

	private settingProviderToggle(section: HTMLElement, provider: 'steam' | 'playstation', label: string): void {
		const settings = this.currentSettings();
		new Setting(section).setName(label).addToggle((component) => {
			component.setValue(settings.enabledProviders[provider]);
			component.onChange((value) => {
				settings.enabledProviders[provider] = value;
				void this.saveSettings();
			});
		});
	}

	private async loadProviderStatus(provider: GameProvider, statusEl: HTMLElement): Promise<void> {
		try {
			statusEl.textContent = statusText(await this.host.getConnectionStatus(provider));
		} catch {
			statusEl.textContent = translation('settings.common.statusUnknown');
		}
	}

	private async connect(provider: GameProvider): Promise<void> {
		try {
			await this.host.connect(provider);
			const statusEl = this.containerEl.querySelector<HTMLElement>(`[data-provider-status="${provider}"]`);
			if (statusEl !== null) await this.loadProviderStatus(provider, statusEl);
		} catch {
			this.setStatus(translation('settings.common.statusError'));
		}
	}

	private async disconnect(provider: GameProvider): Promise<void> {
		const confirmed = await this.host.confirm(translation('settings.accounts.disconnectConfirm'));
		if (!confirmed) return;
		try {
			await this.host.disconnect(provider);
			const statusEl = this.containerEl.querySelector<HTMLElement>(`[data-provider-status="${provider}"]`);
			if (statusEl !== null) await this.loadProviderStatus(provider, statusEl);
		} catch {
			this.setStatus(translation('settings.common.statusError'));
		}
	}

	private renderSync(section: HTMLElement): void {
		this.settingDropdown(section, 'previewMode', 'settings.sync.previewMode', [
			['always', 'settings.sync.previewAlways'], ['first-and-review', 'settings.sync.previewFirst'], ['review-only', 'settings.sync.previewReview'],
		]);
		this.settingToggle(section, 'backgroundSync', 'settings.sync.backgroundSync');
		this.settingText(section, 'backgroundIntervalMinutes', 'settings.sync.backgroundInterval', 'number');
		this.settingDropdown(section, 'backgroundNotifications', 'settings.sync.backgroundNotifications', [
			['problems-only', 'settings.sync.notificationsProblems'], ['all', 'settings.sync.notificationsAll'], ['none', 'settings.sync.notificationsNone'],
		]);
	}

	private renderLibrary(section: HTMLElement): void {
		this.settingToggle(section, 'includeUnplayed', 'settings.library.includeUnplayed');
		this.settingToggle(section, 'includeFreeToPlay', 'settings.library.includeFreeToPlay');
		this.settingToggle(section, 'includePreviouslyPlayedNoLongerOwned', 'settings.library.includePreviouslyPlayedNoLongerOwned');
		this.settingToggle(section, 'includeDemosTrials', 'settings.library.includeDemosTrials');
		this.settingToggle(section, 'includeBetasTestApps', 'settings.library.includeBetasTestApps');
	}

	private renderNotesTemplates(section: HTMLElement): void {
		this.settingText(section, 'notesFolder', 'settings.notesTemplates.notesFolder');
		this.settingText(section, 'filenamePattern', 'settings.notesTemplates.filenamePattern');
		this.settingText(section, 'templatePath', 'settings.notesTemplates.templatePath');
		this.settingToggle(section, 'createBase', 'settings.notesTemplates.createBase');
		this.settingText(section, 'basePath', 'settings.notesTemplates.basePath');
		this.action(section, 'settings.notesTemplates.openTemplate', () => this.host.openTemplate());
		this.action(section, 'settings.notesTemplates.openTemplateKeys', () => this.host.openTemplateKeys());
	}

	private renderProperties(section: HTMLElement): void {
		const mappingContainer = section.createDiv();
		mappingContainer.dataset.propertyMapping = 'true';
		section.append(mappingContainer);
		new PropertySettings(mappingContainer, this.propertyMapping, async (mapping) => {
			await this.host.writePropertyMapping(mapping);
			this.propertyMapping = { ...mapping };
		}).render();
	}

	private renderAchievements(section: HTMLElement): void {
		this.settingToggle(section, 'revealHiddenAchievements', 'settings.achievements.revealHiddenAchievements');
		this.settingToggle(section, 'showAchievementRarity', 'settings.achievements.showAchievementRarity');
		this.settingToggle(section, 'showTrophyType', 'settings.achievements.showTrophyType');
		this.settingToggle(section, 'showUnlockDate', 'settings.achievements.showUnlockDate');
	}

	private renderHistory(section: HTMLElement): void {
		this.settingToggle(section, 'recordHistory', 'settings.history.recordHistory');
		this.settingText(section, 'historyPath', 'settings.history.historyPath');
	}

	private renderAdvanced(section: HTMLElement): void {
		this.settingDropdown(section, 'metadataLanguage', 'settings.advanced.metadataLanguage', [
			['follow-obsidian', 'settings.advanced.followObsidian'], ['english', 'settings.advanced.english'], ['polish', 'settings.advanced.polish'],
		] as readonly [MetadataLanguage, string][]);
		this.settingDropdown(section, 'metadataPreference', 'settings.advanced.metadataPreference', [
			['automatic', 'settings.advanced.automatic'], ['english', 'settings.advanced.english'], ['polish', 'settings.advanced.polish'],
		] as readonly [MetadataPreference, string][]);
	}

	private renderAbout(section: HTMLElement): void {
		const description = section.createEl('p');
		description.textContent = translation('settings.about.description');
		section.append(description);
	}
}

export { GameSyncSettingsTab as GameSyncSettingTab };
