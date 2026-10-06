import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import { GAME_SYNC_SECRET_NAMES, type SecretStore } from '../auth/secrets';
import { t } from '../i18n';
import type { ProviderAccount } from '../model/provider';
import { PlayStationAuthError, PlayStationNeedsAuthenticationError, createPlayStationAuth, preparePlayStationConnection } from '../providers/playstation/auth';
import type { PlayStationAuthOptions, PlayStationAuthService } from '../providers/playstation/types';
import { renderStatusMessage } from './status';

export const PLAYSTATION_URL = 'https://www.playstation.com/';
export const PLAYSTATION_NPSSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie';

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
	private statusEl?: HTMLElement;
	private doneButton?: HTMLButtonElement;
	private lifecycle = 0;
	private isOpen = false;

	constructor(app: App, private readonly options: PlayStationConnectModalOptions) {
		super(app);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.setTitle(t('connect.playstation.title'));
		this.contentEl.replaceChildren();

		const intro = this.contentEl.createEl('p');
		intro.textContent = t('connect.playstation.intro');
		const steps = this.contentEl.createEl('ol');
		const signInStep = steps.createEl('li');
		signInStep.append(document.createTextNode(t('connect.playstation.signInStep')));
		new Setting(signInStep).addButton((button) => {
			button.setButtonText(t('connect.playstation.openPlayStation')).onClick(() => this.options.openUrl(PLAYSTATION_URL));
		});
		const codeStep = steps.createEl('li');
		codeStep.append(document.createTextNode(t('connect.playstation.getCodeStep')));
		new Setting(codeStep).addButton((button) => {
			button.setButtonText(t('connect.playstation.openConnectionCode')).onClick(() => this.options.openUrl(PLAYSTATION_NPSSO_URL));
		});
		const pasteStep = steps.createEl('li');
		pasteStep.textContent = t('connect.playstation.pasteCodeStep');

		new Setting(this.contentEl)
			.setName(t('connect.playstation.connectionCode'))
			.setDesc(t('connect.playstation.connectionCodeDescription'))
			.addText((component) => {
				this.connectionCodeInput = component.inputEl;
				component.inputEl.type = 'password';
				component.setPlaceholder(t('connect.playstation.connectionCodePlaceholder'));
			});
		const note = this.contentEl.createEl('p');
		note.className = 'setting-item-description';
		note.textContent = t('connect.playstation.securityNote');
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
		if (this.connectionCodeInput !== undefined) this.connectionCodeInput.value = '';
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

	private showError(error: unknown): void {
		if (this.statusEl !== undefined) renderStatusMessage(this.statusEl, this.errorMessage(error));
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
		if (error instanceof PlayStationNeedsAuthenticationError) return t('connect.playstation.authRequired');
		if (error instanceof PlayStationAuthError) return t('connect.playstation.error');
		return t('connect.playstation.error');
	}

	private async connect(): Promise<void> {
		if (!this.isOpen || this.connectionCodeInput === undefined || this.doneButton !== undefined) return;
		const connectionCode = this.connectionCodeInput.value.trim();
		if (connectionCode.length === 0) {
			this.setStatus(t('connect.playstation.codeRequired'));
			return;
		}
		const version = ++this.lifecycle;
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
			await this.options.onConnected(connected);
			if (!this.isCurrent(version)) return;
			this.setStatus(t('connect.playstation.success', { displayName: connected.displayName }));
			connectedSuccessfully = true;
			this.showDone();
		} catch (error) {
			if (this.isCurrent(version)) this.showError(error);
		} finally {
			temporaryStore.delete(GAME_SYNC_SECRET_NAMES.psnRefreshToken);
			if (this.isCurrent(version)) {
				this.connectionCodeInput.value = '';
				this.connectButton?.setButtonText(t('connect.common.connect'));
				this.connectButton?.setDisabled(connectedSuccessfully);
			}
		}
	}
}
