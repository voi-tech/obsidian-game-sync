import { Notice, PluginSettingTab, getLanguage, type App, type Plugin, type Setting, type SettingDefinition, type SettingDefinitionGroup, type SettingDefinitionItem, type SettingDefinitionPage } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { GameProvider } from '../../model/provider';
import { SUPPORTED_BACKGROUND_INTERVAL_MINUTES, isSupportedBackgroundIntervalMinutes, type GameSyncSettings } from '../../model/settings';
import type { ProviderConnectionStatus } from '../../providers/provider';
import { renderConnectionStatus } from '../status';
import type { GameTrackRuntimeStatus } from '../../model/library-provider';
import type { GameTrackCsvSelection } from '../../providers/gametrack/csv/gametrack-csv-provider';
import type { PropertyMapping } from '../../model/property-mapping';
import { propertyMappingGroups, PROPERTY_CONTROL_PREFIX, PropertyMappingStore } from './property-settings';
import { templateKeyPage } from './template-key-catalog';

export interface GameSyncSettingsHost {
	readSettings: () => GameSyncSettings | Promise<GameSyncSettings>;
	writeSettings: (settings: GameSyncSettings) => void | Promise<void>;
	readPropertyMapping: () => PropertyMapping | undefined | Promise<PropertyMapping | undefined>;
	writePropertyMapping: (mapping: PropertyMapping) => void | Promise<void>;
	getConnectionStatus: (provider: GameProvider) => ProviderConnectionStatus | Promise<ProviderConnectionStatus>;
	connect: (provider: GameProvider, onConnected?: () => void) => void | Promise<void>;
	disconnect: (provider: GameProvider) => void | Promise<void>;
	syncNow?: (provider?: GameProvider) => void | Promise<void>;
	confirm: (message: string) => boolean | Promise<boolean>;
	openIgnoredGames: () => void | Promise<void>;
	openMatchManager: () => void | Promise<void>;
	copyDiagnostics: () => void | Promise<void>;
	getGameTrackStatus?: () => GameTrackRuntimeStatus | Promise<GameTrackRuntimeStatus>;
	chooseGameTrackExport?: () => GameTrackCsvSelection | undefined | Promise<GameTrackCsvSelection | undefined>;
}

export type GameSyncSettingsAdapter = GameSyncSettingsHost;

const PROVIDERS: readonly GameProvider[] = ['steam', 'playstation'];
const GITHUB_URL = 'https://github.com/voi-tech/obsidian-game-sync';
const DOCUMENTATION_URL = `${GITHUB_URL}#readme`;
/** Re-read state when the tab is shown again after this long, so changes made elsewhere (setup, commands) appear. */
const REFRESH_AFTER_MS = 1500;

type BooleanField = {
	[K in keyof GameSyncSettings]-?: GameSyncSettings[K] extends boolean ? K : never;
}[keyof GameSyncSettings];

function translation(key: string, params?: Record<string, string | number>): string {
	return t(key as TranslationKey, params as never);
}

function settingCopy(settings: GameSyncSettings): GameSyncSettings {
	return { ...settings, enabledProviders: { ...settings.enabledProviders } };
}

function required(value: string): string | undefined {
	return value.trim().length === 0 ? translation('settings.common.required') : undefined;
}

export function intervalLabel(minutes: number): string {
	return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/**
 * Game Sync settings, rendered declaratively with the Obsidian 1.13 settings API:
 * native groups, sub-pages, controls and settings search.
 */
export class GameSyncSettingsTab extends PluginSettingTab {
	private settings?: GameSyncSettings;
	private readonly properties: PropertyMappingStore;
	private readonly providerStatuses = new Map<GameProvider, ProviderConnectionStatus>();
	private gameTrackStatus?: GameTrackRuntimeStatus;
	private loadFailed = false;
	private refreshing?: Promise<void>;
	private lastRefreshAt = 0;
	private settingsSave: Promise<void> = Promise.resolve();

	constructor(app: App, private readonly plugin: Plugin, private readonly host: GameSyncSettingsHost) {
		super(app, plugin);
		this.properties = new PropertyMappingStore((mapping) => this.host.writePropertyMapping(mapping));
	}

	/** Reloads settings, mapping and live statuses, then re-renders the tab. */
	refresh(): Promise<void> {
		this.refreshing ??= this.load().finally(() => {
			this.refreshing = undefined;
			this.lastRefreshAt = Date.now();
			this.update();
		});
		return this.refreshing;
	}

	private async load(): Promise<void> {
		try {
			const [settings, mapping] = await Promise.all([this.host.readSettings(), this.host.readPropertyMapping()]);
			this.settings = settingCopy(settings);
			this.properties.reset(mapping ?? {});
			this.loadFailed = false;
		} catch {
			this.loadFailed = true;
			return;
		}
		await Promise.all([
			...PROVIDERS.map(async (provider) => {
				try { this.providerStatuses.set(provider, await this.host.getConnectionStatus(provider)); }
				catch { this.providerStatuses.set(provider, { provider, state: 'error', connected: false }); }
			}),
			(async () => {
				if (this.host.getGameTrackStatus === undefined) return;
				try { this.gameTrackStatus = await this.host.getGameTrackStatus(); }
				catch { this.gameTrackStatus = { code: 'EXPORT_NOT_FOUND', supported: true, database: 'unavailable', schema: 'unknown', games: 0, platforms: [] }; }
			})(),
		]);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		if (this.refreshing === undefined && Date.now() - this.lastRefreshAt > REFRESH_AFTER_MS) void this.refresh();
		if (this.settings === undefined) {
			return [{ type: 'group', items: [{ name: translation(this.loadFailed ? 'settings.common.loadError' : 'settings.common.loading') }] }];
		}
		return [
			this.accountsGroup(),
			...(this.host.getGameTrackStatus === undefined ? [] : [this.libraryGroup()]),
			this.syncGroup(),
			this.notesGroup(),
			this.moreGroup(),
			this.aboutGroup(),
		];
	}

	override getControlValue(key: string): unknown {
		if (key.startsWith(PROPERTY_CONTROL_PREFIX)) return this.properties.destination(key.slice(PROPERTY_CONTROL_PREFIX.length));
		const settings = this.settings;
		if (settings === undefined) return undefined;
		if (key === 'libraryProvider') return settings.libraryProvider === 'gametrack' ? 'gametrack' : 'direct';
		if (key === 'backgroundIntervalMinutes') return String(settings.backgroundIntervalMinutes);
		return settings[key as keyof GameSyncSettings];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(PROPERTY_CONTROL_PREFIX)) {
			const saved = await this.properties.set(key.slice(PROPERTY_CONTROL_PREFIX.length), typeof value === 'string' ? value : '');
			if (!saved) new Notice(translation('settings.common.mappingSaveError'));
			return;
		}
		if (key === 'backgroundIntervalMinutes' && !isSupportedBackgroundIntervalMinutes(Number(value))) return;
		await this.updateSettings((settings) => {
			if (key === 'libraryProvider') settings.libraryProvider = value === 'gametrack' ? 'gametrack' : undefined;
			else if (key === 'backgroundIntervalMinutes') settings.backgroundIntervalMinutes = Number(value);
			else (settings as unknown as Record<string, unknown>)[key] = value;
		});
		this.refreshDomState();
	}

	/**
	 * Applies one change on top of freshly read settings, so values changed elsewhere
	 * (account connection, setup) are never overwritten by this tab's cached copy.
	 */
	private updateSettings(change: (settings: GameSyncSettings) => void): Promise<void> {
		this.settingsSave = this.settingsSave.then(async () => {
			try {
				const next = settingCopy(await this.host.readSettings());
				change(next);
				await this.host.writeSettings(next);
				this.settings = next;
			} catch {
				new Notice(translation('settings.common.saveError'));
			}
		});
		return this.settingsSave;
	}

	private toggle(key: BooleanField, nameKey: string, descKey?: string): SettingDefinition {
		return { name: translation(nameKey), ...(descKey === undefined ? {} : { desc: translation(descKey) }), control: { type: 'toggle', key } };
	}

	private buttonRow(nameKey: string, descKey: string, buttonKey: string, callback: () => unknown, cta = false): SettingDefinition {
		return {
			name: translation(nameKey),
			desc: translation(descKey),
			render: (setting) => {
				setting.addButton((button) => {
					button.setButtonText(translation(buttonKey)).onClick(() => void callback());
					if (cta) button.setCta();
				});
			},
		};
	}

	private accountsGroup(): SettingDefinitionGroup {
		return {
			type: 'group',
			heading: translation('settings.sections.accounts'),
			items: PROVIDERS.map((provider): SettingDefinition => ({
				name: translation(`settings.accounts.${provider}`),
				render: (setting: Setting) => this.renderProvider(provider, setting),
			})),
		};
	}

	private renderProvider(provider: GameProvider, setting: Setting): void {
		const status = this.providerStatuses.get(provider);
		setting.settingEl.dataset.settingsProvider = provider;
		renderConnectionStatus(setting, provider === 'playstation' ? translation('connect.playstation.unofficial') : '', status);
		const action = (labelKey: string, callback: () => Promise<void>, cta: boolean): void => {
			setting.addButton((button) => {
				button.setButtonText(translation(labelKey)).onClick(() => void callback());
				button.buttonEl.dataset.providerAction = `${labelKey.split('.').at(-1)}:${provider}`;
				if (cta) button.setCta();
			});
		};
		if (status?.state === 'connected') {
			action('settings.accounts.reconnect', () => this.connect(provider), false);
			action('settings.accounts.disconnect', () => this.disconnect(provider), false);
		} else {
			action('settings.accounts.connect', () => this.connect(provider), true);
		}
	}

	private async connect(provider: GameProvider): Promise<void> {
		try {
			await this.host.connect(provider, () => void this.refresh());
			await this.refresh();
		} catch {
			new Notice(translation('settings.common.statusError'));
		}
	}

	private async disconnect(provider: GameProvider): Promise<void> {
		if (!await this.host.confirm(translation('settings.accounts.disconnectConfirm'))) return;
		try {
			await this.host.disconnect(provider);
			await this.refresh();
		} catch {
			new Notice(translation('settings.common.statusError'));
		}
	}

	private libraryGroup(): SettingDefinitionGroup {
		const status = this.gameTrackStatus;
		const options: Record<string, string> = { direct: translation('settings.library.direct') };
		if (status === undefined || status.code !== 'UNSUPPORTED_OS') options.gametrack = translation('sync.providers.gametrack');
		const statusText = status === undefined
			? translation('settings.library.checking')
			: status.code === 'READY'
				? `${translation('settings.library.gametrackDetected', { count: status.games })} · ${status.platforms.join(', ') || translation('settings.library.noPlatforms')}`
				: translation(`settings.library.gametrackUnavailable.${status.code}`);
		const items: SettingDefinition[] = [
			{ name: translation('settings.library.source'), desc: statusText, control: { type: 'dropdown', key: 'libraryProvider', options } },
		];
		if (this.host.chooseGameTrackExport !== undefined) items.push({
			name: translation('settings.library.export'),
			desc: this.exportDescription(status),
			visible: () => this.settings?.libraryProvider === 'gametrack',
			render: (setting) => {
				setting.addButton((button) => button
					.setButtonText(translation(this.settings?.gametrackExportName === undefined ? 'settings.library.chooseExport' : 'settings.library.chooseAnotherExport'))
					.onClick(() => void this.chooseGameTrackExport()));
				if (status?.code === 'READY' && this.host.syncNow !== undefined) setting.addButton((button) => button
					.setButtonText(translation('settings.library.previewExport'))
					.setCta()
					.onClick(() => void this.host.syncNow?.()));
			},
		});
		return { type: 'group', heading: translation('settings.sections.library'), items };
	}

	private exportDescription(status: GameTrackRuntimeStatus | undefined): string {
		const settings = this.settings;
		if (status?.code !== 'READY' || settings === undefined) return translation('settings.library.exportDescription');
		return [
			settings.gametrackExportName ?? translation('settings.library.exportSelected'),
			status.gameTrackVersion === undefined ? undefined : translation('settings.library.gameTrackVersion', { version: status.gameTrackVersion }),
			status.exportCreated === undefined ? undefined : translation('settings.library.exportCreated', { date: status.exportCreated }),
			settings.gametrackLastImportedAt === undefined ? undefined : translation('settings.library.lastImported', { date: settings.gametrackLastImportedAt }),
		].filter((value): value is string => value !== undefined).join(' · ');
	}

	private async chooseGameTrackExport(): Promise<void> {
		try {
			const selection = await this.host.chooseGameTrackExport?.();
			if (selection === undefined) return;
			await this.updateSettings((settings) => {
				settings.libraryProvider = 'gametrack';
				settings.gametrackExportPath = selection.path;
				settings.gametrackExportName = selection.name;
				settings.gametrackExportSize = selection.size;
				settings.gametrackExportModifiedAt = selection.modifiedAt;
			});
			await this.refresh();
		} catch {
			new Notice(translation('settings.library.exportError'));
		}
	}

	private syncGroup(): SettingDefinitionGroup {
		return {
			type: 'group',
			heading: translation('settings.sections.sync'),
			items: [
				this.buttonRow('settings.sync.syncAll', 'settings.sync.syncAllDescription', 'settings.sync.syncAll', () => this.host.syncNow?.(), true),
				this.toggle('backgroundSync', 'settings.sync.backgroundSync', 'settings.sync.backgroundSyncDescription'),
				{
					name: translation('settings.sync.backgroundInterval'),
					desc: translation('settings.sync.backgroundIntervalDescription'),
					visible: () => this.settings?.backgroundSync === true,
					control: {
						type: 'dropdown',
						key: 'backgroundIntervalMinutes',
						options: Object.fromEntries(SUPPORTED_BACKGROUND_INTERVAL_MINUTES.map((minutes) => [String(minutes), intervalLabel(minutes)])),
					},
				},
			],
		};
	}

	private notesGroup(): SettingDefinitionGroup {
		return {
			type: 'group',
			heading: translation('settings.sections.notes'),
			items: [
				{
					name: translation('settings.notesTemplates.notesFolder'),
					desc: translation('settings.notesTemplates.notesFolderDescription'),
					control: { type: 'folder', key: 'notesFolder', placeholder: translation('settings.notesTemplates.notesFolderPlaceholder'), validate: required },
				},
				{
					name: translation('settings.notesTemplates.templatePath'),
					desc: translation('settings.notesTemplates.templateDescription'),
					control: { type: 'file', key: 'templatePath', placeholder: translation('settings.notesTemplates.templatePlaceholder'), filter: (file) => file.extension === 'md' },
				},
				templateKeyPage(getLanguage().toLocaleLowerCase().startsWith('pl')),
			],
		};
	}

	private page(nameKey: string, descKey: string, items: SettingDefinitionItem[]): SettingDefinitionPage {
		return { type: 'page', name: translation(nameKey), desc: translation(descKey), items };
	}

	private moreGroup(): SettingDefinitionGroup {
		return {
			type: 'group',
			heading: translation('settings.sections.more'),
			items: [
				this.page('settings.advanced.libraryFilters', 'settings.advanced.libraryFiltersDescription', [{ type: 'group', items: [
					this.toggle('includeUnplayed', 'settings.library.includeUnplayed'),
					this.toggle('includeFreeToPlay', 'settings.library.includeFreeToPlay'),
					this.toggle('includePreviouslyPlayedNoLongerOwned', 'settings.library.includePreviouslyPlayedNoLongerOwned'),
					this.toggle('includeDemosTrials', 'settings.library.includeDemosTrials'),
					this.toggle('includeBetasTestApps', 'settings.library.includeBetasTestApps'),
				] }]),
				this.page('settings.advanced.noteProperties', 'settings.advanced.notePropertiesDescription', propertyMappingGroups(this.properties)),
				this.page('settings.advanced.metadata', 'settings.advanced.metadataDescription', [
					{ type: 'group', items: [
						{ name: translation('settings.advanced.metadataLanguage'), control: { type: 'dropdown', key: 'metadataLanguage', options: {
							'follow-obsidian': translation('settings.advanced.followObsidian'), english: translation('settings.advanced.english'), polish: translation('settings.advanced.polish'),
						} } },
						{ name: translation('settings.advanced.metadataPreference'), control: { type: 'dropdown', key: 'metadataPreference', options: {
							automatic: translation('settings.advanced.automatic'), english: translation('settings.advanced.english'), polish: translation('settings.advanced.polish'),
						} } },
					] },
					{ type: 'group', heading: translation('settings.achievements.achievementsAndTrophies'), items: [
						this.toggle('showAchievementRarity', 'settings.achievements.showAchievementRarity'),
						this.toggle('showTrophyType', 'settings.achievements.showTrophyType'),
						this.toggle('showUnlockDate', 'settings.achievements.showUnlockDate'),
					] },
				]),
				this.page('settings.advanced.additionalData', 'settings.advanced.additionalDataDescription', [{ type: 'group', items: [
					this.toggle('steamEnricherEnabled', 'settings.advanced.steamEnricher'),
					this.toggle('playstationEnricherEnabled', 'settings.advanced.playstationEnricher'),
				] }]),
				this.page('settings.advanced.gameHistory', 'settings.advanced.gameHistoryDescription', [{ type: 'group', items: [
					this.toggle('recordHistory', 'settings.history.recordHistory'),
					{
						name: translation('settings.history.historyPath'),
						desc: translation('settings.history.historyPathDescription'),
						visible: () => this.settings?.recordHistory === true,
						control: { type: 'text', key: 'historyPath', placeholder: translation('settings.history.historyPathPlaceholder'), validate: required },
					},
				] }]),
				{ name: translation('settings.advanced.ignoredGames'), desc: translation('settings.advanced.ignoredGamesDescription'), action: () => void this.host.openIgnoredGames() },
				{ name: translation('settings.advanced.matchManager'), desc: translation('settings.advanced.matchManagerDescription'), action: () => void this.host.openMatchManager() },
				this.buttonRow('settings.advanced.diagnostics', 'settings.advanced.diagnosticsDescription', 'settings.advanced.copyDiagnostics', () => this.host.copyDiagnostics()),
			],
		};
	}

	private aboutGroup(): SettingDefinitionGroup {
		const version = (this.plugin as Plugin & { manifest?: { version?: string } }).manifest?.version ?? '';
		return {
			type: 'group',
			items: [{
				name: `Game Sync ${version}`.trim(),
				searchable: false,
				desc: createFragment((fragment) => {
					fragment.createEl('a', { text: 'GitHub', href: GITHUB_URL });
					fragment.appendText(' · ');
					fragment.createEl('a', { text: translation('settings.common.documentation'), href: DOCUMENTATION_URL });
				}),
			}],
		};
	}
}

export { GameSyncSettingsTab as GameSyncSettingTab };
