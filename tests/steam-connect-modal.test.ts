/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';
import type { ProviderAccount } from '../src/model/provider';
import { ProviderHttpError, ProviderNetworkError, ProviderRateLimitError, ProviderSchemaError } from '../src/network/errors';
import { SteamInvalidApiKeyError, SteamPrivateGameDetailsError } from '../src/providers/steam/auth';
import type { SteamAuthService } from '../src/providers/steam/types';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
		});
		return element;
	}
	class Modal {
		app: unknown; contentEl: HTMLElement; titleEl: HTMLElement;
		constructor(app: unknown) { this.app = app; this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); }
		setTitle(title: string): this { this.titleEl.textContent = title; return this; }
		close(): void { this.onClose(); }
		onOpen(): void {} onClose(): void {}
	}
	class Setting {
		settingEl: HTMLElement; nameEl: HTMLElement; descEl: HTMLElement; controlEl: HTMLElement;
		constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; this.nameEl = document.createElement('span'); this.descEl = document.createElement('span'); this.descEl.className = 'setting-item-description'; this.controlEl = document.createElement('div'); this.settingEl.append(this.nameEl, this.descEl, this.controlEl); containerEl.append(this.settingEl); }
		setName(name: string): this { this.nameEl.textContent = name; return this; }
		setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown }) => unknown): this { const inputEl = document.createElement('input'); this.controlEl.append(inputEl); callback({ inputEl, setPlaceholder: (value) => { inputEl.placeholder = value; } }); return this; }
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button'); this.controlEl.append(buttonEl);
			const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } };
			callback(component); return this;
		}
	}
	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});
vi.mock('obsidian', () => obsidianMock);

const { SteamConnectModal, STEAM_API_KEY_URL, STEAM_PRIVACY_URL } = await import('../src/ui/steam-connect-modal');

function secretStore(initial: string | null = null): { store: SecretStore; values: Map<string, string>; set: ReturnType<typeof vi.fn> } {
	const values = new Map<string, string>(); if (initial !== null) values.set(GAME_SYNC_SECRET_NAMES.steamApiKey, initial);
	const set = vi.fn((name: string, value: string) => void values.set(name, value));
	return { values, set, store: { get: (name) => values.get(name) ?? null, set, delete: (name) => void values.delete(name) } };
}
function account(): ProviderAccount { return { provider: 'steam', displayName: 'Test Player', accountId: '76561198000000001', gameCount: 12 }; }
function authThat(resolver: () => Promise<ProviderAccount>): SteamAuthService { return { resolveSteamId64: async () => '76561198000000001', testConnection: resolver, getConnectionStatus: async () => ({ provider: 'steam', state: 'disconnected', connected: false }), disconnect: async () => undefined }; }
function inputs(modal: InstanceType<typeof SteamConnectModal>): HTMLInputElement[] { return Array.from(modal.contentEl.querySelectorAll('input')); }
function connectButton(modal: InstanceType<typeof SteamConnectModal>): HTMLButtonElement { return Array.from(modal.contentEl.querySelectorAll('button')).find((button) => button.textContent === 'Connect')!; }

describe('SteamConnectModal', () => {
	beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('renders one human-facing form without a duplicate heading or implementation language', () => {
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, onConnected: vi.fn() }); modal.onOpen();
		expect(modal.titleEl.textContent).toBe('Connect Steam'); expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Connect Steam');
		expect(modal.contentEl.textContent).toContain('Game Sync needs access to your Steam library.'); expect(modal.contentEl.textContent).toContain('SteamID64');
		const inputs = modal.contentEl.querySelectorAll('input');
		expect(inputs[0].getAttribute('placeholder')).toBe('0123456789ABCDEF...');
		expect(inputs[1].getAttribute('placeholder')).toBe('https://steamcommunity.com/id/voitech');
		expect(inputs[0].closest('.setting-item')?.querySelector('.setting-item-description')?.textContent).toBe('Paste the Steam Web API key generated for your account.');
		expect(inputs[1].closest('.setting-item')?.querySelector('.setting-item-description')?.textContent).toBe('Enter your Steam profile URL, profile name or SteamID64.');
		expect(Array.from(modal.contentEl.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Get API key', 'Connect']);
	});

	it('accepts a profile URL and passes it to the existing auth abstraction', async () => {
		const createAuth = vi.fn(() => authThat(async () => account())); const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, createAuth, onConnected: vi.fn() }); modal.onOpen();
		const values = inputs(modal); values[0].value = 'steam-api-key'; values[1].value = 'https://steamcommunity.com/id/test-player/'; connectButton(modal).click();
		await vi.waitFor(() => expect(createAuth).toHaveBeenCalled()); expect(createAuth).toHaveBeenCalledWith(expect.objectContaining({ account: 'https://steamcommunity.com/id/test-player/' }));
	});

	it('prefills the saved profile, opens the official key page, and reuses a saved key when blank', async () => {
		const secrets = secretStore('saved-steam-key'); const urls: string[] = []; let authOptions: { account: string; secretStore: SecretStore } | undefined;
		const createAuth = vi.fn((options: { account: string; secretStore: SecretStore }) => { authOptions = options; return authThat(async () => account()); });
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secrets.store, account: '76561198000000009', openUrl: (url) => urls.push(url), createAuth, onConnected: vi.fn() }); modal.onOpen();
		const values = inputs(modal); expect(values[1].value).toBe('76561198000000009'); Array.from(modal.contentEl.querySelectorAll('button'))[0].click(); expect(urls).toEqual([STEAM_API_KEY_URL]);
		connectButton(modal).click(); await vi.waitFor(() => expect(createAuth).toHaveBeenCalledOnce()); expect(authOptions?.account).toBe('76561198000000009'); expect(authOptions?.secretStore.get(GAME_SYNC_SECRET_NAMES.steamApiKey)).toBe('saved-steam-key'); expect(secrets.set).not.toHaveBeenCalled();
	});

	it('persists the entered key only after success and shows a clear account result', async () => {
		const secrets = secretStore(); let resolveConnection!: (value: ProviderAccount) => void; const onConnected = vi.fn();
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secrets.store, createAuth: vi.fn(() => authThat(() => new Promise((resolve) => { resolveConnection = resolve; }))), onConnected }); modal.onOpen();
		const values = inputs(modal); values[0].value = 'steam-api-key'; values[1].value = '76561198000000001'; const button = connectButton(modal); button.click(); await Promise.resolve(); expect(secrets.set).not.toHaveBeenCalled(); expect(button.disabled).toBe(true);
		resolveConnection(account()); await vi.waitFor(() => expect(onConnected).toHaveBeenCalledOnce()); expect(secrets.set).toHaveBeenCalledWith(GAME_SYNC_SECRET_NAMES.steamApiKey, 'steam-api-key'); expect(modal.contentEl.textContent).toContain('✓ Connected as Test Player'); expect(modal.contentEl.textContent).toContain('12 games found'); expect(modal.contentEl.textContent).not.toContain('76561198000000001'); expect(modal.contentEl.querySelector('[data-connect-done]')).not.toBeNull();
	});

	it('gives invalid-key and private-library errors a next action', async () => {
		const invalidUrls: string[] = []; const invalid = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, openUrl: (url) => invalidUrls.push(url), createAuth: () => authThat(async () => { throw new SteamInvalidApiKeyError(); }), onConnected: vi.fn() }); invalid.onOpen(); const invalidInputs = inputs(invalid); invalidInputs[0].value = 'bad-key'; invalidInputs[1].value = 'profile'; connectButton(invalid).click(); await vi.waitFor(() => expect(invalid.contentEl.textContent).toContain('Generate a new Steam Web API key')); expect(invalid.contentEl.querySelectorAll('button').item(2).textContent).toBe('Get API key'); invalid.contentEl.querySelectorAll('button').item(2).click(); expect(invalidUrls).toEqual([STEAM_API_KEY_URL]);
		const privateUrls: string[] = []; const privateModal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, openUrl: (url) => privateUrls.push(url), createAuth: () => authThat(async () => { throw new SteamPrivateGameDetailsError(); }), onConnected: vi.fn() }); privateModal.onOpen(); const privateInputs = inputs(privateModal); privateInputs[0].value = 'key'; privateInputs[1].value = 'profile'; connectButton(privateModal).click(); await vi.waitFor(() => expect(privateModal.contentEl.textContent).toContain('Game details')); expect(privateModal.contentEl.querySelectorAll('button').item(2).textContent).toBe('Open Steam privacy settings'); privateModal.contentEl.querySelectorAll('button').item(2).click(); expect(privateUrls).toEqual([STEAM_PRIVACY_URL]);
	});

	it('maps technical failures to safe next-action messages', async () => {
		const cases = [[new ProviderNetworkError('raw'), 'check your connection'], [new ProviderRateLimitError('raw'), 'Wait a moment'], [new ProviderHttpError('raw', 502), 'Try again later'], [new ProviderSchemaError('raw'), 'Try again later']] as const;
		for (const [error, safeText] of cases) { const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, createAuth: () => authThat(async () => { throw error; }), onConnected: vi.fn() }); modal.onOpen(); const values = inputs(modal); values[0].value = 'key'; values[1].value = 'profile'; connectButton(modal).click(); await vi.waitFor(() => expect(modal.contentEl.textContent?.toLowerCase()).toContain(safeText.toLowerCase()), { timeout: 5000 }); expect(modal.contentEl.textContent).not.toContain('raw'); }
	});

	it('ignores duplicate clicks during loading and late results after close', async () => {
		let resolveConnection!: (value: ProviderAccount) => void; const onConnected = vi.fn(); const createAuth = vi.fn(() => authThat(() => new Promise((resolve) => { resolveConnection = resolve; })));
		const modal = new SteamConnectModal({} as never, { http: {} as never, secretStore: secretStore().store, createAuth, onConnected }); modal.onOpen(); const values = inputs(modal); values[0].value = 'key'; values[1].value = 'profile'; const button = connectButton(modal); button.click(); button.click(); await Promise.resolve(); expect(createAuth).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true); modal.onClose(); resolveConnection(account()); await Promise.resolve(); await Promise.resolve(); expect(onConnected).not.toHaveBeenCalled();
	});
});
