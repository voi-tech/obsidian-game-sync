/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../src/auth/secrets';
import { GAME_SYNC_SECRET_NAMES } from '../src/auth/secrets';
import type { ProviderAccount } from '../src/model/provider';
import { PlayStationAuthError, PlayStationNeedsAuthenticationError } from '../src/providers/playstation/auth';
import type { PlayStationAuthService } from '../src/providers/playstation/types';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement { Object.defineProperties(element, { createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } }, createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } } }); return element; }
	class Modal {
		app: unknown; contentEl: HTMLElement; titleEl: HTMLElement; modalEl = document.createElement('div');
		constructor(app: unknown) { this.app = app; this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); }
		setTitle(title: string): this { this.titleEl.textContent = title; return this; } close(): void { this.onClose(); } onOpen(): void {} onClose(): void {}
	}
	class Setting {
		settingEl: HTMLElement; nameEl: HTMLElement; descEl: HTMLElement; controlEl: HTMLElement;
		constructor(containerEl: HTMLElement) { this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item'; this.nameEl = document.createElement('span'); this.descEl = document.createElement('span'); this.descEl.className = 'setting-item-description'; this.controlEl = document.createElement('div'); this.settingEl.append(this.nameEl, this.descEl, this.controlEl); containerEl.append(this.settingEl); }
		setName(name: string): this { this.nameEl.textContent = name; return this; } setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown }) => unknown): this { const inputEl = document.createElement('input'); this.controlEl.append(inputEl); callback({ inputEl, setPlaceholder: (value) => { inputEl.placeholder = value; } }); return this; }
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this { const buttonEl = document.createElement('button'); this.controlEl.append(buttonEl); const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } }; callback(component); return this; }
	}
	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});
vi.mock('obsidian', () => obsidianMock);

const { PlayStationConnectModal, PLAYSTATION_NPSSO_URL, PLAYSTATION_URL } = await import('../src/ui/playstation-connect-modal');

function secretStore(): { store: SecretStore; values: Map<string, string>; set: ReturnType<typeof vi.fn> } { const values = new Map<string, string>(); const set = vi.fn((name: string, value: string) => void values.set(name, value)); return { values, set, store: { get: (name) => values.get(name) ?? null, set, delete: (name) => void values.delete(name) } }; }
function account(): ProviderAccount { return { provider: 'playstation', displayName: 'Console Player', accountId: 'account-1' }; }
function authThat(connectWithNpsso: PlayStationAuthService['connectWithNpsso']): PlayStationAuthService { return { connectWithNpsso, getAccessToken: async () => 'access-token', refresh: async () => undefined, disconnect: async () => undefined, getConnectionStatus: async () => ({ provider: 'playstation', state: 'disconnected', connected: false }), getAccount: () => undefined }; }
function connectButton(modal: InstanceType<typeof PlayStationConnectModal>): HTMLButtonElement { return Array.from(modal.contentEl.querySelectorAll('button')).find((button) => button.textContent === 'Connect')!; }

describe('PlayStationConnectModal', () => {
	beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); obsidianMock.getLanguage.mockReturnValue('en'); vi.stubGlobal('createEl', (tag: string) => document.createElement(tag)); });
	it('distinguishes authorized sessions from account-settings save failures', async () => {
		const persistent = secretStore();
		const save = vi.fn().mockRejectedValueOnce(new Error('Synthetic save failure')).mockResolvedValueOnce(undefined);
		const authFactory = vi.fn(({ secretStore: store }: { secretStore: SecretStore }) => authThat(async () => { store.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'fixture-refresh'); return account(); }));
		const modal = new PlayStationConnectModal({} as never, {
			secretStore: persistent.store, openUrl: vi.fn(),
			onConnected: save, authFactory,
		});
		modal.onOpen();
		modal.contentEl.querySelector('input')!.value = 'fixture-code';
		connectButton(modal).click();
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('could not save account settings'));
		expect(persistent.values.get(GAME_SYNC_SECRET_NAMES.psnRefreshToken)).toBe('fixture-refresh');
		expect(modal.contentEl.querySelector('[data-connect-done]')).not.toBeNull();
		const retry = modal.contentEl.querySelector<HTMLButtonElement>('[data-connect-retry-save]');
		expect(retry).not.toBeNull();
		retry!.click();
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Connected as'));
		expect(authFactory).toHaveBeenCalledOnce();
		modal.onClose();
	});

	it('offers browser sign-in first and keeps manual codes in collapsed advanced settings', () => {
		const modal = new PlayStationConnectModal({} as never, { secretStore: secretStore().store, openUrl: vi.fn(), onConnected: vi.fn() }); modal.onOpen();
		expect(modal.titleEl.textContent).toBe('Connect PlayStation'); expectNoBodyHeadingMatchingModalTitle(modal.contentEl, 'Connect PlayStation'); expect(modal.contentEl.textContent).toContain('Sign in to PlayStation.'); expect(modal.contentEl.textContent).toContain('Connection code'); expect(modal.contentEl.textContent).not.toContain('NPSSO');
		const input = modal.contentEl.querySelector('input')!;
		expect(input.getAttribute('placeholder')).toBe('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
		expect(input.closest('.setting-item')?.querySelector('.setting-item-description')?.textContent).toBe('Paste the connection code from PlayStation to create a reusable session.');
		const advanced = modal.contentEl.querySelector('details')!;
		expect(advanced).not.toBeNull();
		expect(advanced.open).toBe(false);
		expect(input.closest('details')).toBe(advanced);
		const signIn = Array.from(modal.contentEl.querySelectorAll('button')).find((button) => button.textContent === 'Sign in to PlayStation')!;
		expect(signIn.closest('details')).toBeNull();
		signIn.click();
		expect(modal.contentEl.querySelector('webview')).not.toBeNull();
		modal.onClose();
		expect(modal.contentEl.querySelector('webview')).toBeNull();
	});

	it('keeps the unofficial label small and opens the two official pages', () => {
		const urls: string[] = []; const modal = new PlayStationConnectModal({} as never, { secretStore: secretStore().store, openUrl: (url) => urls.push(url), onConnected: vi.fn() }); modal.onOpen();
		expect(modal.contentEl.textContent).not.toContain('Unofficial integration'); expect(modal.contentEl.textContent).not.toContain('NPSSO'); const buttons = Array.from(modal.contentEl.querySelector('details')!.querySelectorAll('button')); buttons[0].click(); buttons[1].click(); expect(urls).toEqual([PLAYSTATION_URL, PLAYSTATION_NPSSO_URL]);
	});

	it('uses one password-style code input and persists only the reusable session after success', async () => {
		const persistent = secretStore(); let temporaryStore: SecretStore | undefined; const createAuth = vi.fn((options: { secretStore: SecretStore }) => { temporaryStore = options.secretStore; return authThat(async () => { temporaryStore?.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token'); return account(); }); }); const onConnected = vi.fn();
		const modal = new PlayStationConnectModal({} as never, { secretStore: persistent.store, openUrl: vi.fn(), onConnected, authFactory: createAuth }); modal.onOpen(); const input = modal.contentEl.querySelector('input')!; expect(input.type).toBe('password'); input.value = 'connection-code'; connectButton(modal).click(); await vi.waitFor(() => expect(onConnected).toHaveBeenCalledOnce()); expect(persistent.set).toHaveBeenCalledWith(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'refresh-token'); expect(input.value).toBe(''); expect(modal.contentEl.textContent).toContain('✓ Connected as Console Player'); expect(modal.contentEl.querySelector('[data-connect-done]')).not.toBeNull();
	});

	it('shows a safe next action after failure and permits retry', async () => {
		const persistent = secretStore(); const createAuth = vi.fn().mockImplementationOnce(() => authThat(async () => { throw new PlayStationAuthError(); })).mockImplementationOnce((options: { secretStore: SecretStore }) => authThat(async () => { options.secretStore.set(GAME_SYNC_SECRET_NAMES.psnRefreshToken, 'retry-refresh-token'); return account(); })); const modal = new PlayStationConnectModal({} as never, { secretStore: persistent.store, openUrl: vi.fn(), onConnected: vi.fn(), authFactory: createAuth }); modal.onOpen(); const input = modal.contentEl.querySelector('input')!; input.value = 'connection-code'; connectButton(modal).click(); await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Sign in again')); expect(modal.contentEl.textContent).not.toContain('NPSSO'); expect(persistent.set).not.toHaveBeenCalled(); input.value = 'new-connection-code'; connectButton(modal).click(); await vi.waitFor(() => expect(modal.contentEl.querySelector('[data-connect-done]')).not.toBeNull());
	});

	it('explains an expired session without exposing implementation terms', async () => {
		const modal = new PlayStationConnectModal({} as never, { secretStore: secretStore().store, openUrl: vi.fn(), onConnected: vi.fn(), authFactory: () => authThat(async () => { throw new PlayStationNeedsAuthenticationError(); }) }); modal.onOpen(); modal.contentEl.querySelector('input')!.value = 'expired-code'; connectButton(modal).click(); await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('session has expired')); expect(modal.contentEl.textContent).toContain('Sign in again to reconnect'); expect(modal.contentEl.textContent).not.toContain('NPSSO');
	});

	it('ignores duplicate clicks during loading and late results after close', async () => {
		let resolveConnection!: (value: ProviderAccount) => void; const onConnected = vi.fn(); const modal = new PlayStationConnectModal({} as never, { secretStore: secretStore().store, openUrl: vi.fn(), onConnected, authFactory: () => authThat(() => new Promise((resolve) => { resolveConnection = resolve; })) }); modal.onOpen(); modal.contentEl.querySelector('input')!.value = 'code'; const button = connectButton(modal); button.click(); button.click(); await Promise.resolve(); expect(button.disabled).toBe(true); modal.onClose(); resolveConnection(account()); await Promise.resolve(); await Promise.resolve(); expect(onConnected).not.toHaveBeenCalled();
	});
});
