/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameProvider } from '../src/model/provider';
import { DEFAULT_SETTINGS } from '../src/state/defaults';

const obsidianMock = vi.hoisted(() => {
	function decorate(element: HTMLElement): HTMLElement {
		Object.defineProperties(element, {
			createEl: { value: (tag: string) => { const child = decorate(document.createElement(tag)); element.append(child); return child; } },
			createDiv: { value: () => { const child = decorate(document.createElement('div')); element.append(child); return child; } },
		});
		return element;
	}

	class PluginSettingTab {
		containerEl: HTMLElement;
		constructor(public readonly app: unknown, public readonly plugin: unknown) {
			this.containerEl = decorate(document.createElement('div'));
		}
	}

	class Setting {
		settingEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement('div');
			this.settingEl.className = 'setting-item';
			containerEl.append(this.settingEl);
		}
		setName(value: string): this {
			this.settingEl.dataset.settingName = value;
			return this;
		}
		setHeading(): this { return this; }
		setDesc(_value: string): this { return this; }
		addText(callback: (component: { inputEl: HTMLInputElement; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const inputEl = document.createElement('input');
			this.settingEl.append(inputEl);
			const component = {
				inputEl,
				setValue: (value: string) => { inputEl.value = value; return component; },
				onChange: (handler: (value: string) => unknown) => { inputEl.addEventListener('change', () => void handler(inputEl.value)); return component; },
			};
			callback(component);
			return this;
		}
		addToggle(callback: (component: { setValue(value: boolean): unknown; onChange(handler: (value: boolean) => unknown): unknown }) => unknown): this {
			const inputEl = document.createElement('input');
			inputEl.type = 'checkbox';
			this.settingEl.append(inputEl);
			const component = {
				toggleEl: inputEl,
				setValue: (value: boolean) => { inputEl.checked = value; return component; },
				onChange: (handler: (value: boolean) => unknown) => { inputEl.addEventListener('change', () => void handler(inputEl.checked)); return component; },
			};
			callback(component);
			return this;
		}
		addDropdown(callback: (component: { addOption(value: string, label: string): unknown; setValue(value: string): unknown; onChange(handler: (value: string) => unknown): unknown }) => unknown): this {
			const selectEl = document.createElement('select');
			this.settingEl.append(selectEl);
			const component = {
				addOption: (value: string, label: string) => { const option = document.createElement('option'); option.value = value; option.textContent = label; selectEl.append(option); return component; },
				setValue: (value: string) => { selectEl.value = value; return component; },
				onChange: (handler: (value: string) => unknown) => { selectEl.addEventListener('change', () => void handler(selectEl.value)); return component; },
			};
			callback(component);
			return this;
		}
		addButton(callback: (component: { buttonEl: HTMLButtonElement; setButtonText(value: string): unknown; setCta(): unknown; onClick(handler: () => unknown): unknown }) => unknown): this {
			const buttonEl = document.createElement('button');
			this.settingEl.append(buttonEl);
			const component = {
				buttonEl,
				setButtonText: (value: string) => { buttonEl.textContent = value; return component; },
				setCta: () => component,
				onClick: (handler: () => unknown) => { buttonEl.addEventListener('click', () => void handler()); return component; },
			};
			callback(component);
			return this;
		}
	}

	return { PluginSettingTab, Setting, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

const { GameSyncSettingsTab } = await import('../src/ui/settings/game-sync-settings');

function makeHost() {
	const statuses = new Map<GameProvider, { provider: GameProvider; state: 'connected' | 'disconnected'; connected: boolean }>([
		['steam', { provider: 'steam', state: 'connected', connected: true }],
		['playstation', { provider: 'playstation', state: 'disconnected', connected: false }],
	]);
	return {
		readSettings: vi.fn(async () => structuredClone(DEFAULT_SETTINGS)),
		writeSettings: vi.fn(async () => undefined),
		readPropertyMapping: vi.fn(async () => ({})),
		writePropertyMapping: vi.fn(async () => undefined),
		getConnectionStatus: vi.fn(async (provider: GameProvider) => statuses.get(provider)!),
		connect: vi.fn(async () => undefined),
		disconnect: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		openTemplate: vi.fn(),
		openTemplateKeys: vi.fn(),
	};
}

function display(tab: InstanceType<typeof GameSyncSettingsTab>): void {
	(tab as unknown as { display: () => void }).display();
}

describe('Game Sync settings', () => {
	beforeEach(() => {
		document.body.replaceChildren();
		obsidianMock.getLanguage.mockReturnValue('en');
	});

	it('renders exactly the requested sections in English and Polish', async () => {
		const expectedEnglish = ['Accounts', 'Sync', 'Library', 'Notes & templates', 'Properties', 'Achievements & trophies', 'History', 'Advanced', 'About'];
		const host = makeHost();
		const english = new GameSyncSettingsTab({} as never, {} as never, host);
		display(english);
		await english.ready;
		expect(Array.from(english.containerEl.querySelectorAll<HTMLElement>('[data-game-sync-section]')).map((element) => element.dataset.gameSyncSectionLabel)).toEqual(expectedEnglish);

		obsidianMock.getLanguage.mockReturnValue('pl');
		const polish = new GameSyncSettingsTab({} as never, {} as never, makeHost());
		display(polish);
		await polish.ready;
		expect(Array.from(polish.containerEl.querySelectorAll<HTMLElement>('[data-game-sync-section]')).map((element) => element.dataset.gameSyncSectionLabel)).toEqual([
			'Konta', 'Synchronizacja', 'Biblioteka', 'Notatki i szablony', 'Właściwości', 'Osiągnięcia i trofea', 'Historia', 'Zaawansowane', 'O programie',
		]);
	});

	it('saves an existing setting through the host adapter', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		const input = tab.containerEl.querySelector<HTMLInputElement>('[data-settings-field="notesFolder"]');
		expect(input).not.toBeNull();
		input!.value = 'My Games';
		input!.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(host.writeSettings).toHaveBeenCalled());
		const calls = host.writeSettings.mock.calls as unknown[][];
		const saved = calls.at(-1);
		expect(saved === undefined ? undefined : (saved[0] as { notesFolder?: string }).notesFolder).toBe('My Games');
	});

	it('renders safe provider status and delegates connect and disconnect actions', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		expect(host.getConnectionStatus).toHaveBeenCalledWith('steam');
		expect(tab.containerEl.querySelector('[data-provider-status="steam"]')?.textContent).toContain('Connected');
		tab.containerEl.querySelector<HTMLButtonElement>('[data-provider-action="connect:steam"]')!.click();
		await vi.waitFor(() => expect(host.connect).toHaveBeenCalledWith('steam'));

		tab.containerEl.querySelector<HTMLButtonElement>('[data-provider-action="disconnect:steam"]')!.click();
		expect(host.confirm).toHaveBeenCalledWith(expect.stringContaining('Markdown data remains'));
		expect(host.disconnect).not.toHaveBeenCalled();
		host.confirm.mockResolvedValueOnce(true);
		tab.containerEl.querySelector<HTMLButtonElement>('[data-provider-action="disconnect:steam"]')!.click();
		await vi.waitFor(() => expect(host.disconnect).toHaveBeenCalledWith('steam'));
	});

	it('does not expose credentials or secret-like controls in the DOM', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		const text = tab.containerEl.textContent?.toLowerCase() ?? '';
		expect(text).not.toMatch(/api key|npsso|refresh token|password|secret|credential/);
		expect(tab.containerEl.querySelector('input[type="password"]')).toBeNull();
	});

	it('maps, disables and re-enables a logical property without mixing template keys', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		const destination = tab.containerEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')!;
		destination.value = 'game-title';
		destination.dispatchEvent(new Event('input'));
		await vi.waitFor(() => expect(host.writePropertyMapping).toHaveBeenCalledWith(expect.objectContaining({ title: 'game-title' })));
		const enabled = tab.containerEl.querySelector<HTMLInputElement>('[data-property-enabled="title"]')!;
		enabled.checked = false;
		enabled.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(host.writePropertyMapping).toHaveBeenCalledWith(expect.objectContaining({ title: null })));
		enabled.checked = true;
		enabled.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(host.writePropertyMapping).toHaveBeenCalledWith(expect.objectContaining({ title: 'game-title' })));
		expect(tab.containerEl.querySelector('[data-property-destination="steamId"]')).toBeTruthy();
		expect(tab.containerEl.querySelector('[data-template-key="title"]')).toBeNull();
	});

	it('blocks invalid property mapping writes after full resolved-map validation', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		display(tab);
		await tab.ready;
		const destination = tab.containerEl.querySelector<HTMLInputElement>('[data-property-destination="title"]')!;
		destination.value = 'type';
		destination.dispatchEvent(new Event('input'));
		await Promise.resolve();
		expect(host.writePropertyMapping).not.toHaveBeenCalled();
		expect(tab.containerEl.textContent).toMatch(/duplicate|duplikat/i);
	});
});
