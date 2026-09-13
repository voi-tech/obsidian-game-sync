import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOperation, createSyncPlan, type Operation } from '../src/model/operations';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import type { PreparedSync, SyncApplyResult } from '../src/sync/service';
import { BackgroundSyncScheduler } from '../src/sync/scheduler';

function operation(id: string, risk: Operation['risk']): Operation {
	return createOperation({
		canonicalGameId: `game-sync:${id}`,
		kind: 'create-note',
		path: `Games/${id}.md`,
		risk,
		summary: `${id} operation`,
		planRevision: 'revision:test',
		expectedNoteFingerprint: null,
	});
}

function preparedSync(operations: readonly Operation[] = []): PreparedSync {
	const plan = createSyncPlan('revision:test', operations);
	return {
		plan: { ...plan, statuses: [], games: [] },
		games: [],
		providerStatuses: {
			steam: { provider: 'steam', state: 'success', gamesFetched: 0 },
			playstation: { provider: 'playstation', state: 'success', gamesFetched: 0 },
		},
		providerResults: {},
		gamesFetched: 0,
		operationsCreated: operations.length,
		warnings: [],
		reviewRequiredCount: operations.filter((candidate) => candidate.risk === 'review').length,
		ignored: 0,
		previewRequired: false,
	};
}

function applyResult(prepared: PreparedSync, pendingOperationIds: readonly string[] = []): SyncApplyResult {
	return {
		plan: prepared.plan,
		providerStatuses: prepared.providerStatuses,
		gamesFetched: prepared.gamesFetched,
		operationsCreated: prepared.operationsCreated,
		operationsApplied: prepared.plan.operations.length - pendingOperationIds.length,
		operationsAppliedIds: prepared.plan.operations.map((candidate) => candidate.id).filter((id) => !pendingOperationIds.includes(id)),
		pendingOperationIds: [...pendingOperationIds],
		deselectedOperationIds: [],
		deselected: 0,
		ignored: prepared.ignored,
		warnings: [],
		reviewRequiredCount: prepared.reviewRequiredCount,
	};
}

function makeSettings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}): typeof DEFAULT_SETTINGS {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function makeFixture(settings: typeof DEFAULT_SETTINGS = makeSettings()) {
	const registeredTimerIds: number[] = [];
	const component = {
		registerInterval: vi.fn((timerId: number) => {
			registeredTimerIds.push(timerId);
			return timerId;
		}),
	};
	const readSettings = vi.fn(() => settings);
	const prepareAll = vi.fn(async () => preparedSync());
	const applySelection = vi.fn(async (prepared: PreparedSync) => applyResult(prepared));
	const notify = vi.fn();
	const timer = {
		setInterval: (callback: () => void, interval: number) => setInterval(callback, interval) as unknown as number,
		clearInterval: (timerId: number) => clearInterval(timerId as unknown as ReturnType<typeof setInterval>),
	};
	const scheduler = new BackgroundSyncScheduler({
		component,
		isMobile: () => false,
		readSettings,
		service: { prepareAll, applySelection },
		timer,
		notify,
	});
	return { scheduler, component, readSettings, prepareAll, applySelection, notify, timer, registeredTimerIds };
}

describe('BackgroundSyncScheduler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

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
		const scheduler = new BackgroundSyncScheduler({
			component: fixture.component,
			isMobile: () => true,
			readSettings: fixture.readSettings,
			service: { prepareAll: fixture.prepareAll, applySelection: fixture.applySelection },
			timer: fixture.timer,
			notify: fixture.notify,
		});

		await scheduler.start();
		await scheduler.run();

		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.prepareAll).not.toHaveBeenCalled();
	});

	it('does not schedule or run when background sync is disabled', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: false }));

		await fixture.scheduler.start();
		await fixture.scheduler.run();

		expect(fixture.component.registerInterval).not.toHaveBeenCalled();
		expect(fixture.prepareAll).not.toHaveBeenCalled();
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

	it('clears a timer when lifecycle registration fails', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.component.registerInterval.mockImplementation(() => {
			throw new Error('component unavailable');
		});

		await fixture.scheduler.start();

		expect(vi.getTimerCount()).toBe(0);
		expect(fixture.notify).toHaveBeenCalledWith('Game Sync: background sync failed while preparing data.');
	});

	it('does not overlap concurrent runs', async () => {
		let releasePrepare: (() => void) | undefined;
		const prepareAll = vi.fn(() => new Promise<PreparedSync>((resolve) => {
			releasePrepare = () => resolve(preparedSync());
		}));
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		const scheduler = new BackgroundSyncScheduler({
			component: fixture.component,
			isMobile: () => false,
			readSettings: fixture.readSettings,
			service: { prepareAll, applySelection: fixture.applySelection },
			timer: fixture.timer,
			notify: fixture.notify,
		});

		const first = scheduler.run();
		const second = scheduler.run();
		await Promise.resolve();
		expect(prepareAll).toHaveBeenCalledTimes(1);

		releasePrepare!();
		await Promise.all([first, second]);
		expect(fixture.applySelection).toHaveBeenCalledTimes(1);
	});

	it('applies only safe operation IDs and retains review operations as pending', async () => {
		const safe = operation('safe', 'safe');
		const review = operation('review', 'review');
		const prepared = preparedSync([safe, review]);
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.prepareAll.mockResolvedValue(prepared);
		fixture.applySelection.mockResolvedValue(applyResult(prepared, [review.id]));

		await fixture.scheduler.run();

		expect(fixture.applySelection).toHaveBeenCalledWith(prepared, [safe.id], { background: true });
		expect(fixture.scheduler.getPending()).toEqual([review.id]);
	});

	it('uses problems-only, all and none notification policies', async () => {
		const cases = [
			{ backgroundNotifications: 'problems-only' as const, expected: 0 },
			{ backgroundNotifications: 'all' as const, expected: 1 },
			{ backgroundNotifications: 'none' as const, expected: 0 },
		];

		for (const { backgroundNotifications, expected } of cases) {
			const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundNotifications }));
			await fixture.scheduler.run();

			expect(fixture.notify).toHaveBeenCalledTimes(expected);
		}
	});

	it('never exposes an error message in failure notifications and resolves the run', async () => {
		const secret = 'super-secret-provider-token';
		const fixture = makeFixture(makeSettings({ backgroundSync: true, backgroundNotifications: 'all' }));
		fixture.prepareAll.mockRejectedValue(new Error(secret));

		await expect(fixture.scheduler.run()).resolves.toBeUndefined();

		expect(fixture.notify).toHaveBeenCalledTimes(1);
		expect(fixture.notify.mock.calls[0]?.[0]).toBe('Game Sync: background sync failed while preparing data.');
		expect(fixture.notify.mock.calls[0]?.[0]).not.toContain(secret);
	});

	it('reports apply failures with a static notification', async () => {
		const fixture = makeFixture(makeSettings({ backgroundSync: true }));
		fixture.applySelection.mockRejectedValue(new Error('provider payload and secret'));

		await expect(fixture.scheduler.run()).resolves.toBeUndefined();

		expect(fixture.notify).toHaveBeenCalledWith('Game Sync: background sync failed while applying changes.');
	});
});
