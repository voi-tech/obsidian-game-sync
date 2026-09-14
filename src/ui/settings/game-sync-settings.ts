import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { GameProvider } from '../../model/provider';
import { isSupportedBackgroundIntervalMinutes, type GameSyncSettings } from '../../model/settings';
import type { ProviderConnectionStatus } from '../../providers/provider';
import { renderConnectionStatus } from '../status';
import type { GameTrackRuntimeStatus } from '../../model/library-provider';
import type { GameTrackCsvSelection } from '../../providers/gametrack/csv/gametrack-csv-provider';

export interface GameSyncSettingsHost {
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	writeSettings: (settings: GameSyncSettings) => void | Promise<void>;
	readPropertyMapping: () => import('../../model/property-mapping').PropertyMapping | undefined | Promise<import('../../model/property-mapping').PropertyMapping | undefined>;
	writePropertyMapping: (mapping: import('../../model/property-mapping').PropertyMapping) => void | Promise<void>;
	getConnectionStatus: (provider: GameProvider) => ProviderConnectionStatus | Promise<ProviderConnectionStatus>;
	connect: (provider: GameProvider, onConnected?: () => void) => void | Promise<void>;
	disconnect: (provider: GameProvider) => void | Promise<void>;
	syncNow?: (provider?: GameProvider) => void | Promise<void>;
	confirm: (message: string) => boolean | Promise<boolean>;
	openAdditionalSettings: () => void | Promise<void>;
	getGameTrackStatus?: () => GameTrackRuntimeStatus | Promise<GameTrackRuntimeStatus>;
	chooseGameTrackExport?: () => GameTrackCsvSelection | undefined | Promise<GameTrackCsvSelection | undefined>;
}

export type GameSyncSettingsAdapter = GameSyncSettingsHost;

const PROVIDERS: readonly GameProvider[] = ['steam', 'playstation'];
const GITHUB_URL = 'https://github.com/voi-tech/obsidian-game-sync';
const DOCUMENTATION_URL = `${GITHUB_URL}#readme`;
const NativePluginSettingTab = PluginSettingTab;

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function settingCopy(settings: GameSyncSettings): GameSyncSettings {
	return { ...settings, enabledProviders: { ...settings.enabledProviders } };
}

function validateSettings(settings: GameSyncSettings): string | undefined {
	if (settings.notesFolder.trim().length === 0 || settings.filenamePattern.trim().length === 0 || settings.basePath.trim().length === 0 || settings.historyPath.trim().length === 0) return translation('settings.common.saveError');
	if (!isSupportedBackgroundIntervalMinutes(settings.backgroundIntervalMinutes)) return translation('settings.common.saveError');
	return undefined;
}

type TextSettingField = 'notesFolder' | 'templatePath' | 'backgroundIntervalMinutes';

export class GameSyncSettingsTab extends NativePluginSettingTab {
	private settings?: GameSyncSettings;
	private statusEl?: HTMLElement;
	private readonly providerStatuses = new Map<GameProvider, ProviderConnectionStatus>();
	private readonly providerSettings = new Map<GameProvider, Setting>();
	private gameTrackStatus?: GameTrackRuntimeStatus;
	private librarySourceContainer?: HTMLElement;
	private lifecycle = 0;
	public ready: Promise<void> = Promise.resolve();

	constructor(app: App, private readonly plugin: Plugin, private readonly host: GameSyncSettingsHost) {
		super(app, plugin);
	}

	override display(): void {
		const version = ++this.lifecycle;
		this.providerStatuses.clear();
		this.providerSettings.clear();
		this.gameTrackStatus = undefined;
		this.librarySourceContainer = undefined;
		this.containerEl.replaceChildren();
		this.statusEl = this.containerEl.createEl('p');
		this.statusEl.dataset.settingsStatus = 'true';
		this.statusEl.setAttribute('aria-live', 'polite');
		this.ready = this.load(version);
	}

	private async load(version: number): Promise<void> {
		try {
			this.settings = settingCopy(await this.host.readSettings());
			if (version !== this.lifecycle) return;
			this.render();
		} catch {
			if (version === this.lifecycle) this.setStatus(translation('settings.common.loadError'));
		}
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private currentSettings(): GameSyncSettings {
		if (this.settings === undefined) throw new Error('Game Sync settings are not loaded.');
		return this.settings;
	}

	private section(key: 'accounts' | 'library' | 'sync' | 'notes' | 'more'): HTMLElement {
		const section = this.containerEl.createEl('section');
		section.dataset.gameSyncSection = key;
		section.dataset.gameSyncSectionLabel = translation(`settings.sections.${key}`);
		new Setting(section).setName(section.dataset.gameSyncSectionLabel ?? '').setHeading();
		return section;
	}

	private textSetting(container: HTMLElement, field: TextSettingField, nameKey: string, descriptionKey: string, placeholderKey: string, type: 'text' | 'number' = 'text'): void {
		const settings = this.currentSettings();
		const setting = new Setting(container).setName(translation(nameKey)).setDesc(translation(descriptionKey));
		setting.addText((component) => {
			component.inputEl.type = type;
			component.inputEl.dataset.settingsField = field;
			component.inputEl.value = type === 'number' ? String(settings.backgroundIntervalMinutes) : String(settings[field]);
			component.setPlaceholder(translation(placeholderKey));
			component.onChange((value) => {
				if (field === 'backgroundIntervalMinutes') settings.backgroundIntervalMinutes = Number(value);
				else settings[field] = value;
				void this.saveSettings();
			});
		});
	}

	private toggleSetting(container: HTMLElement, field: keyof GameSyncSettings, nameKey: string, descriptionKey?: string, afterChange?: () => void): void {
		const settings = this.currentSettings();
		const setting = new Setting(container).setName(translation(nameKey));
		if (descriptionKey !== undefined) setting.setDesc(translation(descriptionKey));
		setting.addToggle((component) => {
			component.toggleEl.dataset.settingsField = field;
			component.setValue(settings[field] as boolean);
			component.onChange((value) => {
				settings[field] = value as never;
				void this.saveSettings().then(() => afterChange?.());
			});
		});
	}

	private action(container: HTMLElement, nameKey: string, callback: () => void, dataset: Record<string, string>, descriptionKey?: string, cta = false): void {
		const setting = new Setting(container).setName(translation(nameKey));
		setting.settingEl.dataset.gameSyncActionRow = 'true';
		if (descriptionKey !== undefined) setting.setDesc(translation(descriptionKey));
		setting.addButton((button) => {
			button.setButtonText(translation(nameKey));
			if (cta) button.setCta();
			Object.assign(button.buttonEl.dataset, dataset);
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

	private render(): void {
		this.containerEl.replaceChildren();
		if (this.statusEl !== undefined) this.containerEl.append(this.statusEl);
		this.renderAccounts(this.section('accounts'));
		if (this.host.getGameTrackStatus !== undefined) this.renderLibrary(this.section('library'));
		this.renderSync(this.section('sync'));
		this.renderNotes(this.section('notes'));
		this.renderMore(this.section('more'));
		this.renderFooter();
	}

	private renderAccounts(section: HTMLElement): void {
		for (const provider of PROVIDERS) {
			const setting = new Setting(section);
			setting.settingEl.dataset.settingsProvider = provider;
			this.providerSettings.set(provider, setting);
			this.renderProviderSetting(provider, setting);
			void this.loadProviderStatus(provider);
		}
	}

	private renderLibrary(section: HTMLElement): void {
		this.librarySourceContainer = section.createDiv();
		this.librarySourceContainer.dataset.librarySource = 'true';
		this.renderLibrarySource();
		void this.loadGameTrackStatus();
	}

	private renderLibrarySource(): void {
		const container = this.librarySourceContainer;
		if (container === undefined) return;
		container.replaceChildren();
		const status = this.gameTrackStatus;
		const setting = new Setting(container).setName(translation('settings.library.source'));
		setting.settingEl.dataset.libraryProviderSetting = 'true';
		setting.setDesc(status === undefined
			? translation('settings.library.checking')
			: status.code === 'READY'
				? translation('settings.library.gametrackDetected', { count: status.games })
				: translation(`settings.library.gametrackUnavailable.${status.code}` as TranslationKey));
		setting.addDropdown((component) => {
			component.selectEl.dataset.settingsField = 'libraryProvider';
			component.addOption('steam', translation('sync.providers.steam'));
			component.addOption('playstation', translation('sync.providers.playstation'));
				if (status === undefined || status.code !== 'UNSUPPORTED_OS') component.addOption('gametrack', translation('sync.providers.gametrack'));
			const settings = this.currentSettings();
			const current = settings.libraryProvider ?? (settings.enabledProviders.steam ? 'steam' : 'playstation');
			component.setValue(current);
			component.onChange((value) => {
					if ((value === 'gametrack' || value === 'steam' || value === 'playstation') && (value !== 'gametrack' || (status !== undefined && status.code !== 'UNSUPPORTED_OS'))) {
					settings.libraryProvider = value;
					void this.saveSettings();
				}
			});
		});
			if (status !== undefined) {
			const diagnostic = new Setting(container).setName(translation('settings.library.gametrack')).setDesc(
				status.code === 'READY' ? `${translation('settings.library.connected')} · ${status.platforms.join(', ') || translation('settings.library.noPlatforms')}` : translation(`settings.library.gametrackUnavailable.${status.code}` as TranslationKey),
			);
				diagnostic.settingEl.dataset.gametrackStatus = status.code;
			}
			if (this.host.chooseGameTrackExport !== undefined) this.renderGameTrackExport(container, status);
		}

	private renderGameTrackExport(container: HTMLElement, status: GameTrackRuntimeStatus | undefined): void {
		const setting = new Setting(container).setName(translation('settings.library.export'));
		setting.settingEl.dataset.gametrackExportSetting = 'true';
		const currentSettings = this.currentSettings();
		const selected = currentSettings.gametrackExportName;
		const lastImported = currentSettings.gametrackLastImportedAt;
		const details = status?.code === 'READY'
			? [
				selected ?? translation('settings.library.exportSelected'),
				translation('settings.library.gametrackDetected', { count: status.games }),
				status.platforms.length > 0 ? status.platforms.join(', ') : undefined,
				status.gameTrackVersion === undefined ? undefined : translation('settings.library.gameTrackVersion', { version: status.gameTrackVersion }),
				status.exportCreated === undefined ? undefined : translation('settings.library.exportCreated', { date: status.exportCreated }),
				lastImported === undefined ? undefined : translation('settings.library.lastImported', { date: lastImported }),
			].filter((value): value is string => value !== undefined).join(' · ')
			: translation('settings.library.exportDescription');
		setting.setDesc(details);
		setting.addButton((button) => {
			button.setButtonText(selected === undefined ? translation('settings.library.chooseExport') : translation('settings.library.chooseAnotherExport'));
			button.buttonEl.dataset.settingsAction = 'choose-gametrack-export';
			button.onClick(() => void this.chooseGameTrackExport());
		});
		if (status?.code === 'READY' && this.host.syncNow !== undefined) setting.addButton((button) => {
			button.setButtonText(translation('settings.library.previewExport')).setCta();
			button.buttonEl.dataset.settingsAction = 'preview-gametrack-export';
			button.onClick(() => void this.host.syncNow?.());
		});
	}

	private async chooseGameTrackExport(): Promise<void> {
		try {
			const selection = await this.host.chooseGameTrackExport?.();
			if (selection === undefined) return;
			const settings = this.currentSettings();
			settings.libraryProvider = 'gametrack';
			settings.gametrackExportPath = selection.path;
			settings.gametrackExportName = selection.name;
			settings.gametrackExportSize = selection.size;
			settings.gametrackExportModifiedAt = selection.modifiedAt;
			await this.saveSettings();
			await this.loadGameTrackStatus();
		} catch {
			this.setStatus(translation('settings.library.exportError'));
		}
	}

	private async loadGameTrackStatus(): Promise<void> {
		try { this.gameTrackStatus = await this.host.getGameTrackStatus?.(); }
		catch { this.gameTrackStatus = { code: 'EXPORT_NOT_FOUND', supported: true, database: 'unavailable', schema: 'unknown', games: 0, platforms: [] }; }
		if (this.lifecycle > 0) this.renderLibrarySource();
	}

	private renderProviderSetting(provider: GameProvider, setting: Setting): void {
		const status = this.providerStatuses.get(provider);
		setting.setName(translation(`settings.accounts.${provider}`));
		setting.descEl.replaceChildren();
		renderConnectionStatus(setting, provider === 'playstation' ? translation('connect.playstation.unofficial') : '', status);
		setting.controlEl.replaceChildren();
		if (status?.state === 'connected') {
			this.providerAction(setting, provider, 'settings.accounts.reconnect', () => void this.connect(provider), false);
			this.providerAction(setting, provider, 'settings.accounts.disconnect', () => void this.disconnect(provider), false);
		} else {
			this.providerAction(setting, provider, 'settings.accounts.connect', () => void this.connect(provider), true);
		}
	}

	private providerAction(setting: Setting, provider: GameProvider, labelKey: string, callback: () => void, cta: boolean): void {
		setting.addButton((button) => {
			button.setButtonText(translation(labelKey));
			if (cta) button.setCta();
			button.buttonEl.dataset.providerAction = `${labelKey.split('.').at(-1)}:${provider}`;
			button.onClick(callback);
		});
	}

	private async loadProviderStatus(provider: GameProvider): Promise<void> {
		try {
			this.providerStatuses.set(provider, await this.host.getConnectionStatus(provider));
		} catch {
			this.providerStatuses.set(provider, { provider, state: 'error', connected: false });
		}
		if (this.lifecycle === 0) return;
		const setting = this.providerSettings.get(provider);
		if (setting !== undefined && setting.settingEl.isConnected) this.renderProviderSetting(provider, setting);
	}

	private async connect(provider: GameProvider): Promise<void> {
		try {
			await this.host.connect(provider, () => void this.loadProviderStatus(provider));
			await this.loadProviderStatus(provider);
		} catch {
			this.setStatus(translation('settings.common.statusError'));
		}
	}

	private async disconnect(provider: GameProvider): Promise<void> {
		if (!await this.host.confirm(translation('settings.accounts.disconnectConfirm'))) return;
		try {
			await this.host.disconnect(provider);
			await this.loadProviderStatus(provider);
		} catch {
			this.setStatus(translation('settings.common.statusError'));
		}
	}

	private renderSync(section: HTMLElement): void {
		this.action(section, 'settings.sync.syncAll', () => void this.host.syncNow?.(), { settingsAction: 'sync-all' }, 'settings.sync.syncAllDescription', true);
		this.toggleSetting(section, 'backgroundSync', 'settings.sync.backgroundSync', 'settings.sync.backgroundSyncDescription', () => this.render());
		if (this.currentSettings().backgroundSync) this.textSetting(section, 'backgroundIntervalMinutes', 'settings.sync.backgroundInterval', 'settings.sync.backgroundIntervalDescription', 'settings.sync.backgroundIntervalPlaceholder', 'number');
	}

	private renderNotes(section: HTMLElement): void {
		this.textSetting(section, 'notesFolder', 'settings.notesTemplates.notesFolder', 'settings.notesTemplates.notesFolderDescription', 'settings.notesTemplates.notesFolderPlaceholder');
		this.textSetting(section, 'templatePath', 'settings.notesTemplates.templatePath', 'settings.notesTemplates.templateDescription', 'settings.notesTemplates.templatePlaceholder');
	}

	private renderMore(section: HTMLElement): void {
		this.action(section, 'settings.advanced.openAdditional', () => void this.host.openAdditionalSettings(), { settingsAction: 'additional' });
	}

	private renderFooter(): void {
		const footer = this.containerEl.createEl('p');
		const version = (this.plugin as Plugin & { manifest?: { version?: string } }).manifest?.version ?? '26.9.0';
		footer.append(document.createTextNode(`Game Sync ${version} · `));
		const github = footer.createEl('a'); github.href = GITHUB_URL; github.textContent = 'GitHub';
		footer.append(document.createTextNode(' · '));
		const docs = footer.createEl('a'); docs.href = DOCUMENTATION_URL; docs.textContent = 'Documentation';
	}
}

export { GameSyncSettingsTab as GameSyncSettingTab };
