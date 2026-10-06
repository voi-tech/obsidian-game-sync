import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { BackgroundSyncScheduler, type SyncExecutor, type SyncExecutorPreview } from '../src/sync/scheduler';

function preview(overrides: Partial<SyncExecutorPreview> = {}): SyncExecutorPreview {
	return {
		status: 'complete', operations: [], attention: [], warnings: [], gamesFetched: 0,
		providerStatuses: [{ id: 'test', state: 'success' }], approvalRequired: false, token: {}, ...overrides,
	};
}

function makeSettings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}): typeof DEFAULT_SETTINGS {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function makeFixture(settings: typeof DEFAULT_SETTINGS = makeSettings()) {
	const registeredTimerIds: number[] = [];
	const component = { registerInterval: vi.fn((timerId: number) => { registeredTimerIds.push(timerId); return timerId; }) };
	const readSettings = vi.fn<() => typeof DEFAULT_SETTINGS | Promise<typeof DEFAULT_SETTINGS>>(() => settings);
	const previewRun = vi.fn(async () => preview());
	const apply = vi.fn<SyncExecutor['apply']>(async () => ({ appliedOperationIds: [], pendingOperationIds: [], warnings: [] }));
	const notify = vi.fn();
	const timer = {
		setInterval: (callback: () => void, interval: number) => setInterval(callback, interval) as unknown as number,
		clearInterval: (timerId: number) => clearInterval(timerId as unknown as ReturnType<typeof setInterval>),
	};
	const executor: SyncExecutor = {
		preview: previewRun,
		apply,
		canRunAutomatically: () => settings.libraryProvider !== 'gametrack' || settings.steamEnricherEnabled || settings.playstationEnricherEnabled,
	};
	const scheduler = new BackgroundSyncScheduler({ component, isMobile: () => false, readSettings, executor, timer, notify });
	return { scheduler, component, readSettings, previewRun, apply, notify, timer, registeredTimerIds };
}

describe('BackgroundSyncScheduler', () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it.each([30, 60, 360, 720, 1440])('schedules supported interval %d minutes', async (backgroundIntervalMinutes) => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundIntervalMinutes }));
		await fixture.scheduler.start();
		expect(fixture.component.registerInterval).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
	});

	it('does not schedule unsupported or sub-30-minute intervals', async () => {
		for (const backgroundIntervalMinutes of [0, 1, 29, 31, 359, 1441]) {
			const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundIntervalMinutes }));
			await fixture.scheduler.start();
			expect(fixture.component.registerInterval).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		}
	});

	it('disables background scheduling on mobile', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		const scheduler = new BackgroundSyncScheduler({ component: fixture.component, isMobile: () => true, readSettings: fixture.readSettings, executor: { preview: fixture.previewRun, apply: fixture.apply }, timer: fixture.timer, notify: fixture.notify });
		await scheduler.start();
		await scheduler.run();
		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.previewRun).not.toHaveBeenCalled();
	});

	it('does not schedule or run when background sync is disabled', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: false }));
		await fixture.scheduler.start();
		await fixture.scheduler.run();
		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.previewRun).not.toHaveBeenCalled();
	});

	it('does not schedule or run manual GameTrack export imports', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true, libraryProvider: 'gametrack' }));
		await fixture.scheduler.start();
		await fixture.scheduler.run();
		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.previewRun).not.toHaveBeenCalled();
	});

	it('schedules optional platform enrichment without scheduling a GameTrack library import', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true, libraryProvider: 'gametrack', steamEnricherEnabled: true }));
		await fixture.scheduler.start();
		await fixture.scheduler.run();
		expect(fixture.component.registerInterval).toHaveBeenCalledTimes(1);
		expect(fixture.previewRun).toHaveBeenCalledOnce();
		expect(fixture.apply).toHaveBeenCalledOnce();
	});

	it('keeps exactly one registered timer through start, refresh and stop', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		await fixture.scheduler.start();
		await fixture.scheduler.start();
		expect(fixture.component.registerInterval).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		await fixture.scheduler.refresh();
		expect(fixture.component.registerInterval).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(1);
		fixture.scheduler.stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('refuses a new run after stop', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		await fixture.scheduler.start();
		fixture.scheduler.stop();
		await fixture.scheduler.run();
		expect(fixture.previewRun).not.toHaveBeenCalled();
		expect(fixture.apply).not.toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it('ignores a queued timer callback after stop', async () => {
		const callbacks: Array<() => void> = [];
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		const timer: Pick<Window, 'setInterval' | 'clearInterval'> = {
			setInterval: (callback: () => void) => { callbacks.push(callback); return 42; },
			clearInterval: vi.fn(),
		};
		fixture.scheduler = new BackgroundSyncScheduler({
			component: fixture.component,
			isMobile: () => false,
			readSettings: fixture.readSettings,
			executor: { preview: fixture.previewRun, apply: fixture.apply },
			timer,
			notify: fixture.notify,
		});

		await fixture.scheduler.start();
		fixture.scheduler.stop();
		callbacks[0]?.();
		await Promise.resolve();

		expect(fixture.previewRun).not.toHaveBeenCalled();
		expect(fixture.apply).not.toHaveBeenCalled();
	});

	it('clears a timer when lifecycle registration fails', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.component.registerInterval.mockImplementation(() => { throw new Error('component unavailable'); });
		await fixture.scheduler.start();
		expect(vi.getTimerCount()).toBe(0);
		expect(fixture.notify).toHaveBeenCalledWith('Game Sync: background sync failed while preparing data.');
	});

	it('does not overlap concurrent runs', async () => {
		let releasePreview!: () => void;
		const previewRun = vi.fn(() => new Promise<SyncExecutorPreview>((resolve) => { releasePreview = () => resolve(preview()); }));
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.previewRun.mockImplementation(previewRun);
		await fixture.scheduler.start();
		const first = fixture.scheduler.run();
		const second = fixture.scheduler.run();
		await Promise.resolve();
		expect(previewRun).toHaveBeenCalledTimes(1);
		releasePreview();
		await Promise.all([first, second]);
		expect(fixture.apply).toHaveBeenCalledTimes(1);
	});

	it('honors executor automatic-run capability without inspecting provider settings', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.scheduler = new BackgroundSyncScheduler({
			component: fixture.component,
			isMobile: () => false,
			readSettings: fixture.readSettings,
			executor: { preview: fixture.previewRun, apply: fixture.apply, canRunAutomatically: () => false },
			timer: fixture.timer,
			notify: fixture.notify,
		});
		await fixture.scheduler.start();
		await fixture.scheduler.run();
		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.previewRun).not.toHaveBeenCalled();
	});

	it('applies only safe operation IDs and retains review operations as pending', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.previewRun.mockResolvedValue(preview({ operations: [{ id: 'safe', risk: 'safe' }, { id: 'review', risk: 'review' }] }));
		fixture.apply.mockResolvedValue({ appliedOperationIds: ['safe'], pendingOperationIds: ['review'], warnings: [] });
		await fixture.scheduler.start();
		await fixture.scheduler.run();
		expect(fixture.apply).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }), ['safe']);
		expect(fixture.scheduler.getPending()).toEqual(['review']);
	});

	it('uses problems-only, all and none notification policies', async () => {
		const cases = [{ backgroundNotifications: 'problems-only' as const, expected: 0 }, { backgroundNotifications: 'all' as const, expected: 1 }, { backgroundNotifications: 'none' as const, expected: 0 }];
		for (const { backgroundNotifications, expected } of cases) {
			const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundNotifications }));
			await fixture.scheduler.start();
		await fixture.scheduler.run();
			expect(fixture.notify).toHaveBeenCalledTimes(expected);
		}
	});

	it('never exposes an error message in failure notifications and resolves the run', async () => {
		const secret = 'super-secret-provider-token';
		const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundNotifications: 'all' }));
		fixture.previewRun.mockRejectedValue(new Error(secret));
		await fixture.scheduler.start();
		await expect(fixture.scheduler.run()).resolves.toBeUndefined();
		expect(fixture.notify).toHaveBeenCalledTimes(1);
		expect(fixture.notify.mock.calls[0]?.[0]).toBe('Game Sync: background sync failed while preparing data.');
		expect(fixture.notify.mock.calls[0]?.[0]).not.toContain(secret);
	});

	it('reports apply failures with a static notification', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.apply.mockRejectedValue(new Error('provider payload and secret'));
		await fixture.scheduler.start();
		await expect(fixture.scheduler.run()).resolves.toBeUndefined();
		expect(fixture.notify).toHaveBeenCalledWith('Game Sync: background sync failed while applying changes.');
	});

	it('invalidates a pending manual run when stopped after settings resolve', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		await fixture.scheduler.start();
		let releaseSettings!: (settings: typeof DEFAULT_SETTINGS) => void;
		fixture.readSettings.mockImplementation(() => new Promise<typeof DEFAULT_SETTINGS>((resolve) => { releaseSettings = resolve; }));

		const run = fixture.scheduler.run();
		fixture.scheduler.stop();
		releaseSettings(makeSettings({ backgroundSync: true }));
		await run;

		expect(fixture.previewRun).not.toHaveBeenCalled();
		expect(fixture.apply).not.toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it('does not start a stopped run after automatic capability resolves', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		let releaseAutomatic!: (allowed: boolean) => void;
		const canRunAutomatically = vi.fn<NonNullable<SyncExecutor['canRunAutomatically']>>(() => true);
		fixture.scheduler = new BackgroundSyncScheduler({
			component: fixture.component,
			isMobile: () => false,
			readSettings: fixture.readSettings,
			executor: {
				preview: fixture.previewRun,
				apply: fixture.apply,
				canRunAutomatically,
			},
			timer: fixture.timer,
			notify: fixture.notify,
		});

		await fixture.scheduler.start();
		canRunAutomatically.mockImplementation(() => new Promise((resolve) => { releaseAutomatic = resolve; }));
		const run = fixture.scheduler.run();
		await Promise.resolve();
		fixture.scheduler.stop();
		releaseAutomatic(true);
		await run;

		expect(fixture.previewRun).not.toHaveBeenCalled();
		expect(fixture.apply).not.toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it('does not apply a preview resolved after the scheduler stops', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		await fixture.scheduler.start();
		let releasePreview!: (value: SyncExecutorPreview) => void;
		fixture.previewRun.mockImplementation(() => new Promise((resolve) => { releasePreview = resolve; }));

		const run = fixture.scheduler.run();
		await Promise.resolve();
		fixture.scheduler.stop();
		releasePreview(preview());
		await run;

		expect(fixture.apply).not.toHaveBeenCalled();
		expect(fixture.notify).not.toHaveBeenCalled();
	});

	it('does not notify after an in-flight apply completes following stop', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		await fixture.scheduler.start();
		let releaseApply!: (value: Awaited<ReturnType<SyncExecutor['apply']>>) => void;
		fixture.apply.mockImplementation(() => new Promise((resolve) => { releaseApply = resolve; }));

		const run = fixture.scheduler.run();
		await vi.waitFor(() => expect(fixture.apply).toHaveBeenCalledOnce());
		fixture.scheduler.stop();
		releaseApply({ appliedOperationIds: [], pendingOperationIds: [], warnings: [] });
		await run;

		expect(fixture.notify).not.toHaveBeenCalled();
	});
});
