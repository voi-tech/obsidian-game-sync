import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { t } from '../../i18n';
import type { GameProvider } from '../../model/provider';
import type { GameSyncSettings } from '../../model/settings';
import { migrateState } from '../../state/migrations';
import type { GameSyncData } from '../../state/schema';
import type { StateStore } from '../../state/store';
import type { PreparedSync } from '../../sync/service';
import type { ProviderConnectionStatus } from '../../providers/provider';
import { renderConnectionStatus } from '../status';
import type { GameTrackRuntimeStatus } from '../../model/library-provider';
import type { CanonicalPreviewResult } from '../../sync/canonical-service';
import type { GameTrackCsvSelection } from '../../providers/gametrack/csv/gametrack-csv-provider';

export interface SetupModalOptions {
	stateStore: StateStore;
	save: (state: GameSyncData) => Promise<void>;
	openConnection: (provider: GameProvider, onConnected?: () => void) => void | Promise<void>;
	disconnect?: (provider: GameProvider) => void | Promise<void>;
	confirm?: (message: string) => boolean | Promise<boolean>;
	getConnectionStatus: (provider: GameProvider) => Promise<ProviderConnectionStatus>;
	prepareAll: () => Promise<PreparedSync>;
	onPreparedSync: (prepared: PreparedSync) => void | Promise<void>;
	getGameTrackStatus?: () => GameTrackRuntimeStatus | Promise<GameTrackRuntimeStatus>;
	prepareGameTrack?: () => Promise<CanonicalPreviewResult>;
	onGameTrackPreview?: (preview: CanonicalPreviewResult) => void | Promise<void>;
	/** Canonical preview hook shared by GameTrack, Steam and PlayStation library sources. */
	prepareCanonical?: () => Promise<CanonicalPreviewResult>;
	onCanonicalPreview?: (preview: CanonicalPreviewResult) => void | Promise<void>;
	chooseGameTrackExport?: () => GameTrackCsvSelection | undefined | Promise<GameTrackCsvSelection | undefined>;
}

type SetupButton = Pick<ButtonComponent, 'setButtonText' | 'setCta' | 'setDisabled'> & { buttonEl: HTMLButtonElement };
type Provider = 'steam' | 'playstation';

const PROVIDERS: readonly Provider[] = ['steam', 'playstation'];

function providerLabel(provider: Provider): string {
	return t(`sync.providers.${provider}`);
}

function providerDescription(provider: Provider): string {
	return provider === 'steam' ? t('setup.providers.steamDescription') : `${t('setup.providers.playstationDescription')} ${t('connect.playstation.unofficial')}.`;
}

function isConnected(status: ProviderConnectionStatus | undefined): boolean {
	return status?.state === 'connected' && status.connected;
}

export class SetupModal extends Modal {
	private state?: GameSyncData;
	private readonly statuses = new Map<Provider, ProviderConnectionStatus>();
	private gameTrackStatus?: GameTrackRuntimeStatus;
	private lifecycle = 0;
	private isOpen = false;
	private pending = false;
	private statusEl?: HTMLElement;
	private previewButton?: SetupButton;

	constructor(app: App, private readonly options: SetupModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		const version = ++this.lifecycle;
		this.statuses.clear();
		this.gameTrackStatus = undefined;
		this.setTitle(t('setup.title'));
		this.contentEl.replaceChildren();
		void this.load(version);
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		this.pending = false;
		this.previewButton = undefined;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private async load(version: number): Promise<void> {
		try {
			this.state = migrateState(await this.options.stateStore.load());
		} catch {
			this.state = migrateState(undefined);
		}
		if (!this.isCurrent(version)) return;
		this.renderQuickSetup();
		await Promise.all(PROVIDERS.map((provider) => this.refreshProvider(provider, version)));
		if (this.options.getGameTrackStatus !== undefined) await this.refreshGameTrack(version);
	}

	private settings(): GameSyncSettings {
		if (this.state === undefined) throw new Error('Setup state is not loaded.');
		return this.state.settings;
	}

	private renderQuickSetup(): void {
		if (!this.isOpen || this.state === undefined) return;
		this.contentEl.replaceChildren();
		this.contentEl.dataset.quickSetup = 'true';
		this.previewButton = undefined;
		this.statusEl = undefined;

		const description = this.contentEl.createEl('p');
		description.dataset.quickSetupDescription = 'true';
		description.textContent = t('setup.description');
		for (const provider of PROVIDERS) this.renderProviderSetting(provider);
		this.renderGameTrackSetting();
		this.renderFolder();

		const actions = new Setting(this.contentEl).setName(t('setup.preview')).setDesc(t('setup.previewNote'));
		actions.settingEl.dataset.quickSetupActions = 'true';
		actions.settingEl.dataset.gameSyncActionRow = 'true';
		actions.addButton((button) => {
			this.previewButton = button.setButtonText(t('setup.preview')).setCta();
			this.previewButton.buttonEl.dataset.quickSetupPreview = 'true';
			this.previewButton.setDisabled(!this.hasSelectedProvider());
			button.onClick(() => void this.prepareInitialSync());
		});

		this.statusEl = this.contentEl.createEl('p');
		this.statusEl.dataset.quickSetupStatus = 'true';
		this.statusEl.setAttribute('aria-live', 'polite');
	}

	private renderGameTrackSetting(): void {
		if (this.options.getGameTrackStatus === undefined) return;
		if (this.gameTrackStatus?.code === 'UNSUPPORTED_OS') return;
		const setting = new Setting(this.contentEl).setName(t('sync.providers.gametrack'));
		setting.settingEl.dataset.providerSetting = 'gametrack';
		const status = this.gameTrackStatus;
		setting.setDesc(status?.code === 'READY' ? t('setup.gametrack.detected', { count: status.games }) : t('settings.library.exportDescription'));
		if (status?.code === 'READY') setting.addButton((button) => {
			button.setButtonText(this.settings().libraryProvider === 'gametrack' ? t('setup.gametrack.selected') : t('setup.gametrack.use'));
			button.buttonEl.dataset.providerAction = 'select:gametrack';
			button.setDisabled(this.settings().libraryProvider === 'gametrack');
			button.onClick(() => void this.selectGameTrack());
		});
		if (this.options.chooseGameTrackExport !== undefined) setting.addButton((button) => {
			button.setButtonText(status?.code === 'READY' ? t('settings.library.chooseAnotherExport') : t('settings.library.chooseExport'));
			button.buttonEl.dataset.providerAction = 'choose-export:gametrack';
			button.onClick(() => void this.chooseGameTrackExport());
		});
	}

	private renderProviderSetting(provider: Provider): void {
		const setting = new Setting(this.contentEl).setName(providerLabel(provider));
		setting.settingEl.dataset.providerSetting = provider;
		setting.settingEl.dataset.gameSyncActionRow = 'true';
		const connection = this.statuses.get(provider);
		const status = renderConnectionStatus(setting, providerDescription(provider), connection);
		if (connection?.account?.gameCount !== undefined) status.append(document.createTextNode(` · ${t('setup.provider.gamesFound', { count: connection.account.gameCount })}`));
		if (isConnected(connection)) {
			this.providerAction(setting, provider, 'reconnect', false, () => void this.options.openConnection(provider, () => void this.refreshProvider(provider)));
			this.providerAction(setting, provider, 'disconnect', false, () => void this.disconnect(provider));
		} else {
			this.providerAction(setting, provider, 'connect', true, () => void this.options.openConnection(provider, () => void this.refreshProvider(provider)));
		}
	}

	private providerAction(setting: Setting, provider: Provider, action: 'connect' | 'reconnect' | 'disconnect', cta: boolean, callback: () => void): void {
		setting.addButton((button) => {
			button.setButtonText(action === 'connect' ? `${t('setup.provider.connect')} ${providerLabel(provider)}` : t(`setup.provider.${action}`));
			if (cta) button.setCta();
			button.buttonEl.dataset.providerAction = `${action}:${provider}`;
			button.onClick(callback);
		});
	}

	private renderFolder(): void {
		new Setting(this.contentEl).setName(t('setup.folder.title')).setDesc(t('setup.folder.description')).addText((component) => {
			component.inputEl.dataset.settingsField = 'notesFolder';
			component.inputEl.value = this.settings().notesFolder;
			component.setPlaceholder(t('setup.folder.placeholder'));
			component.onChange((value) => { this.settings().notesFolder = value.trim() || 'Games'; });
		});
	}

	private async refreshProvider(provider: Provider, version = this.lifecycle): Promise<void> {
		try {
			const status = await this.options.getConnectionStatus(provider);
			if (!this.isCurrent(version)) return;
			this.statuses.set(provider, status);
			this.renderQuickSetup();
		} catch {
			if (!this.isCurrent(version)) return;
			this.statuses.set(provider, { provider, state: 'error', connected: false });
			this.renderQuickSetup();
		}
	}

	private async refreshGameTrack(version = this.lifecycle): Promise<void> {
		try { this.gameTrackStatus = await this.options.getGameTrackStatus?.(); }
		catch { this.gameTrackStatus = { code: 'EXPORT_NOT_FOUND', supported: true, database: 'unavailable', schema: 'unknown', games: 0, platforms: [] }; }
		if (this.isCurrent(version)) this.renderQuickSetup();
	}

	private async selectGameTrack(): Promise<void> {
		if (this.gameTrackStatus?.code !== 'READY' || this.state === undefined) return;
		this.settings().libraryProvider = 'gametrack';
		try { await this.options.save(migrateState(this.state)); this.renderQuickSetup(); }
		catch { this.setStatus(t('setup.prepareFailed')); }
	}

	private async chooseGameTrackExport(): Promise<void> {
		try {
			const selection = await this.options.chooseGameTrackExport?.();
			if (selection === undefined || this.state === undefined) return;
			this.settings().libraryProvider = 'gametrack';
			this.settings().gametrackExportPath = selection.path;
			this.settings().gametrackExportName = selection.name;
			this.settings().gametrackExportSize = selection.size;
			this.settings().gametrackExportModifiedAt = selection.modifiedAt;
			await this.options.save(migrateState(this.state));
			await this.refreshGameTrack();
		} catch {
			this.setStatus(t('settings.library.exportError'));
		}
	}

	private hasConnectedProvider(): boolean {
		return PROVIDERS.some((provider) => isConnected(this.statuses.get(provider)));
	}

	private hasSelectedProvider(): boolean {
		return this.settings().libraryProvider === 'gametrack'
			? this.gameTrackStatus?.code === 'READY'
			: this.hasConnectedProvider();
	}

	private async disconnect(provider: Provider): Promise<void> {
		if (this.options.disconnect === undefined) return;
		const confirmed = await Promise.resolve(this.options.confirm?.(t('settings.accounts.disconnectConfirm')) ?? true);
		if (!confirmed || !this.isOpen) return;
		try {
			await this.options.disconnect(provider);
			await this.refreshProvider(provider);
		} catch {
			this.setStatus(t('setup.provider.disconnectFailed'));
		}
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private async prepareInitialSync(): Promise<void> {
		if (this.pending || !this.isOpen || this.state === undefined || this.previewButton === undefined) return;
		const version = this.lifecycle;
		this.pending = true;
		this.previewButton.setDisabled(true);
		this.previewButton.setButtonText(t('setup.preparing'));
		this.setStatus(t('setup.preparing'));
		const nextState = migrateState(this.state);
		if (nextState.settings.libraryProvider !== undefined && (this.options.prepareCanonical !== undefined || nextState.settings.libraryProvider === 'gametrack')) {
			try {
				await this.options.save(nextState);
				const preview = await (this.options.prepareCanonical ?? this.options.prepareGameTrack)?.();
				if (preview !== undefined) await (this.options.onCanonicalPreview ?? this.options.onGameTrackPreview)?.(preview);
				if (this.isCurrent(version)) this.close();
			} catch {
				if (this.isCurrent(version)) this.setStatus(t('setup.prepareFailed'));
			} finally {
				if (this.isCurrent(version)) {
					this.pending = false;
					this.previewButton?.setButtonText(t('setup.preview'));
					this.previewButton?.setDisabled(!this.hasSelectedProvider());
				}
			}
			return;
		}
		for (const provider of PROVIDERS) nextState.settings.enabledProviders[provider] = isConnected(this.statuses.get(provider));
		nextState.settings.setupCompleted = false;
		try {
			await this.options.save(nextState);
			if (!this.isCurrent(version)) return;
			this.state = nextState;
			const prepared = await this.options.prepareAll();
			if (!this.isCurrent(version)) return;
			await this.options.onPreparedSync(prepared);
			if (this.isCurrent(version)) this.close();
		} catch {
			if (this.isCurrent(version)) this.setStatus(t('setup.prepareFailed'));
		} finally {
			if (this.isCurrent(version)) {
				this.pending = false;
				this.previewButton?.setButtonText(t('setup.preview'));
				this.previewButton?.setDisabled(!this.hasSelectedProvider());
			}
		}
	}
}
