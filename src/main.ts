import { apiVersion, Notice, Platform, Plugin, type App, type Component } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, createObsidianSecretStore, type SecretStore } from './auth/secrets';
import { buildDiagnosticReport } from './diagnostics/report';
import { t } from './i18n';
import type { GameProvider, ProviderAccount } from './model/provider';
import type { GameSyncSettings } from './model/settings';
import { createHttpClient, type HttpClient } from './network/http';
import { createPlayStationAdapter } from './providers/playstation/adapter';
import type { GameProviderAdapter } from './providers/provider';
import { createSteamAdapter } from './providers/steam/adapter';
import { createSteamLibraryProvider } from './providers/steam/library-provider';
import { createSteamApi } from './providers/steam/api';
import { createSteamAuth } from './providers/steam/auth';
import { createSteamEnricher } from './providers/steam/enricher';
import { createPlayStationApi } from './providers/playstation/api';
import { createPlayStationAuth } from './providers/playstation/auth';
import { createPlayStationEnricher } from './providers/playstation/enricher';
import { createPlayStationLibraryProvider } from './providers/playstation/library-provider';
import { createGameSyncCommandActions, type RuntimeUiPort } from './runtime/actions';
import { GameSyncRuntimeComposition } from './runtime/composition';
import { registerGameSyncCommands, type CommandErrorHandler, type CommandRegistrar, type GameSyncCommandActions } from './runtime/commands';
import { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';
import { createStateStore, type StateStore } from './state/store';
import { BackgroundSyncScheduler } from './sync/scheduler';
import { createSyncConcurrencyGuard } from './sync/concurrency';
import { retry } from './sync/retry';
import type { SyncService } from './sync/service';
import { PlayStationConnectModal } from './ui/playstation-connect-modal';
import { PreviewModal } from './ui/preview-modal';
import { IgnoredGamesModal } from './ui/ignored-games-modal';
import { LibrarySummaryModal } from './ui/library-summary-modal';
import { MatchManagerModal } from './ui/match-manager';
import { SetupModal } from './ui/setup/setup-modal';
import { SteamConnectModal } from './ui/steam-connect-modal';
import { SummaryModal } from './ui/summary-modal';
import { AdditionalSettingsModal } from './ui/settings/additional-settings-modal';
import { CanonicalPreviewModal } from './ui/canonical-preview-modal';
import { GameSyncSettingsTab } from './ui/settings/game-sync-settings';
import { ObsidianVaultGateway } from './vault/gateway';
import { GameTrackCsvRuntime } from './providers/gametrack/csv/gametrack-csv-runtime';
import type { GameTrackCsvSelection, GameTrackCsvSource } from './providers/gametrack/csv/gametrack-csv-provider';
import { chooseGameTrackExportPath, type GameTrackExportDialog } from './providers/gametrack/csv/gametrack-csv-picker';

declare const require: (moduleName: string) => unknown;

function requireRuntimeModule(moduleName: string): unknown {
	return require(moduleName);
}

export { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';

export interface GameSyncRuntimeHost {
	app: App;
	plugin?: Plugin;
	gameSyncVersion?: string;
	loadData: () => Promise<unknown>;
	saveData: StateStore['save'];
	addCommand: CommandRegistrar['addCommand'];
	addSettingTab?: (settingTab: GameSyncSettingsTab) => void;
	registerInterval: Component['registerInterval'];
}

export interface GameSyncRuntimeOptions {
	timer?: Pick<Window, 'setInterval' | 'clearInterval'>;
	isMobile?: () => boolean;
	notify?: (message: string) => void;
}

export interface GameSyncRuntime {
	readonly stateStore: StateStore;
	readonly secretStore: SecretStore;
	readonly http: HttpClient;
	readonly composition: GameSyncRuntimeComposition;
	readonly actions: GameSyncCommandActions;
	readonly scheduler: BackgroundSyncScheduler;
	readonly ready: Promise<void>;
	stop(): void;
}

export function createStaticCommandErrorNotifier(notify: (message: string) => void = (message) => { new Notice(message); }): CommandErrorHandler {
	return () => notify(t('sync.messages.commandFailed'));
}

function secretValues(secretStore: SecretStore): string[] {
	return [
		secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey),
		secretStore.get(GAME_SYNC_SECRET_NAMES.psnAccessToken),
		secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken),
	].filter((value): value is string => value !== null && value.length > 0);
}

function createAdapters(http: HttpClient, secretStore: SecretStore, settings: GameSyncSettings): readonly GameProviderAdapter[] {
	return [
		createSteamAdapter({ http, secretStore, account: settings.steamAccountId ?? '' }),
		createPlayStationAdapter({ secretStore }),
	];
}

function createEnrichers(http: HttpClient, secretStore: SecretStore, settings: GameSyncSettings) {
	const enrichers = [];
	if (settings.steamEnricherEnabled && settings.steamAccountId !== undefined) {
		const auth = createSteamAuth({ http, secretStore, account: settings.steamAccountId });
		const api = createSteamApi({ http, apiKey: secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey) ?? '' });
		enrichers.push(createSteamEnricher({ auth, api }));
	}
	if (settings.playstationEnricherEnabled) {
		const auth = createPlayStationAuth({ secretStore });
		const api = createPlayStationApi(auth, auth.getAccount()?.accountId ?? 'me');
		enrichers.push(createPlayStationEnricher({ auth, api }));
	}
	return enrichers;
}

function providerStatusInput(state: Awaited<ReturnType<StateStore['load']>>, provider: GameProvider): { enabled: boolean; status: string } {
	return {
		enabled: state.settings.enabledProviders[provider],
		status: state.lastSuccessfulProviderStates[provider]?.status ?? 'unknown',
	};
}

export function createGameSyncRuntime(host: GameSyncRuntimeHost, options: GameSyncRuntimeOptions = {}): GameSyncRuntime {
	const secretStore = createObsidianSecretStore(host.app.secretStorage);
	const stateStore = createStateStore(host.loadData, host.saveData, secretValues(secretStore));
	const http = createHttpClient();
	const gateway = new ObsidianVaultGateway(host.app.vault, host.app.fileManager);
	const isMobile = options.isMobile ?? (() => Platform.isMobile);
	let selectedGameTrackSource: GameTrackCsvSource | undefined;
	const gameTrackCsvRuntime = new GameTrackCsvRuntime({
		host: isMobile() ? 'ios' : (Platform as unknown as { isMacOS?: boolean }).isMacOS === true ? 'macos' : 'windows',
		configured: async () => (await stateStore.load()).settings.gametrackExportPath !== undefined,
		source: async () => {
			if (selectedGameTrackSource !== undefined) return selectedGameTrackSource;
			const state = await stateStore.load();
			const path = state.settings.gametrackExportPath;
			if (path === undefined || isMobile()) return undefined;
			const desktop = await import('./providers/gametrack/csv/gametrack-csv-desktop-source');
			const source = desktop.createGameTrackCsvPathSource(path);
			try { await source.getFingerprint?.(); return source; } catch { return undefined; }
		},
	});
	const composition = new GameSyncRuntimeComposition({
		stateStore,
		gateway,
		secretValues: secretValues(secretStore),
		createAdapters: (settings) => createAdapters(http, secretStore, settings),
		canonicalProviderFactory: () => gameTrackCsvRuntime.getProvider(),
		canonicalProviderFactories: {
			steam: async (settings) => {
				const adapter = createAdapters(http, secretStore, settings).find((candidate) => candidate.id === 'steam');
				return adapter === undefined ? undefined : createSteamLibraryProvider({ adapter });
			},
			playstation: async (settings) => {
				const adapter = createAdapters(http, secretStore, settings).find((candidate) => candidate.id === 'playstation');
				return adapter === undefined ? undefined : createPlayStationLibraryProvider({ adapter });
			},
		},
		canonicalStatusFactory: () => gameTrackCsvRuntime.getStatus(),
		createEnrichers: (settings) => createEnrichers(http, secretStore, settings),
	});

	let actions!: GameSyncCommandActions;
	let setupService: SyncService | undefined;
	let setupCanonicalService: import('./sync/canonical-service').CanonicalSyncService | undefined;

	const saveConnectedAccount = async (account: ProviderAccount, onConnected?: () => void): Promise<void> => {
		const state = await stateStore.load();
		if (account.provider === 'steam') {
			state.settings.steamAccountId = account.accountId;
			state.settings.enabledProviders.steam = true;
		} else {
			state.settings.enabledProviders.playstation = true;
		}
		await stateStore.save(state);
		onConnected?.();
	};

	const getConnectionStatus = async (provider: GameProvider) => {
		const settings = (await stateStore.load()).settings;
		const adapter = createAdapters(http, secretStore, settings).find((candidate) => candidate.id === provider);
		if (adapter === undefined) throw new Error('Provider adapter is unavailable.');
		return adapter.getConnectionStatus();
	};

	const openGamesBase = async (): Promise<void> => {
		const path = (await stateStore.load()).settings.basePath;
		await host.app.workspace.openLinkText(path, '', false);
	};

	const openRepairModal = (provider: GameProvider, account?: string, onConnected?: () => void): void => {
		if (provider === 'steam') {
			new SteamConnectModal(host.app, {
				http,
				secretStore,
				account,
				openUrl: (url) => { window.open(url, '_blank'); },
				onConnected: (connected) => saveConnectedAccount(connected, onConnected),
			}).open();
			return;
		}
		new PlayStationConnectModal(host.app, {
			secretStore,
			openUrl: (url) => { window.open(url, '_blank'); },
			onConnected: (connected) => saveConnectedAccount(connected, onConnected),
		}).open();
	};

	const openConnection = (provider: GameProvider, onConnected?: () => void): void => {
		void (async () => {
			let state: Awaited<ReturnType<StateStore['load']>>;
			try {
				state = await stateStore.load();
			} catch {
				openRepairModal(provider);
				return;
			}
			const settings = state.settings;
			const adapter = createAdapters(http, secretStore, settings).find((candidate) => candidate.id === provider);
			const hasCredentials = provider === 'steam'
				? settings.steamAccountId !== undefined && settings.steamAccountId.trim().length > 0 && secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey) !== null
				: secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken) !== null;
			if (adapter !== undefined && hasCredentials) {
				try {
					const account = await retry(() => adapter.testConnection());
					await saveConnectedAccount(account, onConnected);
					new Notice(t('connect.common.reconnected', { provider: t(`sync.providers.${provider}`) }));
					return;
				} catch {
					// Fall through to the existing repair modal with a fixed, user-safe flow.
				}
			}
			openRepairModal(provider, provider === 'steam' ? settings.steamAccountId : undefined, onConnected);
		})();
	};

	const disconnectProvider = async (provider: GameProvider): Promise<void> => {
		const state = await stateStore.load();
		const adapter = createAdapters(http, secretStore, state.settings).find((candidate) => candidate.id === provider);
		if (adapter === undefined) throw new Error('Provider adapter is unavailable.');
		await adapter.disconnect();
		state.settings.enabledProviders[provider] = false;
		if (provider === 'steam') state.settings.steamAccountId = undefined;
		await stateStore.save(state);
	};
	const confirm = (message: string): boolean => {
		const browserConfirm = window['confirm'].bind(window);
		return browserConfirm(message);
	};
	const chooseGameTrackExport = async (): Promise<GameTrackCsvSelection | undefined> => {
		if (isMobile()) return undefined;
		const electronModule = requireRuntimeModule('electron') as { dialog?: GameTrackExportDialog; remote?: { dialog?: GameTrackExportDialog } };
		const dialog = electronModule.dialog ?? electronModule.remote?.dialog;
		if (dialog === undefined) throw new Error('Electron dialog.showOpenDialog is unavailable in the plugin runtime.');
		const currentPath = (await stateStore.load()).settings.gametrackExportPath;
		const selectedPath = await chooseGameTrackExportPath(dialog, currentPath);
		if (selectedPath === undefined) return undefined;
		const previous = selectedGameTrackSource;
		const desktop = await import('./providers/gametrack/csv/gametrack-csv-desktop-source');
		const source = desktop.createGameTrackCsvPathSource(selectedPath);
		selectedGameTrackSource = source;
		const status = await gameTrackCsvRuntime.getStatus();
		if (status.code !== 'READY') {
			selectedGameTrackSource = previous;
			throw new Error('The selected GameTrack export is not valid.');
		}
		const selection = source.getSelection?.();
		if (selection === undefined) throw new Error('The selected GameTrack export has no readable metadata.');
		const fingerprint = await source.getFingerprint?.();
		return {
			...selection,
			...(fingerprint === undefined ? {} : { size: fingerprint.size, modifiedAt: fingerprint.modifiedAt }),
		};
	};
	let ui!: RuntimeUiPort;
	const syncLock = createSyncConcurrencyGuard();
	let schedulerRef: BackgroundSyncScheduler | undefined;

	const settingsHost = {
		readSettings: async () => (await stateStore.load()).settings,
		writeSettings: async (settings: GameSyncSettings) => {
			const state = await stateStore.load();
			state.settings = { ...settings, enabledProviders: { ...settings.enabledProviders } };
			await stateStore.save(state);
			await schedulerRef?.refresh();
		},
		readPropertyMapping: async () => (await stateStore.load()).propertyMapping,
		writePropertyMapping: async (propertyMapping: import('./model/property-mapping').PropertyMapping) => {
			const state = await stateStore.load();
			state.propertyMapping = { ...propertyMapping };
			await stateStore.save(state);
		},
		getConnectionStatus,
		connect: openConnection,
		disconnect: disconnectProvider,
		syncNow: () => Promise.resolve(actions.syncAll()).then(() => undefined),
		confirm,
		openAdditionalSettings: () => {
			new AdditionalSettingsModal(host.app, {
				readSettings: settingsHost.readSettings,
				writeSettings: settingsHost.writeSettings,
				readPropertyMapping: settingsHost.readPropertyMapping,
				writePropertyMapping: settingsHost.writePropertyMapping,
				openIgnoredGames: () => Promise.resolve(ui.openIgnoredGames()),
				openMatchManager: async () => ui.openMatchManager(await composition.createMatchManager()),
				copyDiagnostics: () => Promise.resolve(ui.copyDiagnostics()),
			}).open();
		},
		getGameTrackStatus: () => composition.getGameTrackStatus(),
		chooseGameTrackExport,
	};
	if (host.addSettingTab !== undefined && host.plugin !== undefined) host.addSettingTab(new GameSyncSettingsTab(host.app, host.plugin, settingsHost));

	ui = {
		openPreview: (prepared, onApply, onReviewDecision) => {
			new PreviewModal(host.app, {
				prepared,
				onApply: (value, selectedOperationIds) => Promise.resolve(onApply(value, selectedOperationIds)).then(() => undefined),
				onReviewDecision: (decision) => Promise.resolve(onReviewDecision(decision)).then(() => undefined),
			}).open();
		},
		openCanonicalPreview: (preview, onApply) => {
			new CanonicalPreviewModal(host.app, {
				preview,
				onApply: (operationIds) => Promise.resolve(onApply(operationIds)).then(() => undefined),
			}).open();
		},
		openSummary: (summary, onOpenBase, onSyncNow) => {
			if ('plan' in summary) {
				void stateStore.load()
					.then((state) => new SummaryModal(host.app, { result: summary, notesFolder: state.settings.notesFolder, onOpenGames: () => Promise.resolve(onOpenBase()).then(() => undefined) }).open())
					.catch(() => new SummaryModal(host.app, { result: summary, onOpenGames: () => Promise.resolve(onOpenBase()).then(() => undefined) }).open());
			}
			else new LibrarySummaryModal(host.app, {
				summary,
				onOpenBase: () => Promise.resolve(openGamesBase()).then(() => undefined),
				onSyncNow: () => Promise.resolve(onSyncNow()).then(() => undefined),
			}).open();
		},
		openIgnoredGames: async () => {
			const state = await stateStore.load();
			const entries = [
				...state.ignoredCanonicalIds.map((id) => ({ kind: 'canonical' as const, id, label: id })),
				...state.ignoredProviderRefs.flatMap((id) => {
					const separator = id.indexOf(':');
					const providerName = id.slice(0, separator);
					if (separator <= 0 || (providerName !== 'steam' && providerName !== 'playstation')) return [];
					const provider: GameProvider = providerName === 'steam' ? 'steam' : 'playstation';
					return [{ kind: 'providerRef' as const, id, label: id, provider }];
				}),
			];
			new IgnoredGamesModal(host.app, {
				adapter: {
					entries,
					restore: async (ids) => {
						const next = await stateStore.load();
						next.ignoredCanonicalIds = next.ignoredCanonicalIds.filter((id) => !ids.includes(id));
						next.ignoredProviderRefs = next.ignoredProviderRefs.filter((id) => !ids.includes(id));
						await stateStore.save(next);
					},
				},
			}).open();
		},
		openSetupWizard: () => {
			new SetupModal(host.app, {
				stateStore,
				save: (state) => stateStore.save(state),
				openConnection,
				disconnect: disconnectProvider,
				confirm,
				getConnectionStatus,
				prepareAll: async () => {
					setupService = await composition.createService();
					return setupService.prepareAll();
				},
					getGameTrackStatus: () => composition.getGameTrackStatus(),
					chooseGameTrackExport,
				prepareGameTrack: async () => {
					setupCanonicalService = await composition.createCanonicalService();
					if (setupCanonicalService === undefined) throw new Error('GameTrack provider is unavailable.');
					return setupCanonicalService.preview();
				},
				prepareCanonical: async () => {
					setupCanonicalService = await composition.createCanonicalService();
					if (setupCanonicalService === undefined) throw new Error('Selected library provider is unavailable.');
					return setupCanonicalService.preview();
				},
				onGameTrackPreview: async (preview) => {
					if (ui.openCanonicalPreview === undefined) return;
					await ui.openCanonicalPreview(preview, async (operationIds) => {
						if (setupCanonicalService === undefined) throw new Error('GameTrack provider is unavailable.');
						await setupCanonicalService.applyPreview(preview, operationIds);
						const importedState = await stateStore.load();
						importedState.settings.gametrackLastImportedAt = new Date().toISOString();
						await composition.approveCanonicalBackgroundSync();
						importedState.settings.setupCompleted = true;
						await stateStore.save(importedState);
					});
				},
					onCanonicalPreview: async (preview) => {
					if (ui.openCanonicalPreview === undefined) return;
					await ui.openCanonicalPreview(preview, async (operationIds) => {
						if (setupCanonicalService === undefined) throw new Error('Selected library provider is unavailable.');
						await setupCanonicalService.applyPreview(preview, operationIds);
						const importedState = await stateStore.load();
						if (importedState.settings.libraryProvider === 'gametrack') {
							importedState.settings.gametrackLastImportedAt = new Date().toISOString();
							await composition.approveCanonicalBackgroundSync();
						}
						importedState.settings.setupCompleted = true;
						await stateStore.save(importedState);
					});
				},
				onPreparedSync: async (prepared) => {
					const service = setupService;
					if (service === undefined) return;
					await ui.openPreview(
						prepared,
						async (preview, selectedOperationIds) => {
							const result = await service.applySelection(preview, selectedOperationIds, { explicit: true });
							const state = await stateStore.load();
							state.settings.setupCompleted = true;
							await stateStore.save(state);
							await ui.openSummary(result, () => undefined, () => actions.syncAll());
						},
						async () => undefined,
					);
				},
			}).open();
		},
	copyDiagnostics: async () => {
			const state = await stateStore.load();
			const gameTrackStatus = await composition.getGameTrackStatus();
			const report = buildDiagnosticReport({
				gameSyncVersion: host.gameSyncVersion,
				obsidianVersion: apiVersion,
				osPlatform: Platform.isMobile ? 'mobile' : 'desktop',
				providerStatuses: {
					gametrack: { enabled: state.settings.libraryProvider === 'gametrack', status: gameTrackStatus.code, readiness: gameTrackStatus.code, games: gameTrackStatus.games, warnings: gameTrackStatus.warningCount ?? 0, errorCodes: gameTrackStatus.errorCodes ?? [] },
					steam: providerStatusInput(state, 'steam'),
					playstation: providerStatusInput(state, 'playstation'),
				},
				lastSyncState: Object.keys(state.lastSuccessfulProviderStates).length > 0 ? 'complete' : 'unknown',
				stateSchemaVersion: state.schemaVersion,
				cacheSchemaVersion: 1,
			});
			const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
			if (clipboard?.writeText === undefined) {
				new Notice(t('sync.messages.clipboardUnavailable'));
				return;
			}
			try {
				await clipboard.writeText(report);
			} catch {
				new Notice(t('sync.messages.clipboardUnavailable'));
			}
		},
		openMatchManager: (adapter) => { new MatchManagerModal(host.app, { adapter }).open(); },
		showUnavailable: (commandId) => { new Notice(commandId === 'gametrack' ? t('sync.messages.gametrackUnavailable') : t('sync.messages.commandUnavailable')); },
	};

	actions = createGameSyncCommandActions({ composition, ui, stateStore, runExclusive: syncLock });
	registerGameSyncCommands(host, actions, createStaticCommandErrorNotifier(options.notify));
	const scheduler = new BackgroundSyncScheduler({
		component: host,
		isMobile,
		readSettings: async () => (await stateStore.load()).settings,
		executor: composition.createSyncExecutor({ background: true }),
		runExclusive: syncLock,
		timer: options.timer ?? window,
		notify: options.notify ?? ((message) => { new Notice(message); }),
	});
	schedulerRef = scheduler;
	const ready = scheduler.start();

	return {
		stateStore,
		secretStore,
		http,
		composition,
		actions,
		scheduler,
		ready,
		stop: () => scheduler.stop(),
	};
}

export default class GameSyncPlugin extends Plugin {
	private runtime?: GameSyncRuntime;

	override async onload(): Promise<void> {
		void GAME_SYNC_RUNTIME_REGISTRY.marker;
		this.runtime = createGameSyncRuntime({
			app: this.app,
			plugin: this,
			gameSyncVersion: this.manifest.version,
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
			addCommand: (command) => this.addCommand(command),
			addSettingTab: (settingTab) => this.addSettingTab(settingTab),
			registerInterval: (timerId) => this.registerInterval(timerId),
		});
		await this.runtime.ready;
		const runtime = this.runtime;
		this.app.workspace.onLayoutReady(() => {
			void runtime.stateStore.load().then((state) => {
				if (!state.settings.setupCompleted) runtime.actions.runSetupWizard();
			}).catch(() => undefined);
		});
	}

	override onunload(): void {
		this.runtime?.stop();
		this.runtime = undefined;
	}
}
