import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, type SecretStore } from '../auth/secrets';
import { t } from '../i18n';
import type { ProviderAccount } from '../model/provider';
import { SteamAccountInputError, SteamInvalidApiKeyError, SteamPrivateGameDetailsError, createSteamAuth } from '../providers/steam/auth';
import type { SteamAuthOptions, SteamAuthService } from '../providers/steam/types';
import type { HttpClient } from '../network/http';

export type SteamAuthFactory = (options: SteamAuthOptions) => SteamAuthService;

export interface SteamConnectModalOptions {
	http: HttpClient;
	secretStore: SecretStore;
	onConnected: (account: ProviderAccount) => void | Promise<void>;
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

export class SteamConnectModal extends Modal {
	private accountInput?: HTMLInputElement;
	private apiKeyInput?: HTMLInputElement;
	private connectButton?: ButtonComponent;
	private statusEl?: HTMLElement;
	private lifecycle = 0;
	private isOpen = false;

	constructor(app: App, private readonly options: SteamConnectModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.setTitle(t('connect.steam.title'));
		this.contentEl.replaceChildren();

		new Setting(this.contentEl)
			.setName(t('connect.steam.account'))
			.setDesc(t('connect.steam.accountDescription'))
			.addText((component) => {
				this.accountInput = component.inputEl;
				component.inputEl.type = 'text';
				component.setPlaceholder('76561198000000000');
			});
		new Setting(this.contentEl)
			.setName(t('connect.steam.apiKey'))
			.setDesc(t('connect.steam.apiKeyDescription'))
			.addText((component) => {
				this.apiKeyInput = component.inputEl;
				component.inputEl.type = 'password';
			});
		this.statusEl = this.contentEl.createEl('p');
		this.statusEl.className = 'game-sync-connect-status';
		this.contentEl.append(this.statusEl);
		new Setting(this.contentEl).addButton((button) => {
			this.connectButton = button.setButtonText(t('connect.common.connect')).setCta();
			this.connectButton.onClick(() => void this.connect());
		});
	}

	override onClose(): void {
		this.isOpen = false;
		this.lifecycle += 1;
		if (this.accountInput !== undefined) this.accountInput.value = '';
		if (this.apiKeyInput !== undefined) this.apiKeyInput.value = '';
		this.connectButton?.setDisabled(true);
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private errorMessage(error: unknown): string {
		if (error instanceof SteamInvalidApiKeyError) return t('connect.steam.errors.invalidApiKey');
		if (error instanceof SteamPrivateGameDetailsError) return t('connect.steam.errors.privateGameDetails');
		if (error instanceof SteamAccountInputError) return t('connect.steam.errors.invalidAccount');
		return t('connect.steam.errors.connectionFailed');
	}

	private async connect(): Promise<void> {
		if (!this.isOpen || this.accountInput === undefined || this.apiKeyInput === undefined) return;
		const account = this.accountInput.value.trim();
		const enteredApiKey = this.apiKeyInput.value.trim();
		const apiKey = enteredApiKey || this.options.secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey) || '';
		if (account.length === 0) {
			this.setStatus(t('connect.steam.errors.accountRequired'));
			return;
		}
		if (apiKey.length === 0) {
			this.setStatus(t('connect.steam.errors.apiKeyRequired'));
			return;
		}

		const version = ++this.lifecycle;
		const temporaryStore = createMemorySecretStore();
		temporaryStore.set(GAME_SYNC_SECRET_NAMES.steamApiKey, apiKey);
		this.connectButton?.setDisabled(true);
		this.setStatus('');
		try {
			const factory = this.options.createAuth ?? this.options.authFactory ?? createSteamAuth;
			const auth = factory({
				http: this.options.http,
				secretStore: temporaryStore,
				account,
				apiKeySecretName: GAME_SYNC_SECRET_NAMES.steamApiKey,
			});
			const connected = publicAccount(await auth.testConnection());
			if (!this.isCurrent(version)) return;
			if (enteredApiKey.length > 0) this.options.secretStore.set(GAME_SYNC_SECRET_NAMES.steamApiKey, enteredApiKey);
			await this.options.onConnected(connected);
			if (!this.isCurrent(version)) return;
			const count = connected.gameCount === undefined ? '' : ` ${t('connect.steam.gameCount', { count: connected.gameCount })}`;
			this.setStatus(`${t('connect.steam.success', { displayName: connected.displayName, steamId64: connected.accountId })}${count}`);
		} catch (error) {
			if (this.isCurrent(version)) this.setStatus(this.errorMessage(error));
		} finally {
			temporaryStore.delete(GAME_SYNC_SECRET_NAMES.steamApiKey);
			if (this.isCurrent(version)) {
				this.apiKeyInput.value = '';
				this.connectButton?.setDisabled(false);
			}
		}
	}
}
