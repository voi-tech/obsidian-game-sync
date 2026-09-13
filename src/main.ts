import { apiVersion, Notice, Platform, Plugin, type App, type Component } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, createObsidianSecretStore, type SecretStore } from './auth/secrets';
import { buildDiagnosticReport } from './diagnostics/report';
import type { GameProvider, ProviderAccount } from './model/provider';
import type { GameSyncSettings } from './model/settings';
import { createHttpClient, type HttpClient } from './network/http';
import { createPlayStationAdapter } from './providers/playstation/adapter';
import type { GameProviderAdapter } from './providers/provider';
import { createSteamAdapter } from './providers/steam/adapter';
import { createGameSyncCommandActions, type RuntimeUiPort } from './runtime/actions';
import { GameSyncRuntimeComposition } from './runtime/composition';
import { registerGameSyncCommands, type CommandErrorHandler, type CommandRegistrar, type GameSyncCommandActions } from './runtime/commands';
import { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';
import { createStateStore, type StateStore } from './state/store';
import { BackgroundSyncScheduler, type BackgroundSyncService } from './sync/scheduler';
import type { PreparedSync, SyncApplyResult, SyncService } from './sync/service';
import { PlayStationConnectModal } from './ui/playstation-connect-modal';
import { PreviewModal } from './ui/preview-modal';
import { IgnoredGamesModal } from './ui/ignored-games-modal';
import { LibrarySummaryModal } from './ui/library-summary-modal';
import { SetupModal } from './ui/setup/setup-modal';
import { SteamConnectModal } from './ui/steam-connect-modal';
import { SummaryModal } from './ui/summary-modal';
import { ObsidianVaultGateway } from './vault/gateway';
import { renderTemplate } from './vault/template';

export { GAME_SYNC_RUNTIME_REGISTRY } from './runtime/registry';

export interface GameSyncRuntimeHost {
	app: App;
	gameSyncVersion?: string;
	loadData: () => Promise<unknown>;
	saveData: StateStore['save'];
	addCommand: CommandRegistrar['addCommand'];
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

const STATIC_COMMAND_ERROR = 'Game Sync command failed.';

export function createStaticCommandErrorNotifier(notify: (message: string) => void = (message) => { new Notice(message); }): CommandErrorHandler {
	return () => notify(STATIC_COMMAND_ERROR);
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

function providerStatusInput(state: Awaited<ReturnType<StateStore['load']>>, provider: GameProvider): { enabled: boolean; status: string } {
	return {
		enabled: state.settings.enabledProviders[provider],
		status: state.lastSuccessfulProviderStates[provider]?.status ?? 'unknown',
	};
}

function createBackgroundService(composition: GameSyncRuntimeComposition): BackgroundSyncService {
	let serviceForRun: SyncService | undefined;
	return {
		async prepareAll(): Promise<PreparedSync> {
			const service = await composition.createService();
			serviceForRun = service;
			try {
				return await service.prepareAll();
			} catch (error) {
				if (serviceForRun === service) serviceForRun = undefined;
				throw error;
			}
		},
		async applySelection(prepared, selectedOperationIds, options): Promise<SyncApplyResult> {
			const service = serviceForRun;
			if (service === undefined) throw new Error('Background sync service is not prepared.');
			try {
				return await service.applySelection(prepared, selectedOperationIds, options);
			} finally {
				if (serviceForRun === service) serviceForRun = undefined;
			}
		},
	};
}

export function createGameSyncRuntime(host: GameSyncRuntimeHost, options: GameSyncRuntimeOptions = {}): GameSyncRuntime {
	const secretStore = createObsidianSecretStore(host.app.secretStorage);
	const stateStore = createStateStore(host.loadData, host.saveData, secretValues(secretStore));
	const http = createHttpClient();
	const gateway = new ObsidianVaultGateway(host.app.vault, host.app.fileManager);
	const composition = new GameSyncRuntimeComposition({
		stateStore,
		gateway,
		secretValues: secretValues(secretStore),
		createAdapters: (settings) => createAdapters(http, secretStore, settings),
	});

	let actions!: GameSyncCommandActions;
	let setupService: SyncService | undefined;

	const saveConnectedAccount = async (account: ProviderAccount): Promise<void> => {
		const state = await stateStore.load();
		if (account.provider === 'steam') {
			state.settings.steamAccountId = account.accountId;
			state.settings.enabledProviders.steam = true;
		} else {
			state.settings.enabledProviders.playstation = true;
		}
		await stateStore.save(state);
	};

	const getConnectionStatus = async (provider: GameProvider) => {
		const settings = (await stateStore.load()).settings;
		const adapter = createAdapters(http, secretStore, settings).find((candidate) => candidate.id === provider);
		if (adapter === undefined) throw new Error('Provider adapter is unavailable.');
		return adapter.getConnectionStatus();
	};

	const openTemplate = async (): Promise<void> => {
		const path = (await stateStore.load()).settings.templatePath.trim();
		if (path.length > 0) await host.app.workspace.openLinkText(path, '', false);
	};

	const openGamesBase = async (): Promise<void> => {
		const path = (await stateStore.load()).settings.basePath;
		await host.app.workspace.openLinkText(path, '', false);
	};

	const validateTemplate = async (templatePath: string): Promise<void> => {
		const path = templatePath.trim();
		if (path.length === 0) return;
		if (!(await gateway.exists(path))) throw new Error('Template does not exist.');
		renderTemplate(await gateway.read(path), { title: 'Game Sync' } as never);
	};

	const ui: RuntimeUiPort = {
		openPreview: (prepared, onApply, onReviewDecision) => {
			new PreviewModal(host.app, {
				prepared,
				onApply: (value, selectedOperationIds) => Promise.resolve(onApply(value, selectedOperationIds)).then(() => undefined),
				onReviewDecision: (decision) => Promise.resolve(onReviewDecision(decision)).then(() => undefined),
			}).open();
		},
		openSummary: (summary, _onOpenBase, onSyncNow) => {
			if ('plan' in summary) new SummaryModal(host.app, { result: summary }).open();
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
				openConnection: (provider) => {
					if (provider === 'steam') {
						new SteamConnectModal(host.app, { http, secretStore, onConnected: saveConnectedAccount }).open();
					} else {
						new PlayStationConnectModal(host.app, {
							secretStore,
							openUrl: (url) => { window.open(url, '_blank'); },
							onConnected: saveConnectedAccount,
						}).open();
					}
				},
				getConnectionStatus,
				openTemplate: () => { void openTemplate(); },
				fixTemplate: () => { void openTemplate(); },
				validateTemplate,
				prepareAll: async () => {
					setupService = await composition.createService();
					return setupService.prepareAll();
				},
				onPreparedSync: async (prepared) => {
					const service = setupService;
					if (service === undefined) return;
					await ui.openPreview(
						prepared,
						async (preview, selectedOperationIds) => {
							const result = await service.applySelection(preview, selectedOperationIds, { explicit: true });
							await ui.openSummary(result, () => undefined, () => actions.syncAll());
						},
						async () => undefined,
					);
				},
			}).open();
		},
		copyDiagnostics: async () => {
			const state = await stateStore.load();
			const report = buildDiagnosticReport({
				gameSyncVersion: host.gameSyncVersion,
				obsidianVersion: apiVersion,
				osPlatform: Platform.isMobile ? 'mobile' : 'desktop',
				providerStatuses: {
					steam: providerStatusInput(state, 'steam'),
					playstation: providerStatusInput(state, 'playstation'),
				},
				lastSyncState: Object.keys(state.lastSuccessfulProviderStates).length > 0 ? 'complete' : 'unknown',
				stateSchemaVersion: state.schemaVersion,
				cacheSchemaVersion: 1,
			});
			const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
			if (clipboard?.writeText === undefined) {
				new Notice('Game sync: clipboard is unavailable.');
				return;
			}
			try {
				await clipboard.writeText(report);
			} catch {
				new Notice('Game sync: clipboard is unavailable.');
			}
		},
		showUnavailable: () => { new Notice('Game sync: this command is unavailable.'); },
	};

	actions = createGameSyncCommandActions({ composition, ui, stateStore });
	registerGameSyncCommands(host, actions, createStaticCommandErrorNotifier(options.notify));

	const scheduler = new BackgroundSyncScheduler({
		component: host,
		isMobile: options.isMobile ?? (() => Platform.isMobile),
		readSettings: async () => (await stateStore.load()).settings,
		service: createBackgroundService(composition),
		timer: options.timer ?? window,
		notify: options.notify ?? ((message) => { new Notice(message); }),
	});
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
			gameSyncVersion: this.manifest.version,
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
			addCommand: (command) => this.addCommand(command),
			registerInterval: (timerId) => this.registerInterval(timerId),
		});
		await this.runtime.ready;
	}

	override onunload(): void {
		this.runtime?.stop();
		this.runtime = undefined;
	}
}
