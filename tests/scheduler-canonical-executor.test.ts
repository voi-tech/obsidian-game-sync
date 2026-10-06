import { describe, expect, it, vi } from 'vitest';
import { BackgroundSyncScheduler, type SyncExecutor } from '../src/sync/scheduler';
import { createSyncConcurrencyGuard } from '../src/sync/concurrency';
import { DEFAULT_SETTINGS } from '../src/state/defaults';

function settings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}): typeof DEFAULT_SETTINGS {
	return { ...structuredClone(DEFAULT_SETTINGS), backgroundSync: true, ...overrides };
}

function fixture(executor: SyncExecutor, readSettings = () => settings()) {
	const notify = vi.fn();
	const scheduler = new BackgroundSyncScheduler({
		component: { registerInterval: vi.fn((timerId: number) => timerId) },
		isMobile: () => false,
		readSettings,
		executor,
		timer: { setInterval: () => 1, clearInterval: () => undefined },
		notify,
	});
	return { scheduler, notify };
}

describe('BackgroundSyncScheduler neutral executor boundary', () => {
	it('applies only safe operations and retains review/conflict items', async () => {
		const apply = vi.fn(async () => ({ appliedOperationIds: ['safe'], pendingOperationIds: ['review'], warnings: [] }));
		const executor: SyncExecutor = {
			preview: async () => ({
				status: 'complete',
				operations: [{ id: 'safe', risk: 'safe' }, { id: 'review', risk: 'review' }],
				attention: [{ id: 'conflict-game', reason: 'Ambiguous match.', kind: 'conflict' }],
				warnings: [],
				gamesFetched: 2,
				providerStatuses: [{ id: 'gametrack', state: 'success' }],
				approvalRequired: false,
				token: {},
			}),
			apply,
		};
		const { scheduler } = fixture(executor);

		await scheduler.start();
		await scheduler.run();

		expect(apply).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }), ['safe']);
		expect(scheduler.getPending()).toEqual(['review', 'conflict-game']);
	});

	it.each(['partial', 'failed'] as const)('does not write for %s snapshots', async (status) => {
		const apply = vi.fn();
		const executor: SyncExecutor = {
			preview: async () => ({
				status,
				operations: [{ id: 'safe', risk: 'safe' }],
				attention: [],
				warnings: ['snapshot unavailable'],
				gamesFetched: 0,
				providerStatuses: [{ id: 'gametrack', state: status }],
				approvalRequired: false,
				token: {},
			}),
			apply,
		};
		const { scheduler } = fixture(executor);

		await scheduler.start();
		await scheduler.run();

		expect(apply).not.toHaveBeenCalled();
		expect(scheduler.getPending()).toEqual(['safe']);
	});

	it('does not write before explicit provider approval', async () => {
		const apply = vi.fn();
		const executor: SyncExecutor = {
			preview: async () => ({
				status: 'complete',
				operations: [{ id: 'safe', risk: 'safe' }],
				attention: [],
				warnings: [],
				gamesFetched: 1,
				providerStatuses: [{ id: 'gametrack', state: 'success' }],
				approvalRequired: true,
				token: {},
			}),
			apply,
		};
		const { scheduler } = fixture(executor);

		await scheduler.start();
		await scheduler.run();

		expect(apply).not.toHaveBeenCalled();
		expect(scheduler.getPending()).toEqual(['safe']);
	});

	it('serializes manual and scheduled operations through the shared guard', async () => {
		const order: string[] = [];
		let release!: () => void;
		const first = new Promise<void>((resolve) => { release = resolve; });
		const guard = createSyncConcurrencyGuard();
		const executor: SyncExecutor = {
			preview: async () => {
				order.push('scheduled-start');
				await first;
				order.push('scheduled-end');
				return { status: 'complete', operations: [], attention: [], warnings: [], gamesFetched: 0, providerStatuses: [], approvalRequired: false, token: {} };
			},
			apply: async () => ({ appliedOperationIds: [], pendingOperationIds: [], warnings: [] }),
		};
		const scheduler = new BackgroundSyncScheduler({
			component: { registerInterval: vi.fn((timerId: number) => timerId) },
			isMobile: () => false,
			readSettings: () => settings(),
			executor,
			runExclusive: guard,
			timer: { setInterval: () => 1, clearInterval: () => undefined },
		});
		await scheduler.start();
		const scheduled = scheduler.run();
		const manual = guard(async () => { order.push('manual'); });
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(['scheduled-start']);
		release();
		await scheduled;
		await manual;
		expect(order).toEqual(['scheduled-start', 'scheduled-end', 'manual']);
	});
});
