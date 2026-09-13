import { describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

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
}));

import { createGameSyncRuntime, createStaticCommandErrorNotifier } from '../src/main';

function createHost(rawState: unknown) {
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
				getSecret: () => null,
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
	it('registers exactly 13 commands and stops the scheduler on dispose', async () => {
		const timer = {
			setInterval: vi.fn(() => 42),
			clearInterval: vi.fn(),
		};
		const fixture = createHost({ settings: { backgroundSync: true, backgroundIntervalMinutes: 30 } });
		const runtime = createGameSyncRuntime(fixture.host, { timer, isMobile: () => false });

		await runtime.ready;

		expect(fixture.commands).toHaveLength(13);
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
});
