import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, type SecretStore } from '../auth/secrets';
import { t } from '../i18n';
import type { ProviderAccount } from '../model/provider';
import { PlayStationAuthError, createPlayStationAuth } from '../providers/playstation/auth';
import type { PlayStationAuthOptions, PlayStationAuthService } from '../providers/playstation/types';

export const PLAYSTATION_URL = 'https://www.playstation.com/';
export const PLAYSTATION_NPSSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie';

export type PlayStationAuthFactory = (options: PlayStationAuthOptions) => PlayStationAuthService;

export interface PlayStationConnectModalOptions {
	secretStore: SecretStore;
	openUrl: (url: string) => void;
	onConnected: (account: ProviderAccount) => void | Promise<void>;
	createAuth?: PlayStationAuthFactory;
	authFactory?: PlayStationAuthFactory;
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
	return { provider: account.provider, displayName: account.displayName, accountId: account.accountId };
}

export class PlayStationConnectModal extends Modal {
	private npssoInput?: HTMLInputElement;
	private connectButton?: ButtonComponent;
	private statusEl?: HTMLElement;
	private lifecycle = 0;
	private isOpen = false;

	constructor(app: App, private readonly options: PlayStationConnectModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.setTitle(t('connect.playstation.title'));
		this.contentEl.replaceChildren();
		new Setting(this.contentEl)
			.setName(t('connect.playstation.unofficial'))
			.setDesc(t('connect.playstation.npssoWarning'));
		new Setting(this.contentEl)
			.setName(t('connect.playstation.npsso'))
			.setDesc(t('connect.playstation.npssoDescription'))
			.addText((component) => {
				this.npssoInput = component.inputEl;
				component.inputEl.type = 'password';
			});
		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText(t('connect.playstation.openPlayStation')).onClick(() => this.options.openUrl(PLAYSTATION_URL));
		});
		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText(t('connect.playstation.openNpsso')).onClick(() => this.options.openUrl(PLAYSTATION_NPSSO_URL));
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
		if (this.npssoInput !== undefined) this.npssoInput.value = '';
		this.connectButton?.setDisabled(true);
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) this.statusEl.textContent = message;
	}

	private async connect(): Promise<void> {
		if (!this.isOpen || this.npssoInput === undefined) return;
		const npsso = this.npssoInput.value.trim();
		if (npsso.length === 0) {
			this.setStatus(t('connect.playstation.error'));
			return;
		}
		const version = ++this.lifecycle;
		const temporaryStore = createMemorySecretStore();
		this.connectButton?.setDisabled(true);
		this.setStatus('');
		try {
			const factory = this.options.createAuth ?? this.options.authFactory ?? createPlayStationAuth;
			const auth = factory({ secretStore: temporaryStore });
			const connected = publicAccount(await auth.connectWithNpsso(npsso));
			if (!this.isCurrent(version)) return;
			const refreshToken = temporaryStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (refreshToken === null) throw new PlayStationAuthError();
			this.options.secretStore.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, refreshToken);
			await this.options.onConnected(connected);
			if (!this.isCurrent(version)) return;
			this.setStatus(t('connect.playstation.success', { displayName: connected.displayName }));
		} catch {
			if (this.isCurrent(version)) this.setStatus(t('connect.playstation.error'));
		} finally {
			temporaryStore.delete(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (this.isCurrent(version)) {
				this.npssoInput.value = '';
				this.connectButton?.setDisabled(false);
			}
		}
	}
}
