/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderNetworkError } from '../src/network/errors';

const notices = vi.hoisted(() => [] as string[]);
const mainTestMocks = vi.hoisted(() => ({
	steamAdapterFactory: vi.fn(),
	playStationAdapterFactory: vi.fn(),
	steamModal: vi.fn(),
	playStationModal: vi.fn(),
	setupOptions: undefined as { openConnection: (provider: 'steam' | 'playstation') => void } | undefined,
}));

vi.mock('../src/providers/steam/adapter', () => ({ createSteamAdapter: mainTestMocks.steamAdapterFactory }));
vi.mock('../src/providers/playstation/adapter', () => ({ createPlayStationAdapter: mainTestMocks.playStationAdapterFactory }));
vi.mock('../src/ui/steam-connect-modal', () => ({
	SteamConnectModal: class {
		constructor(_app: unknown, options: unknown) { mainTestMocks.steamModal(options); }
		open(): void {}
	},
}));
vi.mock('../src/ui/playstation-connect-modal', () => ({
	PlayStationConnectModal: class {
		constructor(_app: unknown, options: unknown) { mainTestMocks.playStationModal(options); }
		open(): void {}
	},
}));
vi.mock('../src/ui/setup/setup-modal', () => ({
	SetupModal: class {
		constructor(_app: unknown, options: { openConnection: (provider: 'steam' | 'playstation') => void }) { mainTestMocks.setupOptions = options; }
		open(): void {}
	},
}));

vi.mock('obsidian', () => ({
	Modal: class {
		contentEl = {};

		constructor(public readonly app: unknown) {}

		open(): void {}
	},
	PluginSettingTab: class {
		containerEl = {};

		constructor(public readonly app: unknown, public readonly plugin: unknown) {}
	},
	Setting: class {
		constructor(public readonly containerEl: unknown) {}
	},
	Plugin: class {
		app: unknown;
		manifest = { version: '26.9.0' };

		constructor(app: unknown) {
			this.app = app;
		}
	},
	Notice: class {
		constructor(message: string) {
			notices.push(message);
		}
	},
	Platform: { isMobile: false },
	apiVersion: '1.0.0',
	getLanguage: () => 'en',
}));

import { createGameSyncRuntime, createStaticCommandErrorNotifier } from '../src/main';

function createHost(rawState: unknown, secrets: Record<string, string> = {}) {
	const commands: Array<{ id: string; name: string; callback: () => void }> = [];
	const settingTabs: unknown[] = [];
	const registeredIntervals: number[] = [];
	const host = {
		app: {
			vault: {
				getAbstractFileByPath: () => null,
				getMarkdownFiles: () => [],
			},
			fileManager: {},
			secretStorage: {
				getSecret: (name: string) => secrets[name] ?? null,
				setSecret: vi.fn(),
			},
			workspace: { openLinkText: vi.fn() },
		} as unknown as import('obsidian').App,
		plugin: {} as import('obsidian').Plugin,
		loadData: vi.fn(async () => rawState),
		saveData: vi.fn(async () => undefined),
		addCommand: (command: { id: string; name: string; callback: () => void }) => { commands.push(command); },
		addSettingTab: (settingTab: unknown) => { settingTabs.push(settingTab); },
		registerInterval: (timerId: number) => {
			registeredIntervals.push(timerId);
			return timerId;
		},
	};
	return { host, commands, settingTabs, registeredIntervals };
}

describe('main runtime integration', () => {
	beforeEach(() => {
		notices.length = 0;
		mainTestMocks.setupOptions = undefined;
		vi.clearAllMocks();
	});

	it('registers exactly 13 commands and stops the scheduler on dispose', async () => {
		const timer = {
			setInterval: vi.fn(() => 42),
			clearInterval: vi.fn(),
		};
		const fixture = createHost({ settings: { backgroundSync: true, backgroundIntervalMinutes: 30 } });
		const runtime = createGameSyncRuntime(fixture.host, { timer, isMobile: () => false });

		await runtime.ready;

		expect(fixture.commands).toHaveLength(9);
		expect(fixture.settingTabs).toHaveLength(1);
		expect(timer.setInterval).toHaveBeenCalledOnce();
		expect(runtime.scheduler.getState()).toBe('scheduled');

		runtime.stop();

		expect(timer.clearInterval).toHaveBeenCalledWith(42);
		expect(runtime.scheduler.getState()).toBe('stopped');
	});

	it('uses a static Notice message for command failures', () => {
		notices.length = 0;
		const sensitive = 'raw secret error';
		const notify = createStaticCommandErrorNotifier((message) => notices.push(message));

		notify('command-failed');

		expect(notices).toEqual(['Game Sync command failed.']);
		expect(notices.join('\n')).not.toContain(sensitive);
	});

	it('automatically reconnects with stored credentials before opening repair modal', async () => {
		const account = { provider: 'steam' as const, displayName: 'Stored Steam', accountId: '76561198000000001' };
		const steamAdapter = {
			id: 'steam' as const,
			testConnection: vi.fn(async () => account),
			getConnectionStatus: vi.fn(async () => ({ provider: 'steam' as const, state: 'connected' as const, connected: true, account })),
			fetchLibrary: vi.fn(),
			disconnect: vi.fn(async () => undefined),
		};
		const playStationAdapter = {
			id: 'playstation' as const,
			testConnection: vi.fn(async () => ({ provider: 'playstation' as const, displayName: 'PSN', accountId: 'psn-account' })),
			getConnectionStatus: vi.fn(async () => ({ provider: 'playstation' as const, state: 'connected' as const, connected: true })),
			fetchLibrary: vi.fn(),
			disconnect: vi.fn(async () => undefined),
		};
		mainTestMocks.steamAdapterFactory.mockReturnValue(steamAdapter);
		mainTestMocks.playStationAdapterFactory.mockReturnValue(playStationAdapter);
		const fixture = createHost({ settings: { steamAccountId: account.accountId } }, { 'game-sync-steam-api-key': 'stored-api-key' });
		const runtime = createGameSyncRuntime(fixture.host, { timer: { setInterval: vi.fn(), clearInterval: vi.fn() }, isMobile: () => false });
		await runtime.ready;
		fixture.commands.find((command) => command.id === 'run-setup-wizard')?.callback();
		mainTestMocks.setupOptions?.openConnection('steam');

		await vi.waitFor(() => expect(steamAdapter.testConnection).toHaveBeenCalledOnce());
		expect(mainTestMocks.steamModal).not.toHaveBeenCalled();
		expect(notices.join('\n')).toContain('Reconnected');
		expect(JSON.stringify(fixture.host.saveData.mock.calls)).not.toContain('stored-api-key');
	});

	it('opens the repair modal when stored credentials fail', async () => {
		const steamAdapter = {
			id: 'steam' as const,
			testConnection: vi.fn(async () => { throw new Error('raw credential failure'); }),
			getConnectionStatus: vi.fn(async () => ({ provider: 'steam' as const, state: 'error' as const, connected: false })),
			fetchLibrary: vi.fn(),
			disconnect: vi.fn(async () => undefined),
		};
		mainTestMocks.steamAdapterFactory.mockReturnValue(steamAdapter);
		mainTestMocks.playStationAdapterFactory.mockReturnValue({ id: 'playstation', testConnection: vi.fn(), getConnectionStatus: vi.fn(), fetchLibrary: vi.fn(), disconnect: vi.fn() });
		const fixture = createHost({ settings: { steamAccountId: '76561198000000001' } }, { 'game-sync-steam-api-key': 'stored-api-key' });
		const runtime = createGameSyncRuntime(fixture.host, { timer: { setInterval: vi.fn(), clearInterval: vi.fn() }, isMobile: () => false });
		await runtime.ready;
		fixture.commands.find((command) => command.id === 'run-setup-wizard')?.callback();
		mainTestMocks.setupOptions?.openConnection('steam');

		await vi.waitFor(() => expect(mainTestMocks.steamModal).toHaveBeenCalledOnce());
		expect(notices.join('\n')).not.toContain('raw credential failure');
	});

	it('retries a transient network failure during one-click reconnect', async () => {
		const account = { provider: 'steam' as const, displayName: 'Stored Steam', accountId: '76561198000000001' };
		let attempts = 0;
		const steamAdapter = {
			id: 'steam' as const,
			testConnection: vi.fn(async () => {
				attempts += 1;
				if (attempts === 1) throw new ProviderNetworkError('temporary network failure');
				return account;
			}),
			getConnectionStatus: vi.fn(async () => ({ provider: 'steam' as const, state: 'connected' as const, connected: true, account })),
			fetchLibrary: vi.fn(),
			disconnect: vi.fn(async () => undefined),
		};
		mainTestMocks.steamAdapterFactory.mockReturnValue(steamAdapter);
		mainTestMocks.playStationAdapterFactory.mockReturnValue({ id: 'playstation', testConnection: vi.fn(), getConnectionStatus: vi.fn(), fetchLibrary: vi.fn(), disconnect: vi.fn() });
		const fixture = createHost({ settings: { steamAccountId: account.accountId } }, { 'game-sync-steam-api-key': 'stored-api-key' });
		const runtime = createGameSyncRuntime(fixture.host, { timer: { setInterval: vi.fn(), clearInterval: vi.fn() }, isMobile: () => false });
		await runtime.ready;
		fixture.commands.find((command) => command.id === 'run-setup-wizard')?.callback();
		mainTestMocks.setupOptions?.openConnection('steam');

		await vi.waitFor(() => expect(steamAdapter.testConnection).toHaveBeenCalledTimes(2));
		expect(mainTestMocks.steamModal).not.toHaveBeenCalled();
	});
});
