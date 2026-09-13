/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';
import type { ProviderAccount } from '../src/model/provider';
import { PlayStationAuthError } from '../src/providers/playstation/auth';
import type { PlayStationAuthService } from '../src/providers/playstation/types';

const obsidianMock = vi.hoisted(() => {
	class Modal {
		app: unknown;
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		constructor(app: unknown) {
			this.app = app;
			this.contentEl = document.createElement('div');
			Object.defineProperty(this.contentEl, 'createEl', { value: (tag: string): HTMLElement => {
				const element = document.createElement(tag);
				this.contentEl.append(element);
				return element;
			} });
			this.titleEl = document.createElement('h2');
		}
		setTitle(title: string): this { this.titleEl.textContent = title; return this; }
		close(): void { this.onClose(); }
		onOpen(): void {}
		onClose(): void {}
	}

	class Setting {
		settingEl: HTMLElement;
		nameEl: HTMLElement;
		descEl: HTMLElement;
		controlEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement('div');
			this.nameEl = document.createElement('span');
			this.descEl = document.createElement('span');
			this.controlEl = document.createElement('div');
			this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
			containerEl.append(this.settingEl);
		}
		setName(name: string): this { this.nameEl.textContent = name; return this; }
		setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown }) => unknown): this {
			const inputEl = document.createElement('input');
			this.controlEl.append(inputEl);
			callback({ inputEl, setPlaceholder: (value) => { inputEl.placeholder = value; return undefined; } });
			return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button');
			this.controlEl.append(buttonEl);
			const component = {
				buttonEl,
				setButtonText: (value: string) => { buttonEl.textContent = value; return component; },
				setCta: () => component,
				setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; },
				onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; },
			};
			callback(component);
			return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { PlayStationConnectModal, PLAYSTATION_NPSSO_URL, PLAYSTATION_URL } = await import('../src/ui/playstation-connect-modal');

function secretStore(): { store: SecretStore; values: Map<string, string>; set: ReturnType<typeof vi.fn> } {
	const values = new Map<string, string>();
	const set = vi.fn((name: string, value: string) => void values.set(name, value));
	return {
		values,
		set,
		store: {
			get: (name) => values.get(name) ?? null,
			set,
			delete: (name) => void values.delete(name),
		},
	};
}

function account(): ProviderAccount {
	return { provider: 'playstation', displayName: 'Console Player', accountId: 'account-1' };
}

function authThat(connectWithNpsso: PlayStationAuthService['connectWithNpsso']): PlayStationAuthService {
	return {
		connectWithNpsso,
		getAccessToken: async () => 'access-token',
		refresh: async () => undefined,
		disconnect: async () => undefined,
		getConnectionStatus: async () => ({ provider: 'playstation', state: 'disconnected', connected: false }),
		getAccount: () => undefined,
	};
}

describe('PlayStationConnectModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		vi.clearAllMocks();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('shows persistent warnings in English and Polish and opens the exact official URLs', () => {
		const urls: string[] = [];
		const makeModal = () => new PlayStationConnectModal({} as never, { secretStore: secretStore().store, openUrl: (url) => urls.push(url), onConnected: vi.fn(), authFactory: () => authThat(async () => account()) });
		const english = makeModal();
		english.onOpen();
		expect(english.contentEl.textContent).toContain('Unofficial integration');
		expect(english.contentEl.textContent).toContain('NPSSO');
		const buttons = Array.from(english.contentEl.querySelectorAll('button'));
		buttons[0].click();
		buttons[1].click();
		expect(urls).toEqual([PLAYSTATION_URL, PLAYSTATION_NPSSO_URL]);

		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('pl');
		const polish = makeModal();
		polish.onOpen();
		expect(polish.contentEl.textContent).toContain('Nieoficjalna integracja');
		expect(polish.contentEl.textContent).toContain('NPSSO');
	});

	it('uses a password input and persists only the refresh token after successful connection', async () => {
		const persistent = secretStore();
		let temporaryStore: SecretStore | undefined;
		const createAuth = vi.fn((options: { secretStore: SecretStore }) => {
			temporaryStore = options.secretStore;
			return authThat(async () => {
				temporaryStore?.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token');
				return account();
			});
		});
		const onConnected = vi.fn();
		const modal = new PlayStationConnectModal({} as never, { secretStore: persistent.store, openUrl: vi.fn(), onConnected, authFactory: createAuth });
		modal.onOpen();
		const input = modal.contentEl.querySelector('input');
		expect(input?.type).toBe('password');
		if (input === null) throw new Error('NPSSO input missing');
		input.value = 'N'.repeat(64);
		Array.from(modal.contentEl.querySelectorAll('button')).at(-1)?.click();
		await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
		expect(persistent.set).toHaveBeenCalledWith(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token');
		expect(onConnected).toHaveBeenCalledWith(account());
		expect(input.value).toBe('');
		expect(modal.contentEl.textContent).toContain('Console Player');
	});

	it('does not persist NPSSO or refresh secrets on failure and permits retry', async () => {
		const persistent = secretStore();
		const createAuth = vi.fn()
			.mockImplementationOnce(() => authThat(async () => { throw new PlayStationAuthError(); }))
			.mockImplementationOnce((options: { secretStore: SecretStore }) => authThat(async () => {
				options.secretStore.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'retry-refresh-token');
				return account();
			}));
		const onConnected = vi.fn();
		const modal = new PlayStationConnectModal({} as never, { secretStore: persistent.store, openUrl: vi.fn(), onConnected, authFactory: createAuth });
		modal.onOpen();
		const input = modal.contentEl.querySelector('input');
		if (input === null) throw new Error('NPSSO input missing');
		input.value = 'N'.repeat(64);
		Array.from(modal.contentEl.querySelectorAll('button')).at(-1)?.click();
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('connection failed'));
		expect(modal.contentEl.textContent).not.toContain('N'.repeat(64));
		expect(persistent.set).not.toHaveBeenCalled();
		input.value = 'N'.repeat(63) + 'X';
		Array.from(modal.contentEl.querySelectorAll('button')).at(-1)?.click();
		await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
		expect(persistent.set).toHaveBeenCalledWith(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'retry-refresh-token');
	});

	it('ignores a late result after close and never exposes the NPSSO', async () => {
		const persistent = secretStore();
		let resolveConnection!: (value: ProviderAccount) => void;
		const onConnected = vi.fn();
		const modal = new PlayStationConnectModal({} as never, {
			secretStore: persistent.store,
			openUrl: vi.fn(),
			onConnected,
			authFactory: () => authThat(() => new Promise((resolve) => { resolveConnection = resolve; })),
		});
		modal.onOpen();
		const input = modal.contentEl.querySelector('input');
		if (input === null) throw new Error('NPSSO input missing');
		const npsso = 'N'.repeat(64);
		input.value = npsso;
		Array.from(modal.contentEl.querySelectorAll('button')).at(-1)?.click();
		modal.onClose();
		resolveConnection(account());
		await Promise.resolve();
		await Promise.resolve();
		expect(onConnected).not.toHaveBeenCalled();
		expect(persistent.set).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain(npsso);
	});
});
