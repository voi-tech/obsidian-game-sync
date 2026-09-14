import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, type SecretStore } from '../auth/secrets';
import { t } from '../i18n';
import type { ProviderAccount } from '../model/provider';
import { ProviderHttpError, ProviderNetworkError, ProviderRateLimitError, ProviderSchemaError } from '../network/errors';
import { SteamAccountInputError, SteamInvalidApiKeyError, SteamPrivateGameDetailsError, createSteamAuth } from '../providers/steam/auth';
import type { SteamAuthOptions, SteamAuthService } from '../providers/steam/types';
import type { HttpClient } from '../network/http';
import { retry } from '../sync/retry';
import { renderStatusMessage } from './status';

export type SteamAuthFactory = (options: SteamAuthOptions) => SteamAuthService;
export const STEAM_API_KEY_URL = 'https://steamcommunity.com/dev/apikey';
export const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';

export interface SteamConnectModalOptions {
	http: HttpClient;
	secretStore: SecretStore;
	onConnected: (account: ProviderAccount) => void | Promise<void>;
	account?: string;
	openUrl?: (url: string) => void;
	createAuth?: SteamAuthFactory;
	authFactory?: SteamAuthFactory;
}

function createMemorySecretStore(): SecretStore {
	const values = new Map<string, string>();
	return {
		get: (name) => values.get(name) ?? null,
		set: (name, value) => void values.set(name, value),
		delete: (name) => void values.delete(name),
	};
}

function publicAccount(account: ProviderAccount): ProviderAccount {
	return {
		provider: account.provider,
		displayName: account.displayName,
		accountId: account.accountId,
		...(account.gameCount === undefined ? {} : { gameCount: account.gameCount }),
	};
}

function openUrl(url: string, opener?: (url: string) => void): void {
	if (opener !== undefined) {
		opener(url);
		return;
	}
	if (typeof window !== 'undefined') window.open(url, '_blank');
}

export class SteamConnectModal extends Modal {
	private apiKeyInput?: HTMLInputElement;
	private accountInput?: HTMLInputElement;
	private connectButton?: ButtonComponent;
	private statusEl?: HTMLElement;
	private errorActionEl?: HTMLElement;
	private doneButton?: HTMLButtonElement;
	private lifecycle = 0;
	private isOpen = false;

	constructor(app: App, private readonly options: SteamConnectModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.setTitle(t('connect.steam.title'));
		this.contentEl.replaceChildren();

		const intro = this.contentEl.createEl('p');
		intro.textContent = t('connect.steam.intro');
		const steps = this.contentEl.createEl('ol');
		const keyStep = steps.createEl('li');
		keyStep.append(document.createTextNode(t('connect.steam.getApiKeyStep')));
		new Setting(keyStep).addButton((button) => {
			button.setButtonText(t('connect.steam.openApiKey')).onClick(() => openUrl(STEAM_API_KEY_URL, this.options.openUrl));
		});
		const pasteStep = steps.createEl('li');
		pasteStep.textContent = t('connect.steam.pasteApiKeyStep');

		new Setting(this.contentEl)
			.setName(t('connect.steam.apiKey'))
			.setDesc(t('connect.steam.apiKeyDescription'))
			.addText((component) => {
				this.apiKeyInput = component.inputEl;
				component.inputEl.type = 'password';
				component.setPlaceholder(t('connect.steam.apiKeyPlaceholder'));
			});
		new Setting(this.contentEl)
			.setName(t('connect.steam.account'))
			.setDesc(t('connect.steam.accountDescription'))
			.addText((component) => {
				this.accountInput = component.inputEl;
				component.inputEl.type = 'text';
				component.inputEl.value = this.options.account ?? '';
				component.setPlaceholder(t('connect.steam.accountPlaceholder'));
			});
		this.statusEl = this.contentEl.createDiv();
		this.statusEl.className = 'game-sync-connect-status';
		this.statusEl.setAttribute('aria-live', 'polite');
		this.contentEl.append(this.statusEl);
		new Setting(this.contentEl).addButton((button) => {
			this.connectButton = button.setButtonText(t('connect.common.connect')).setCta();
			this.connectButton.buttonEl.dataset.connectPrimary = 'true';
			this.connectButton.onClick(() => void this.connect());
		});
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		if (this.accountInput !== undefined) this.accountInput.value = '';
		if (this.apiKeyInput !== undefined) this.apiKeyInput.value = '';
		this.connectButton?.setDisabled(true);
		this.doneButton?.remove();
		this.doneButton = undefined;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) {
			this.statusEl.replaceChildren();
			this.statusEl.textContent = message;
		}
	}

	private clearErrorAction(): void {
		this.errorActionEl?.remove();
		this.errorActionEl = undefined;
	}

	private showError(error: unknown): void {
		this.clearErrorAction();
		if (this.statusEl !== undefined) renderStatusMessage(this.statusEl, this.errorMessage(error));
		if (error instanceof SteamInvalidApiKeyError || error instanceof SteamPrivateGameDetailsError) {
			const action = new Setting(this.contentEl);
			this.errorActionEl = action.settingEl;
			action.addButton((button) => {
				button.setButtonText(error instanceof SteamInvalidApiKeyError ? t('connect.steam.openApiKey') : t('connect.steam.openPrivacySettings'));
				button.onClick(() => openUrl(error instanceof SteamInvalidApiKeyError ? STEAM_API_KEY_URL : STEAM_PRIVACY_URL, this.options.openUrl));
			});
		}
	}

	private showDone(): void {
		if (this.doneButton !== undefined) return;
		const footer = new Setting(this.contentEl);
		footer.addButton((button) => {
			this.doneButton = button.buttonEl;
			button.setButtonText(t('connect.common.done'));
			button.buttonEl.dataset.connectDone = 'true';
			button.onClick(() => this.close());
		});
	}

	private errorMessage(error: unknown): string {
		if (error instanceof SteamInvalidApiKeyError) return t('connect.steam.errors.invalidApiKey');
		if (error instanceof SteamPrivateGameDetailsError) return t('connect.steam.errors.privateGameDetails');
		if (error instanceof SteamAccountInputError) return t('connect.steam.errors.invalidAccount');
		if (error instanceof ProviderNetworkError) return t('connect.steam.errors.network');
		if (error instanceof ProviderRateLimitError) return t('connect.steam.errors.rateLimit');
		if (error instanceof ProviderHttpError) return t('connect.steam.errors.http');
		if (error instanceof ProviderSchemaError) return t('connect.steam.errors.schema');
		return t('connect.steam.errors.connectionFailed');
	}

	private async connect(): Promise<void> {
		if (!this.isOpen || this.accountInput === undefined || this.apiKeyInput === undefined || this.doneButton !== undefined) return;
		const account = this.accountInput.value.trim();
		const enteredApiKey = this.apiKeyInput.value.trim();
		const apiKey = enteredApiKey || this.options.secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey) || '';
		if (account.length === 0) {
			this.clearErrorAction();
			this.setStatus(t('connect.steam.errors.accountRequired'));
			return;
		}
		if (apiKey.length === 0) {
			this.clearErrorAction();
			this.setStatus(t('connect.steam.errors.apiKeyRequired'));
			return;
		}

		const version = ++this.lifecycle;
		const temporaryStore = createMemorySecretStore();
		temporaryStore.set(GAME_SYNC_SECRET_NAMES.steamApiKey, apiKey);
		this.connectButton?.setDisabled(true);
		this.connectButton?.setButtonText(t('connect.steam.connecting'));
		this.setStatus(t('connect.steam.connecting'));
		this.clearErrorAction();
		let connectedSuccessfully = false;
		try {
			const factory = this.options.createAuth ?? this.options.authFactory ?? createSteamAuth;
			const auth = factory({
				http: this.options.http,
				secretStore: temporaryStore,
				account,
				apiKeySecretName: GAME_SYNC_SECRET_NAMES.steamApiKey,
			});
			const connected = publicAccount(await retry(() => auth.testConnection()));
			if (!this.isCurrent(version)) return;
			if (enteredApiKey.length > 0) this.options.secretStore.set(GAME_SYNC_SECRET_NAMES.steamApiKey, enteredApiKey);
			await this.options.onConnected(connected);
			if (!this.isCurrent(version)) return;
			this.setStatus(t('connect.steam.success', { displayName: connected.displayName }));
			if (connected.gameCount !== undefined) this.setStatus(`${t('connect.steam.success', { displayName: connected.displayName })} ${t('connect.steam.gamesFound', { count: connected.gameCount })}`);
			connectedSuccessfully = true;
			this.showDone();
		} catch (error) {
			if (this.isCurrent(version)) this.showError(error);
		} finally {
			temporaryStore.delete(GAME_SYNC_SECRET_NAMES.steamApiKey);
			if (this.isCurrent(version)) {
			this.apiKeyInput.value = '';
				this.connectButton?.setButtonText(t('connect.common.connect'));
				this.connectButton?.setDisabled(connectedSuccessfully);
			}
		}
	}
}
