/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateState } from '../src/state/migrations';
import type { GameSyncData } from '../src/state/schema';
import type { ProviderConnectionStatus } from '../src/providers/provider';
import type { PreparedSync } from '../src/sync/service';
import type { CanonicalPreviewResult } from '../src/sync/canonical-service';
import { expectNoBodyHeadingMatchingModalTitle } from './ui-helpers';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
			createSpan: { value: () => { const child = decorate(document.createElement('span')); element.append(child); return child; } },
		});
		return element;
	}

	class Modal {
		app: unknown;
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		constructor(app: unknown) { this.app = app; this.contentEl = decorate(document.createElement('div')); this.titleEl = document.createElement('h2'); }
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
			this.settingEl = document.createElement('div'); this.nameEl = document.createElement('span'); this.descEl = decorate(document.createElement('span')); this.controlEl = document.createElement('div');
			this.settingEl.append(this.nameEl, this.descEl, this.controlEl); containerEl.append(this.settingEl);
		}
		setName(name: string): this { this.nameEl.textContent = name; return this; }
		setDesc(desc: string): this { this.descEl.textContent = desc; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const inputEl = document.createElement('input'); this.controlEl.append(inputEl);
			const component = { inputEl, setPlaceholder: (value: string) => { inputEl.placeholder = value; return component; }, onChange: (handler: (value: string) => unknown) => { inputEl.addEventListener('change', () => void handler(inputEl.value)); return component; } };
			callback(component); return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button'); this.controlEl.append(buttonEl);
			const component = { buttonEl, setButtonText: (value: string) => { buttonEl.textContent = value; return component; }, setCta: () => component, setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; }, onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; } };
			callback(component); return this;
		}
	}

	return { Modal, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { SetupModal } = await import('../src/ui/setup/setup-modal');

function connection(provider: 'steam' | 'playstation', state: ProviderConnectionStatus['state'] = 'connected'): ProviderConnectionStatus {
	return { provider, state, connected: state === 'connected', ...(state === 'connected' ? { account: { provider, displayName: 'voitech', accountId: `${provider}-account`, ...(provider === 'steam' ? { gameCount: 327 } : {}) } } : {}) };
}

function setupFixture(overrides: Partial<ConstructorParameters<typeof SetupModal>[1]> = {}) {
	let state = migrateState(undefined);
	const saved: GameSyncData[] = [];
	let resolvePrepare!: (value: PreparedSync) => void;
	const prepareAll = vi.fn<() => Promise<PreparedSync>>(() => new Promise<PreparedSync>((resolve) => { resolvePrepare = resolve; }));
	const options = {
		stateStore: { load: vi.fn(async () => state), save: vi.fn(async (next: GameSyncData) => { state = next; }) },
		save: vi.fn(async (next: GameSyncData) => { state = next; saved.push(next); }),
		openConnection: vi.fn(), disconnect: vi.fn(async () => undefined), confirm: vi.fn(async () => true),
		getConnectionStatus: vi.fn(async (provider: 'steam' | 'playstation') => connection(provider)), prepareAll, onPreparedSync: vi.fn(), ...overrides,
	};
	return { options, saved, getState: () => state, resolvePrepare: (value: PreparedSync) => resolvePrepare(value), modal: new SetupModal({} as never, options) };
}

function buttons(modal: InstanceType<typeof SetupModal>): HTMLButtonElement[] { return Array.from(modal.contentEl.querySelectorAll('button')); }
function buttonWithText(modal: InstanceType<typeof SetupModal>, text: string): HTMLButtonElement {
	const button = buttons(modal).find((candidate) => candidate.textContent === text);
	if (button === undefined) throw new Error(`Missing button ${text}`);
	return button;
}
async function openAndWait(modal: InstanceType<typeof SetupModal>): Promise<void> {
	modal.onOpen(); await vi.waitFor(() => expect(modal.contentEl.dataset.quickSetup).toBe('true'));
}

describe('Quick Setup', () => {
	beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); obsidianMock.getLanguage.mockReturnValue('en'); });

	it('renders one Game Sync title and only the four quick setup decisions', async () => {
		const fixture = setupFixture(); await openAndWait(fixture.modal);
		expect(fixture.modal.titleEl.textContent).toBe('Game Sync');
		expectNoBodyHeadingMatchingModalTitle(fixture.modal.contentEl, 'Game Sync');
		expect(fixture.modal.contentEl.textContent).toContain('Connect at least one account');
		expect(fixture.modal.contentEl.textContent).not.toMatch(/filename|template|property mapping|metadata|history|background/i);
		expect(fixture.modal.contentEl.querySelectorAll('[data-provider-setting]')).toHaveLength(2);
		expect(fixture.modal.contentEl.querySelector('[data-settings-field="notesFolder"]')).not.toBeNull();
	});

	it('has one disabled preview action until at least one provider is connected', async () => {
		const fixture = setupFixture({ getConnectionStatus: vi.fn(async (provider: 'steam' | 'playstation') => connection(provider, 'disconnected')) }); await openAndWait(fixture.modal);
		const preview = fixture.modal.contentEl.querySelector<HTMLButtonElement>('[data-quick-setup-preview]');
		expect(preview?.textContent).toBe('Preview first sync'); expect(preview?.disabled).toBe(true);
		expect(buttons(fixture.modal).filter((button) => button.textContent?.includes('Connect'))).toHaveLength(2);
	});

	it('shows connected account details and only reconnect/disconnect actions', async () => {
		const fixture = setupFixture(); await openAndWait(fixture.modal);
		const steam = fixture.modal.contentEl.querySelector<HTMLElement>('[data-provider-setting="steam"]')!;
		expect(steam.textContent).toContain('✓ Connected as voitech'); expect(steam.textContent).toContain('327 games found');
		expect(Array.from(steam.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['Reconnect', 'Disconnect']);
		expect(fixture.modal.contentEl.querySelector<HTMLButtonElement>('[data-quick-setup-preview]')?.disabled).toBe(false);
	});

	it('refreshes the provider card after the shared connect callback', async () => {
		const statuses = new Map([['steam', connection('steam', 'disconnected')], ['playstation', connection('playstation', 'disconnected')]]);
		const fixture = setupFixture({ getConnectionStatus: vi.fn(async (provider: 'steam' | 'playstation') => statuses.get(provider)!) }); await openAndWait(fixture.modal);
		buttonWithText(fixture.modal, 'Connect Steam').click();
		const callback = (fixture.options.openConnection as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (() => void) | undefined;
		expect(callback).toBeDefined(); statuses.set('steam', connection('steam')); callback?.();
		await vi.waitFor(() => expect(fixture.modal.contentEl.textContent).toContain('✓ Connected as voitech'));
	});

	it('uses a native folder setting with a useful placeholder', async () => {
		const fixture = setupFixture(); await openAndWait(fixture.modal);
		const input = fixture.modal.contentEl.querySelector<HTMLInputElement>('[data-settings-field="notesFolder"]')!;
		expect(input.placeholder).toBe('Games');
		input.value = 'My Games'; input.dispatchEvent(new Event('change'));
		fixture.modal.contentEl.querySelector<HTMLButtonElement>('[data-quick-setup-preview]')!.click();
		await vi.waitFor(() => expect(fixture.options.save).toHaveBeenCalled());
		expect(fixture.saved.at(-1)?.settings.notesFolder).toBe('My Games');
	});

	it('saves setup completion, prepares the preview, and prevents duplicate submission', async () => {
		const fixture = setupFixture(); await openAndWait(fixture.modal); const preview = fixture.modal.contentEl.querySelector<HTMLButtonElement>('[data-quick-setup-preview]')!;
		preview.click(); preview.click(); await vi.waitFor(() => expect(fixture.options.save).toHaveBeenCalledTimes(1));
		expect(fixture.getState().settings.setupCompleted).toBe(false); expect(fixture.options.prepareAll).toHaveBeenCalledOnce(); expect(preview.disabled).toBe(true);
		fixture.resolvePrepare({} as PreparedSync); await vi.waitFor(() => expect(fixture.options.onPreparedSync).toHaveBeenCalledWith({}));
	});

	it('shows a safe retry message when preview preparation fails', async () => {
		const fixture = setupFixture({ prepareAll: vi.fn(async () => { throw new Error('raw backend details'); }) }); await openAndWait(fixture.modal);
		buttonWithText(fixture.modal, 'Preview first sync').click(); await vi.waitFor(() => expect(fixture.modal.contentEl.textContent).toContain('first sync preview could not be prepared'));
		expect(fixture.modal.contentEl.textContent).not.toContain('raw backend details');
	});

	it('renders the same simple model in Polish', async () => {
		obsidianMock.getLanguage.mockReturnValue('pl'); const fixture = setupFixture(); await openAndWait(fixture.modal);
		expect(fixture.modal.titleEl.textContent).toBe('Game Sync'); expect(fixture.modal.contentEl.textContent).toContain('Połącz co najmniej jedno konto');
		expect(fixture.modal.contentEl.textContent).not.toContain('setup.welcome');
	});

	it('lets a new user explicitly choose ready GameTrack before previewing', async () => {
		const preview: CanonicalPreviewResult = {
			snapshot: { status: 'complete', games: [], diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 0, gamesNormalized: 0, diagnostics: [] } },
			plan: { id: 'plan', planRevision: 'revision', operations: [], statuses: [], games: [] },
		};
		const fixture = setupFixture({
			getGameTrackStatus: vi.fn(async () => ({ code: 'READY' as const, supported: true, database: 'found' as const, schema: 'supported' as const, games: 207, platforms: ['steam', 'playstation'] })),
			prepareGameTrack: vi.fn(async () => preview),
			onGameTrackPreview: vi.fn(),
		});
		await openAndWait(fixture.modal);
		await vi.waitFor(() => expect(fixture.modal.contentEl.querySelector('[data-provider-setting="gametrack"]')).not.toBeNull());
		buttonWithText(fixture.modal, 'Use GameTrack').click();
		await vi.waitFor(() => expect(fixture.getState().settings.libraryProvider).toBe('gametrack'));
		fixture.modal.contentEl.querySelector<HTMLButtonElement>('[data-quick-setup-preview]')!.click();
		await vi.waitFor(() => expect(fixture.options.prepareGameTrack).toHaveBeenCalledOnce());
		expect(fixture.options.onGameTrackPreview).toHaveBeenCalledWith(preview);
		expect(fixture.getState().settings.enabledProviders.steam).toBe(false);
	});

	it('offers the official export flow when GameTrack has not been selected yet', async () => {
		let ready = false;
		const fixture = setupFixture({
			getGameTrackStatus: vi.fn(async () => ready
				? { code: 'READY' as const, supported: true, database: 'found' as const, schema: 'supported' as const, games: 207, platforms: ['steam', 'playstation', 'xbox'] }
				: { code: 'EXPORT_NOT_SELECTED' as const, supported: true, database: 'unavailable' as const, schema: 'unknown' as const, games: 0, platforms: [] }),
			chooseGameTrackExport: vi.fn(async () => { ready = true; return { name: 'GameTrack_Export.zip', size: 42, modifiedAt: 100, path: '/tmp/GameTrack_Export.zip' }; }),
		});
		await openAndWait(fixture.modal);
		buttonWithText(fixture.modal, 'Choose export').click();
		await vi.waitFor(() => expect(fixture.getState().settings.libraryProvider).toBe('gametrack'));
		expect(fixture.getState().settings.gametrackExportName).toBe('GameTrack_Export.zip');
		expect(fixture.modal.contentEl.textContent).toContain('207 games');
	});
});
