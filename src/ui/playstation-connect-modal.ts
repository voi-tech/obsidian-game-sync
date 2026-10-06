import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, type SecretStore } from '../auth/secrets';
import { t } from '../i18n';
import type { ProviderAccount } from '../model/provider';
import { PlayStationAuthError, PlayStationNeedsAuthenticationError, createPlayStationAuth, preparePlayStationConnection } from '../providers/playstation/auth';
import type { PlayStationAuthOptions, PlayStationAuthService } from '../providers/playstation/types';
import { renderStatusMessage } from './status';
import { PlayStationBrowserSession, PLAYSTATION_LOGIN_URL, PLAYSTATION_SESSION_URL } from './playstation-browser-session';

export const PLAYSTATION_URL = PLAYSTATION_LOGIN_URL;
export const PLAYSTATION_NPSSO_URL = PLAYSTATION_SESSION_URL;

export type PlayStationAuthFactory = (options: PlayStationAuthOptions) => PlayStationAuthService;

export interface PlayStationConnectModalOptions {
	secretStore: SecretStore;
	openUrl: (url: string) => void;
	readClipboard?: () => Promise<string>;
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
	private connectionCodeInput?: HTMLInputElement;
	private connectButton?: ButtonComponent;
	private signInButton?: ButtonComponent;
	private statusEl?: HTMLElement;
	private doneButton?: HTMLButtonElement;
	private browser?: PlayStationBrowserSession;
	private browserContainer?: HTMLElement;
	private lifecycle = 0;
	private isOpen = false;
	private busy = false;
	private pendingSave?: { account: ProviderAccount; refreshToken: string };
	private retrySaveButton?: ButtonComponent;

	constructor(app: App, private readonly options: PlayStationConnectModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.busy = false;
		this.setTitle(t('connect.playstation.title'));
		this.modalEl.classList.add('game-sync-playstation-modal');
		this.contentEl.replaceChildren();
		this.contentEl.createEl('p').textContent = t('connect.playstation.intro');
		this.contentEl.createEl('p').textContent = t('connect.playstation.browserInstructions');
		new Setting(this.contentEl).addButton((button) => {
			this.signInButton = button.setButtonText(t('connect.playstation.openPlayStation')).setCta();
			button.onClick(() => this.startBrowser());
		});
		this.browserContainer = this.contentEl.createDiv();
		this.browserContainer.hidden = true;
		const privacy = this.contentEl.createEl('p');
		privacy.className = 'setting-item-description';
		privacy.textContent = t('connect.playstation.browserPrivacy');
		this.renderManualConnection();
		this.statusEl = this.contentEl.createDiv();
		this.statusEl.className = 'game-sync-connect-status';
		this.statusEl.setAttribute('aria-live', 'polite');
	}

	private renderManualConnection(): void {
		const advanced = this.contentEl.createEl('details');
		advanced.createEl('summary').textContent = t('connect.playstation.manualConnection');
		const steps = advanced.createEl('ol');
		const signInStep = steps.createEl('li');
		signInStep.append(document.createTextNode(t('connect.playstation.signInStep')));
		new Setting(signInStep).addButton((button) => {
			button.setButtonText(t('connect.playstation.openWebsite')).onClick(() => this.options.openUrl(PLAYSTATION_URL));
		});
		const codeStep = steps.createEl('li');
		codeStep.append(document.createTextNode(t('connect.playstation.getCodeStep')));
		new Setting(codeStep).addButton((button) => {
			button.setButtonText(t('connect.playstation.openConnectionCode')).onClick(() => this.options.openUrl(PLAYSTATION_NPSSO_URL));
		});
		steps.createEl('li').textContent = t('connect.playstation.pasteCodeStep');
		new Setting(advanced)
			.setName(t('connect.playstation.connectionCode'))
			.setDesc(t('connect.playstation.connectionCodeDescription'))
			.addText((component) => {
				this.connectionCodeInput = component.inputEl;
				component.inputEl.type = 'password';
				component.setPlaceholder(t('connect.playstation.connectionCodePlaceholder'));
			});
		const note = advanced.createEl('p');
		note.className = 'setting-item-description';
		note.textContent = t('connect.playstation.securityNote');
		new Setting(advanced).addButton((button) => {
			this.connectButton = button.setButtonText(t('connect.common.connect')).setCta();
			button.onClick(() => void this.connect());
		});
	}

	override onClose(): void {
		this.isOpen = false;
		this.pendingSave = undefined;
		this.retrySaveButton?.setDisabled(true);
		this.retrySaveButton = undefined;
		this.lifecycle += 1;
		this.browser?.dispose();
		this.browser = undefined;
		if (this.connectionCodeInput !== undefined) this.connectionCodeInput.value = '';
		this.signInButton?.setDisabled(true);
		this.connectButton?.setDisabled(true);
		this.doneButton?.remove();
		this.doneButton = undefined;
	}

	private isCurrent(version: number): boolean {
		return this.isOpen && this.lifecycle === version;
	}

	private startBrowser(): void {
		if (!this.isOpen || this.busy || this.doneButton !== undefined || this.browserContainer === undefined) return;
		const version = ++this.lifecycle;
		this.browser?.dispose();
		this.browserContainer.replaceChildren();
		this.browserContainer.hidden = false;
		this.browser = new PlayStationBrowserSession(this.browserContainer, {
			onToken: async (token) => { if (this.isCurrent(version)) await this.connect(token); },
			onError: () => { if (this.isCurrent(version)) this.setStatus(t('connect.playstation.browserUnavailable')); },
		});
		this.browser.start();
		new Setting(this.browserContainer).addButton((button) => {
			button.setButtonText(t('connect.playstation.finishConnection')).setCta();
			button.onClick(() => this.browser?.finish());
		});
		this.setStatus(t('connect.playstation.browserInstructions'));
	}

	private setStatus(message: string): void {
		if (this.statusEl !== undefined) {
			this.statusEl.replaceChildren();
			this.statusEl.textContent = message;
		}
	}

	private showError(error: unknown): void {
		if (this.statusEl !== undefined) renderStatusMessage(this.statusEl, this.errorMessage(error));
	}

	private showDone(): void {
		if (this.doneButton !== undefined) return;
		new Setting(this.contentEl).addButton((button) => {
			this.doneButton = button.buttonEl;
			button.setButtonText(t('connect.common.done'));
			button.buttonEl.dataset.connectDone = 'true';
			button.onClick(() => this.close());
		});
	}

	private showRetrySave(): void {
		if (this.retrySaveButton !== undefined) return;
		new Setting(this.contentEl).addButton((button) => {
			this.retrySaveButton = button.setButtonText(t('connect.playstation.retrySettings'));
			button.buttonEl.dataset.connectRetrySave = 'true';
			button.onClick(() => void this.retrySave());
		});
	}

	private async retrySave(): Promise<void> {
		const pending = this.pendingSave;
		if (!this.isOpen || this.busy || pending === undefined) return;
		if (this.options.secretStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken) !== pending.refreshToken) {
			this.pendingSave = undefined;
			this.retrySaveButton?.setDisabled(true);
			this.setStatus(t('connect.playstation.authRequired'));
			return;
		}
		const version = ++this.lifecycle;
		this.busy = true;
		this.retrySaveButton?.setDisabled(true);
		try {
			await this.options.onConnected(pending.account);
			if (!this.isCurrent(version)) return;
			this.pendingSave = undefined;
			this.setStatus(t('connect.playstation.success', { displayName: pending.account.displayName }));
		} catch {
			if (this.isCurrent(version)) this.setStatus(t('connect.playstation.settingsFailed'));
		} finally {
			if (this.isCurrent(version)) {
				this.busy = false;
				this.retrySaveButton?.setDisabled(this.pendingSave === undefined);
			}
		}
	}

	private errorMessage(error: unknown): string {
		if (error instanceof PlayStationNeedsAuthenticationError) return t('connect.playstation.authRequired');
		return t('connect.playstation.error');
	}

	private async connect(browserToken?: string): Promise<void> {
		if (!this.isOpen || this.busy || this.connectionCodeInput === undefined || this.doneButton !== undefined) return;
		const connectionCode = browserToken ?? this.connectionCodeInput.value.trim();
		if (connectionCode.length === 0) {
			this.setStatus(t('connect.playstation.codeRequired'));
			return;
		}
		const version = ++this.lifecycle;
		this.busy = true;
		this.browser?.dispose();
		this.browser = undefined;
		if (this.browserContainer !== undefined) this.browserContainer.hidden = true;
		this.signInButton?.setDisabled(true);
		const commitSession = preparePlayStationConnection(this.options.secretStore);
		const temporaryStore = createMemorySecretStore();
		this.connectButton?.setDisabled(true);
		this.connectButton?.setButtonText(t('connect.playstation.connecting'));
		this.setStatus(t('connect.playstation.connecting'));
		let connectedSuccessfully = false;
		try {
			const factory = this.options.createAuth ?? this.options.authFactory ?? createPlayStationAuth;
			const auth = factory({ secretStore: temporaryStore });
			const connected = publicAccount(await auth.connectWithNpsso(connectionCode));
			if (!this.isCurrent(version)) return;
			const refreshToken = temporaryStore.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (refreshToken === null) throw new PlayStationAuthError();
			commitSession(refreshToken);
			// Commit is the cancellation boundary. Do not restore an older credential
			// after a settings callback has started or another adapter has used this one.
			connectedSuccessfully = true;
			this.pendingSave = { account: connected, refreshToken };
			await this.options.onConnected(connected);
			if (!this.isCurrent(version)) return;
			this.pendingSave = undefined;
			this.setStatus(t('connect.playstation.success', { displayName: connected.displayName }));
			this.showDone();
		} catch (error) {
			if (this.isCurrent(version)) {
				if (connectedSuccessfully) {
					this.setStatus(t('connect.playstation.settingsFailed'));
					this.showDone();
					this.showRetrySave();
				} else this.showError(error);
			}
		} finally {
			temporaryStore.delete(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (this.isCurrent(version)) {
				this.busy = false;
				this.connectionCodeInput.value = '';
				this.connectButton?.setButtonText(t('connect.common.connect'));
				this.connectButton?.setDisabled(connectedSuccessfully);
				this.signInButton?.setDisabled(connectedSuccessfully);
			}
		}
	}
}
