/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';
import type { ProviderAccount } from '../src/model/provider';
import { SteamInvalidApiKeyError, SteamPrivateGameDetailsError } from '../src/providers/steam/auth';
import type { SteamAuthService } from '../src/providers/steam/types';

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
		setTitle(title: string): this {
			this.titleEl.textContent = title;
			return this;
		}
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
			const component = { inputEl, setPlaceholder: (value: string) => { inputEl.placeholder = value; return undefined; } };
			callback(component);
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

const { SteamConnectModal } = await import('../src/ui/steam-connect-modal');

function secretStore(initial: string | null = null): { store: SecretStore; values: Map<string, string>; set: ReturnType<typeof vi.fn> } {
	const values = new Map<string, string>();
	if (initial !== null) values.set(GAME_SYNC_SECRET_NAMES.steamApiKey, initial);
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
	return { provider: 'steam', displayName: 'Test Player', accountId: '76561198000000001', gameCount: 12 };
}

function authThat(resolver: () => Promise<ProviderAccount>): SteamAuthService {
	return {
		resolveSteamId64: async () => '76561198000000001',
		testConnection: resolver,
		getConnectionStatus: async () => ({ provider: 'steam', state: 'disconnected', connected: false }),
		disconnect: async () => undefined,
	};
}

describe('SteamConnectModal', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		vi.clearAllMocks();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('renders text and password inputs and passes a profile URL to the existing auth abstraction', async () => {
		const secrets = secretStore();
		const onConnected = vi.fn();
		const createAuth = vi.fn(() => authThat(async () => account()));
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secrets.store, createAuth, onConnected });
		modal.onOpen();

		const inputs = Array.from(modal.contentEl.querySelectorAll('input'));
		expect(inputs.map((input) => input.type)).toEqual(['text', 'password']);
		inputs[0].value = 'https://steamcommunity.com/id/test-player/';
		inputs[1].value = 'steam-api-key';
		modal.contentEl.querySelector('button')?.click();
		await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
		expect(createAuth).toHaveBeenCalledWith(expect.objectContaining({ account: 'https://steamcommunity.com/id/test-player/' }));
	});

	it('saves the API key only after a successful test and shows public account details', async () => {
		const secrets = secretStore();
		let resolveConnection!: (value: ProviderAccount) => void;
		const createAuth = vi.fn(() => authThat(() => new Promise((resolve) => { resolveConnection = resolve; })));
		const onConnected = vi.fn();
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secrets.store, createAuth, onConnected });
		modal.onOpen();
		const inputs = Array.from(modal.contentEl.querySelectorAll('input'));
		inputs[0].value = '76561198000000001';
		inputs[1].value = 'steam-api-key';
		modal.contentEl.querySelector('button')?.click();
		await Promise.resolve();
		expect(secrets.set).not.toHaveBeenCalled();

		resolveConnection(account());
		await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
		expect(secrets.set).toHaveBeenCalledWith(GAME_SYNC_SECRET_NAMES.steamApiKey, 'steam-api-key');
		expect(modal.contentEl.textContent).toContain('Test Player');
		expect(modal.contentEl.textContent).toContain('76561198000000001');
		expect(modal.contentEl.textContent).toContain('12');
		expect(inputs[1].value).toBe('');
		expect(onConnected).toHaveBeenCalledWith(account());
	});

	it('shows safe, distinct errors and allows retry without exposing the key', async () => {
		const secrets = secretStore();
		const createAuth = vi.fn()
			.mockReturnValueOnce(authThat(async () => { throw new SteamInvalidApiKeyError(); }))
			.mockReturnValueOnce(authThat(async () => account()));
		const onConnected = vi.fn();
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secrets.store, createAuth, onConnected });
		modal.onOpen();
		const inputs = Array.from(modal.contentEl.querySelectorAll('input'));
		inputs[0].value = '76561198000000001';
		inputs[1].value = 'secret-steam-key';
		modal.contentEl.querySelector('button')?.click();
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('API key'));
		expect(modal.contentEl.textContent).not.toContain('secret-steam-key');
		expect(secrets.set).not.toHaveBeenCalled();
		inputs[1].value = 'secret-steam-key';
		modal.contentEl.querySelector('button')?.click();
		await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));

		const privateModal = new SteamConnectModal({} as never, {
			http: {} as never,
			secretStore: secretStore().store,
			createAuth: () => authThat(async () => { throw new SteamPrivateGameDetailsError(); }),
			onConnected: vi.fn(),
		});
		privateModal.onOpen();
		const privateInputs = Array.from(privateModal.contentEl.querySelectorAll('input'));
		privateInputs[0].value = '76561198000000001';
		privateInputs[1].value = 'private-key';
		privateModal.contentEl.querySelector('button')?.click();
		await vi.waitFor(() => expect(privateModal.contentEl.textContent).toContain('Game Details'));
	});

	it('ignores a late result after close and does not persist or notify', async () => {
		const secrets = secretStore();
		let resolveConnection!: (value: ProviderAccount) => void;
		const onConnected = vi.fn();
		const modal = new SteamConnectModal({} as never, {
			http: {} as never,
			secretStore: secrets.store,
			createAuth: () => authThat(() => new Promise((resolve) => { resolveConnection = resolve; })),
			onConnected,
		});
		modal.onOpen();
		const inputs = Array.from(modal.contentEl.querySelectorAll('input'));
		inputs[0].value = '76561198000000001';
		inputs[1].value = 'late-secret';
		modal.contentEl.querySelector('button')?.click();
		modal.onClose();
		resolveConnection(account());
		await Promise.resolve();
		await Promise.resolve();
		expect(onConnected).not.toHaveBeenCalled();
		expect(secrets.set).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain('late-secret');
	});
});
