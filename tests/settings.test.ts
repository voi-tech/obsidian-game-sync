/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameProvider, ProviderAccount } from '../src/model/provider';
import { DEFAULT_SETTINGS } from '../src/state/defaults';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
			createSpan: { value: () => { const child = decorate(document.createElement('span')); element.append(child); return child; } },
		});
		return element;
	}

	class PluginSettingTab {
		containerEl: HTMLElement;
		constructor(public readonly app: unknown, public readonly plugin: unknown) { this.containerEl = decorate(document.createElement('div')); }
	}

	class Setting {
		settingEl: HTMLElement;
		nameEl: HTMLElement;
		descEl: HTMLElement;
		controlEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement('div'); this.settingEl.className = 'setting-item';
			this.nameEl = document.createElement('div'); this.nameEl.className = 'setting-item-name';
			this.descEl = decorate(document.createElement('div')); this.descEl.className = 'setting-item-description';
			this.controlEl = document.createElement('div'); this.controlEl.className = 'setting-item-control';
			this.settingEl.append(this.nameEl, this.descEl, this.controlEl); containerEl.append(this.settingEl);
		}
		setName(value: string): this { this.nameEl.textContent = value; this.settingEl.dataset.settingName = value; return this; }
		setDesc(value: string): this { this.descEl.textContent = value; this.settingEl.dataset.settingDescription = value; return this; }
		setHeading(): this { this.settingEl.dataset.settingHeading = 'true'; return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setPlaceholder(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const inputEl = document.createElement('input'); this.controlEl.append(inputEl);
			const component = {
				inputEl,
				setPlaceholder: (value: string) => { inputEl.placeholder = value; return component; },
				onChange: (handler: (value: string) => unknown) => { inputEl.addEventListener('change', () => void handler(inputEl.value)); return component; },
			};
			callback(component); return this;
		}
		addToggle(callback: (component: { toggleEl: HTMLInputElement; setValue(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const toggleEl = document.createElement('input'); toggleEl.type = 'checkbox'; this.controlEl.append(toggleEl);
			const component = {
				toggleEl,
				setValue: (value: boolean) => { toggleEl.checked = value; return component; },
				onChange: (handler: (value: boolean) => unknown) => { toggleEl.addEventListener('change', () => void handler(toggleEl.checked)); return component; },
			};
			callback(component); return this;
		}
		addDropdown(callback: (component: { selectEl: HTMLSelectElement; addOption(value: string, label: string): unknown; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const selectEl = document.createElement('select'); this.controlEl.append(selectEl);
			const component = {
				selectEl,
				addOption: (value: string, label: string) => { const option = document.createElement('option'); option.value = value; option.textContent = label; selectEl.append(option); return component; },
				setValue: (value: string) => { selectEl.value = value; return component; },
				onChange: (handler: (value: string) => unknown) => { selectEl.addEventListener('change', () => void handler(selectEl.value)); return component; },
			};
			callback(component); return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; setDisabled(value: boolean): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button'); this.controlEl.append(buttonEl);
			const component = {
				buttonEl,
				setButtonText: (value: string) => { buttonEl.textContent = value; return component; },
				setCta: () => component,
				setDisabled: (value: boolean) => { buttonEl.disabled = value; return component; },
				onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; },
			};
			callback(component); return this;
		}
	}

	return { PluginSettingTab, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { GameSyncSettingsTab } = await import('../src/ui/settings/game-sync-settings');
import type { GameSyncSettingsHost } from '../src/ui/settings/game-sync-settings';

function makeHost() {
	const current = structuredClone(DEFAULT_SETTINGS);
	const statuses = new Map<GameProvider, { provider: GameProvider; state: 'connected' | 'disconnected'; connected: boolean; account?: ProviderAccount }>([
		['steam', { provider: 'steam', state: 'connected', connected: true, account: { provider: 'steam', accountId: 'steam-account', displayName: 'voitech' } }],
		['playstation', { provider: 'playstation', state: 'disconnected', connected: false }],
	]);
	return {
		readSettings: vi.fn(async () => structuredClone(current)),
		writeSettings: vi.fn(async (settings) => { Object.assign(current, structuredClone(settings)); }),
		readPropertyMapping: vi.fn(async () => ({})),
		writePropertyMapping: vi.fn(async () => undefined),
		getConnectionStatus: vi.fn(async (provider: GameProvider) => statuses.get(provider)! ),
		connect: vi.fn(async () => undefined),
		disconnect: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		openAdditionalSettings: vi.fn(),
		openIgnoredGames: vi.fn(),
		openMatchManager: vi.fn(),
		copyDiagnostics: vi.fn(),
		reset: vi.fn(),
	};
}

function display(tab: InstanceType<typeof GameSyncSettingsTab>): void {
	document.body.append(tab.containerEl);
	(tab as unknown as { display: () => void }).display();
}

describe('Game Sync settings', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('renders the compact main information architecture with one additional settings launcher', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;

		expect(Array.from(tab.containerEl.querySelectorAll<HTMLElement>('[data-game-sync-section]')).map((element) => element.dataset.gameSyncSection)).toEqual(['accounts', 'sync', 'notes', 'more']);
		expect(tab.containerEl.querySelectorAll('[data-settings-action="additional"]')).toHaveLength(1);
		expect(tab.containerEl.textContent).toContain('Open additional settings');
		expect(tab.containerEl.textContent).not.toContain('Property mappings');
		expect(tab.containerEl.textContent).not.toContain('Game information');
		expect(tab.containerEl.textContent).not.toContain('Diagnostics');
		expect(tab.containerEl.textContent).toContain('Game Sync 26.9.1');
		expect(tab.containerEl.textContent).not.toContain('Include unplayed games');
		expect(tab.containerEl.querySelectorAll('[data-settings-field="includeUnplayed"]').length).toBe(0);
		expect(tab.containerEl.querySelectorAll('[data-settings-field="recordHistory"]').length).toBe(0);
	});

	it('keeps synchronization to Sync all, background sync and its conditional interval', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;

		expect(tab.containerEl.querySelector('[data-settings-action="sync-all"]')).not.toBeNull();
		expect(tab.containerEl.querySelector('[data-settings-action="review-risky"]')).toBeNull();
		expect(tab.containerEl.querySelector('[data-settings-field="backgroundIntervalMinutes"]')).toBeNull();
		expect(tab.containerEl.querySelector('[data-settings-field="backgroundNotifications"]')).toBeNull();

		const background = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="backgroundSync"]')!;
		background.checked = true;
		background.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(tab.containerEl.querySelector('[data-settings-field="backgroundIntervalMinutes"]')).not.toBeNull());
	});

	it('keeps only the folder and optional template in Notes with useful copy', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;

		const folder = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="notesFolder"]')!;
		const template = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="templatePath"]')!;
		expect(folder.placeholder).toBe('Games');
		expect(folder.closest('.setting-item')?.getAttribute('data-setting-description')).toBe('Game Sync creates game notes in this folder.');
		expect(template.placeholder).toBe('Templates/game.md');
		expect(template.closest('.setting-item')?.getAttribute('data-setting-description')).toBe('Optional Markdown template used only when a new game note is created.');
		expect(tab.containerEl.querySelector('[data-settings-field="filenamePattern"]')).toBeNull();
		expect(tab.containerEl.querySelector('[data-template-key-catalog]')).not.toBeNull();
		expect(tab.containerEl.querySelector('[data-template-key="title"]')?.textContent).toContain('Example: Dead Space');
		expect(tab.containerEl.querySelector('[data-template-key="acquisitionType"]')?.textContent).toContain('Example: unknown');
		expect(tab.containerEl.querySelector('[data-template-key="platforms"]')?.textContent).toContain('Example: pc, playstation-5');
	});

	it('offers searchable folder and template matches from the current vault', async () => {
		const app = { vault: { getAllLoadedFiles: () => [
			{ path: 'Games', children: [] }, { path: 'Games/Library', children: [] },
			{ path: 'Templates/game.md', extension: 'md' }, { path: 'Templates/archive.tmpl', extension: 'tmpl' },
			{ path: 'Assets/cover.png', extension: 'png' },
		] } };
		const host = makeHost();
		const tab = new GameSyncSettingsTab(app as never, {} as never, host);
		display(tab); await tab.ready;
		const folder = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="notesFolder"]')!;
		const template = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="templatePath"]')!;
		expect(folder.getAttribute('list')).toMatch(/^game-sync-folder-suggestions-/);
		expect(template.getAttribute('list')).toMatch(/^game-sync-template-suggestions-/);
		expect(Array.from(tab.containerEl.querySelectorAll<HTMLOptionElement>('datalist[data-vault-path-suggestions="folder"] option')).map((option) => option.value)).toEqual(['Games', 'Games/Library']);
		expect(Array.from(tab.containerEl.querySelectorAll<HTMLOptionElement>('datalist[data-vault-path-suggestions="template"] option')).map((option) => option.value)).toEqual(['Templates/archive.tmpl', 'Templates/game.md']);
		folder.value = 'library'; folder.dispatchEvent(new Event('input'));
		expect(Array.from(tab.containerEl.querySelectorAll<HTMLOptionElement>('datalist[data-vault-path-suggestions="folder"] option')).map((option) => option.value)).toEqual(['Games/Library']);
		template.value = 'GAME'; template.dispatchEvent(new Event('input'));
		expect(Array.from(tab.containerEl.querySelectorAll<HTMLOptionElement>('datalist[data-vault-path-suggestions="template"] option')).map((option) => option.value)).toEqual(['Templates/game.md']);
	});

	it('uses native Setting rows for accounts and keeps the shared connection status', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		await vi.waitFor(() => expect(tab.containerEl.querySelector('[data-provider-status="steam"]')).not.toBeNull());

		expect(tab.containerEl.querySelector('[data-provider-status="steam"]')?.textContent).toContain('✓ Connected as voitech');
		expect(tab.containerEl.querySelector<HTMLButtonElement>('[data-provider-action="reconnect:steam"]')).not.toBeNull();
		tab.containerEl.querySelector<HTMLButtonElement>('[data-provider-action="disconnect:steam"]')!.click();
		expect(host.confirm).toHaveBeenCalledWith(expect.stringContaining('Markdown data remains'));
	});

	it('opens the additional settings launcher without rendering its controls in the main page', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		tab.containerEl.querySelector<HTMLButtonElement>('[data-settings-action="additional"]')!.click();

		expect(host.openAdditionalSettings).toHaveBeenCalledOnce();
		expect(host.openAdditionalSettings).toHaveBeenCalledWith();
		expect(tab.containerEl.querySelector('[data-property-destination]')).toBeNull();
	});

	it('shows the library source selector and recommends ready GameTrack', async () => {
		const host = makeHost();
		(host as unknown as { getGameTrackStatus: unknown }).getGameTrackStatus = vi.fn(async () => ({ code: 'READY' as const, supported: true, database: 'found' as const, schema: 'supported' as const, games: 207, platforms: ['steam'] }));
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		await vi.waitFor(() => expect(tab.containerEl.querySelector('[data-library-provider-setting]')).not.toBeNull());
		const select = tab.containerEl.querySelector<HTMLSelectElement>('[data-settings-field="libraryProvider"]')!;
		expect(select.textContent).toContain('GameTrack');
		select.value = 'gametrack'; select.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(host.writeSettings).toHaveBeenCalledWith(expect.objectContaining({ libraryProvider: 'gametrack' })));
	});

	it('does not expose GameTrack source when runtime reports unsupported status', async () => {
		const host = makeHost();
		(host as unknown as { getGameTrackStatus: unknown }).getGameTrackStatus = vi.fn(async () => ({ code: 'UNSUPPORTED_OS' as const, supported: false, database: 'unavailable' as const, schema: 'unknown' as const, games: 0, platforms: [] }));
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab); await tab.ready;
		await vi.waitFor(() => expect(tab.containerEl.querySelector('[data-gametrack-status]')).not.toBeNull());
		expect(tab.containerEl.querySelector<HTMLSelectElement>('[data-settings-field="libraryProvider"]')?.textContent).not.toContain('GameTrack');
	});

	it('lets the user choose a GameTrack ZIP without exposing SQLite settings', async () => {
		const host = {
			...makeHost(),
			getGameTrackStatus: vi.fn(async () => ({ code: 'EXPORT_NOT_SELECTED' as const, supported: true, database: 'unavailable' as const, schema: 'unknown' as const, games: 0, platforms: [], transport: 'csv-export' as const })),
			chooseGameTrackExport: vi.fn(async () => ({ name: 'GameTrack_Export.zip', size: 100, modifiedAt: 200, path: '/tmp/GameTrack_Export.zip' })),
		} satisfies GameSyncSettingsHost;
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab); await tab.ready;
		await vi.waitFor(() => expect(tab.containerEl.querySelector('[data-gametrack-export-setting]')).not.toBeNull());
		tab.containerEl.querySelector<HTMLButtonElement>('[data-settings-action="choose-gametrack-export"]')!.click();
		await vi.waitFor(() => expect(host.writeSettings).toHaveBeenCalledWith(expect.objectContaining({ libraryProvider: 'gametrack', gametrackExportName: 'GameTrack_Export.zip' })));
		expect(tab.containerEl.querySelector('[data-settings-field="gametrackDatabasePath"]')).toBeNull();
	});
});
