/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import type { GameProvider, ProviderAccount } from '../src/model/provider';
import { DEFAULT_SETTINGS } from '../src/state/defaults';

const obsidianMock = vi.hoisted(() => {
	class PluginSettingTab {
		containerEl = document.createElement('div');
		update = vi.fn<() => void>();
		refreshDomState = vi.fn<() => void>();
		constructor(public readonly app: unknown, public readonly plugin: unknown) {}
	}
	const notices: string[] = [];
	class Notice { constructor(message: string) { notices.push(message); } }
	return { PluginSettingTab, Notice, notices, getLanguage: vi.fn(() => 'en') };
});

vi.mock('obsidian', () => obsidianMock);

(globalThis as unknown as Record<string, unknown>).createFragment = (callback: (fragment: unknown) => void) => {
	const fragment = document.createDocumentFragment();
	Object.assign(fragment, {
		createEl: (tag: string, options: { text?: string; href?: string } = {}) => {
			const element = document.createElement(tag);
			if (options.text !== undefined) element.textContent = options.text;
			if (options.href !== undefined) element.setAttribute('href', options.href);
			fragment.append(element);
			return element;
		},
		appendText: (text: string) => { fragment.append(document.createTextNode(text)); },
	});
	callback(fragment);
	return fragment;
};

const { GameSyncSettingsTab } = await import('../src/ui/settings/game-sync-settings');
type Host = ConstructorParameters<typeof GameSyncSettingsTab>[2];

function makeHost(overrides: Partial<Host> = {}) {
	const current = structuredClone(DEFAULT_SETTINGS);
	let mapping = {};
	const statuses = new Map<GameProvider, { provider: GameProvider; state: 'connected' | 'disconnected'; connected: boolean; account?: ProviderAccount }>([
		['steam', { provider: 'steam', state: 'connected', connected: true, account: { provider: 'steam', accountId: 'steam-account', displayName: 'voitech' } }],
		['playstation', { provider: 'playstation', state: 'disconnected', connected: false }],
	]);
	return {
		current,
		readSettings: vi.fn(async () => structuredClone(current)),
		writeSettings: vi.fn(async (settings: typeof current) => { Object.assign(current, structuredClone(settings)); }),
		readPropertyMapping: vi.fn(async () => structuredClone(mapping)),
		writePropertyMapping: vi.fn(async (next: object) => { mapping = structuredClone(next); }),
		getConnectionStatus: vi.fn(async (provider: GameProvider) => statuses.get(provider)!),
		connect: vi.fn(async () => undefined),
		disconnect: vi.fn(async () => undefined),
		syncNow: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		openIgnoredGames: vi.fn(),
		openMatchManager: vi.fn(),
		copyDiagnostics: vi.fn(),
		...overrides,
	};
}

async function loadedTab(host = makeHost()) {
	const tab = new GameSyncSettingsTab({} as never, { manifest: { version: '26.10.3' } } as never, host);
	await tab.refresh();
	return { tab, host };
}

function isGroup(item: SettingDefinitionItem): item is SettingDefinitionGroup {
	return 'type' in item && (item.type === 'group' || item.type === 'list');
}

function isPage(item: SettingDefinitionItem): item is SettingDefinitionPage {
	return 'type' in item && item.type === 'page';
}

function groupByHeading(items: SettingDefinitionItem[], heading: string): SettingDefinitionGroup {
	const group = items.filter(isGroup).find((candidate) => candidate.heading === heading);
	if (group === undefined) throw new Error(`Missing group ${heading}`);
	return group;
}

function byName(items: readonly SettingDefinitionItem[] | undefined, name: string): SettingDefinitionItem {
	const item = (items ?? []).find((candidate) => 'name' in candidate && candidate.name === name);
	if (item === undefined) throw new Error(`Missing item ${name}`);
	return item;
}

function controlKeys(items: readonly SettingDefinitionItem[] | undefined): string[] {
	return (items ?? []).flatMap((item) => isGroup(item) || isPage(item) ? controlKeys(item.items) : 'control' in item && item.control !== undefined ? [item.control.key] : []);
}

function visible(item: SettingDefinitionItem): boolean {
	const value = (item as SettingDefinition).visible;
	return typeof value === 'function' ? value() : value !== false;
}

function fakeSetting() {
	const settingEl = document.createElement('div');
	const descEl = Object.assign(document.createElement('div'), {
		createSpan(): HTMLSpanElement { const span = document.createElement('span'); descEl.append(span); return span; },
	});
	const buttons: { text: string; el: HTMLButtonElement; click?: () => unknown }[] = [];
	const setting = {
		settingEl,
		descEl,
		setDesc(value: string) { descEl.textContent = value; return setting; },
		addButton(callback: (button: unknown) => void) {
			const entry: { text: string; el: HTMLButtonElement; click?: () => unknown } = { text: '', el: document.createElement('button') };
			const button = {
				buttonEl: entry.el,
				setButtonText(text: string) { entry.text = text; return button; },
				setCta() { return button; },
				onClick(handler: () => unknown) { entry.click = handler; return button; },
			};
			callback(button);
			buttons.push(entry);
			return setting;
		},
	};
	return { setting, buttons };
}

describe('Game Sync settings tab (Obsidian 1.13 declarative API)', () => {
	beforeEach(() => {
		obsidianMock.getLanguage.mockReturnValue('en');
		obsidianMock.notices.length = 0;
	});

	it('shows a loading row before state arrives, then renders native groups in order', async () => {
		const host = makeHost();
		const tab = new GameSyncSettingsTab({} as never, {} as never, host);
		expect(tab.getSettingDefinitions()).toEqual([{ type: 'group', items: [{ name: 'Loading Game Sync settings…' }] }]);
		await tab.refresh();
		expect(vi.mocked(tab).update.mock.calls.length).toBeGreaterThan(0);
		const headings = tab.getSettingDefinitions().filter(isGroup).map((group) => group.heading);
		expect(headings).toEqual(['Accounts', 'Sync', 'Notes', 'More settings', undefined]);
	});

	it('uses native controls and moves advanced options into native sub-pages', async () => {
		const { tab } = await loadedTab();
		const items = tab.getSettingDefinitions();
		const notes = groupByHeading(items, 'Notes');
		expect(byName(notes.items, 'Game notes folder')).toMatchObject({ control: { type: 'folder', key: 'notesFolder' } });
		expect(byName(notes.items, 'Template')).toMatchObject({ control: { type: 'file', key: 'templatePath' } });
		const more = groupByHeading(items, 'More settings');
		expect((more.items ?? []).filter(isPage).map((page) => page.name)).toEqual(['Library filters', 'Note properties', 'Game information', 'Additional data', 'Game history']);
		expect(controlKeys(more.items)).toEqual(expect.arrayContaining(['includeUnplayed', 'metadataLanguage', 'steamEnricherEnabled', 'recordHistory', 'historyPath', 'property:title']));
		expect(controlKeys(groupByHeading(items, 'Accounts').items)).toEqual([]);
	});

	it('persists a change on top of freshly read settings so external changes are kept', async () => {
		const { tab, host } = await loadedTab();
		host.current.enabledProviders.playstation = true;
		await tab.setControlValue('includeDemosTrials', true);
		expect(host.writeSettings).toHaveBeenLastCalledWith(expect.objectContaining({ includeDemosTrials: true, enabledProviders: { steam: false, playstation: true } }));
		expect(tab.getControlValue('includeDemosTrials')).toBe(true);
		expect(vi.mocked(tab).refreshDomState.mock.calls.length).toBeGreaterThan(0);
	});

	it('shows the background interval only when background sync is enabled and accepts only supported intervals', async () => {
		const { tab, host } = await loadedTab();
		const interval = byName(groupByHeading(tab.getSettingDefinitions(), 'Sync').items, 'Background sync interval');
		expect(visible(interval)).toBe(false);
		await tab.setControlValue('backgroundSync', true);
		expect(visible(interval)).toBe(true);
		await tab.setControlValue('backgroundIntervalMinutes', '60');
		expect(host.current.backgroundIntervalMinutes).toBe(60);
		await tab.setControlValue('backgroundIntervalMinutes', '7');
		expect(host.current.backgroundIntervalMinutes).toBe(60);
	});

	it('validates required paths with native inline errors', async () => {
		const { tab } = await loadedTab();
		const folder = byName(groupByHeading(tab.getSettingDefinitions(), 'Notes').items, 'Game notes folder') as SettingDefinition & { control: { validate: (value: string) => unknown } };
		expect(folder.control.validate('  ')).toBe('This field cannot be empty.');
		expect(folder.control.validate('Games')).toBeUndefined();
	});

	it('renders account rows with connection status and guarded disconnect', async () => {
		const { tab, host } = await loadedTab();
		const steam = byName(groupByHeading(tab.getSettingDefinitions(), 'Accounts').items, 'Steam') as SettingDefinition & { render: (setting: unknown) => void };
		const { setting, buttons } = fakeSetting();
		steam.render(setting);
		expect(setting.descEl.textContent).toContain('✓ Connected as voitech');
		expect(buttons.map((button) => button.text)).toEqual(['Reconnect', 'Disconnect']);
		await buttons[1].click?.();
		await vi.waitFor(() => expect(host.confirm).toHaveBeenCalledWith(expect.stringContaining('Markdown data remains')));
		expect(host.disconnect).not.toHaveBeenCalled();
	});

	it('routes property mapping controls through validation and saves the mapping', async () => {
		const { tab, host } = await loadedTab();
		expect(tab.getControlValue('property:title')).toBe('title');
		await tab.setControlValue('property:title', 'name');
		expect(host.writePropertyMapping).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'name' }));
		await tab.setControlValue('property:title', '');
		expect(tab.getControlValue('property:title')).toBe('');
		expect(host.writeSettings).not.toHaveBeenCalled();
	});

	it('offers the GameTrack source only when supported and stores the chosen export', async () => {
		const host = makeHost({
			getGameTrackStatus: vi.fn(async () => ({ code: 'READY' as const, supported: true, database: 'found' as const, schema: 'supported' as const, games: 207, platforms: ['steam'] })),
			chooseGameTrackExport: vi.fn(async () => ({ name: 'GameTrack_Export.zip', size: 100, modifiedAt: 200, path: '/tmp/GameTrack_Export.zip' })),
		});
		const { tab } = await loadedTab(host);
		const library = groupByHeading(tab.getSettingDefinitions(), 'Library');
		expect(byName(library.items, 'Library source')).toMatchObject({ control: { type: 'dropdown', options: { direct: 'Steam + PlayStation accounts', gametrack: 'GameTrack' } } });
		const exportRow = byName(library.items, 'GameTrack export') as SettingDefinition & { render: (setting: unknown) => void };
		expect(visible(exportRow)).toBe(false);
		await tab.setControlValue('libraryProvider', 'gametrack');
		expect(visible(exportRow)).toBe(true);
		const { setting, buttons } = fakeSetting();
		exportRow.render(setting);
		await buttons[0].click?.();
		await vi.waitFor(() => expect(host.writeSettings).toHaveBeenLastCalledWith(expect.objectContaining({ libraryProvider: 'gametrack', gametrackExportName: 'GameTrack_Export.zip' })));

		const unsupported = await loadedTab(makeHost({ getGameTrackStatus: vi.fn(async () => ({ code: 'UNSUPPORTED_OS' as const, supported: false, database: 'unavailable' as const, schema: 'unknown' as const, games: 0, platforms: [] })) }));
		const source = byName(groupByHeading(unsupported.tab.getSettingDefinitions(), 'Library').items, 'Library source') as SettingDefinition & { control: { options: Record<string, string> } };
		expect(Object.keys(source.control.options)).toEqual(['direct']);
	});

	it('exposes management tools as native rows', async () => {
		const { tab, host } = await loadedTab();
		const more = groupByHeading(tab.getSettingDefinitions(), 'More settings');
		(byName(more.items, 'Ignored games') as SettingDefinition & { action: () => void }).action();
		(byName(more.items, 'Game matches') as SettingDefinition & { action: () => void }).action();
		expect(host.openIgnoredGames).toHaveBeenCalledOnce();
		expect(host.openMatchManager).toHaveBeenCalledOnce();
	});
});
