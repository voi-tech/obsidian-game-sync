import { describe, expect, it, vi } from 'vitest';
import type { LibrarySummaryViewModel } from '../src/model/library-summary';
import type { GameProvider, ProviderGame } from '../src/model/provider';
import type { ReviewDecision } from '../src/ui/preview-modal';
import { migrateState } from '../src/state/migrations';
import type { GameSyncData } from '../src/state/schema';
import type { StateStore } from '../src/state/store';
import type { GameSyncRuntimeComposition } from '../src/runtime/composition';
import {
	createGameSyncCommandActions,
	type RuntimeUiPort,
} from '../src/runtime/actions';
import type { PreparedSync, SyncApplyResult } from '../src/sync/service';
import { buildLibrarySummary } from '../src/model/library-summary';

function prepared(id = 'operation:one'): PreparedSync {
	return {
		plan: {
			id: 'plan:test',
			planRevision: 'service:test',
			operations: [{
				id,
				canonicalGameId: 'game-sync:test',
				kind: 'create-note',
				path: 'Games/Test.md',
				risk: 'safe',
				summary: 'Create test note',
				planRevision: 'service:test',
				expectedNoteFingerprint: null,
			}],
			expectedNoteFingerprints: {},
			statuses: [],
			games: [],
		},
		games: [],
		providerStatuses: {
			steam: { provider: 'steam', state: 'success', gamesFetched: 1 },
			playstation: { provider: 'playstation', state: 'success', gamesFetched: 0 },
		},
		providerResults: {},
		gamesFetched: 1,
		operationsCreated: 1,
		warnings: [],
		reviewRequiredCount: 0,
		ignored: 0,
		previewRequired: false,
	};
}

function applyResult(value: PreparedSync): SyncApplyResult {
	return {
		plan: value.plan,
		providerStatuses: value.providerStatuses,
		gamesFetched: value.gamesFetched,
		operationsCreated: value.operationsCreated,
		operationsApplied: 1,
		operationsAppliedIds: value.plan.operations.map((operation) => operation.id),
		pendingOperationIds: [],
		deselectedOperationIds: [],
		deselected: 0,
		ignored: value.ignored,
		warnings: [],
		reviewRequiredCount: value.reviewRequiredCount,
	};
}

function providerGame(provider: GameProvider, id: string): ProviderGame {
	return {
		provider,
		providerGameId: id,
		title: `${provider} ${id}`,
		developers: [],
		publishers: [],
		genres: [],
		platforms: [],
		owned: true,
		playtimeMinutes: 30,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: provider === 'steam'
			? { provider: 'steam', appId: Number(id) || 1 }
			: { provider: 'playstation', conceptId: `concept:${id}`, titleIds: [`title:${id}`], npCommunicationIds: [`comm:${id}`] },
	};
}

function state(gameId: string): GameSyncData {
	const value = migrateState(undefined);
	value.lastSuccessfulProviderSnapshots.steam = [providerGame('steam', gameId)];
	value.lastSuccessfulProviderStates.steam = {
		provider: 'steam',
		status: 'complete',
		fetchedAt: '2026-09-13T10:00:00.000Z',
		gameIds: [gameId],
		paginationComplete: true,
	};
	return value;
}

class FakeService {
	readonly prepareCalls: Array<{ force?: boolean }> = [];
	readonly applyCalls: Array<{ prepared: PreparedSync; ids: readonly string[]; options: { explicit: boolean } }> = [];
	private readonly preparedValue: PreparedSync;
	private readonly stateValue: GameSyncData;
	private readonly prepareImpl?: () => Promise<void>;

	constructor(preparedValue: PreparedSync, stateValue = state('one'), prepareImpl?: () => Promise<void>) {
		this.preparedValue = preparedValue;
		this.stateValue = stateValue;
		this.prepareImpl = prepareImpl;
	}

	async prepareAll(options: { force?: boolean } = {}): Promise<PreparedSync> {
		this.prepareCalls.push(options);
		await this.prepareImpl?.();
		return this.preparedValue;
	}

	async applySelection(value: PreparedSync, ids: readonly string[], options: { explicit?: boolean }): Promise<SyncApplyResult> {
		this.applyCalls.push({ prepared: value, ids, options: { explicit: options.explicit === true } });
		return applyResult(value);
	}

	async getState(): Promise<GameSyncData> {
		return structuredClone(this.stateValue);
	}
}

class FakeStateStore implements StateStore {
	loads = 0;

	constructor(private readonly value: GameSyncData) {}

	async load(): Promise<GameSyncData> {
		this.loads += 1;
		return structuredClone(this.value);
	}

	async save(_data: GameSyncData): Promise<void> {}
}

function fixture() {
	const services: FakeService[] = [];
	const createService = vi.fn(async (scope?: readonly GameProvider[]) => {
		void scope;
		const service = new FakeService(prepared());
		services.push(service);
		return service;
	});
	const composition = { createService } as unknown as GameSyncRuntimeComposition;
	const previews: Array<{
		prepared: PreparedSync;
		onApply: (prepared: PreparedSync, ids: readonly string[]) => void | PromiseLike<void>;
		onReviewDecision: (decision: ReviewDecision) => void | PromiseLike<void>;
	}> = [];
	const summaries: Array<SyncApplyResult | LibrarySummaryViewModel> = [];
	const openIgnoredGames = vi.fn();
	const openSetupWizard = vi.fn();
	const copyDiagnostics = vi.fn();
	const showUnavailable = vi.fn();
	const ui: RuntimeUiPort = {
		openPreview: (value, onApply, onReviewDecision) => { previews.push({ prepared: value, onApply, onReviewDecision }); },
		openSummary: (value) => { summaries.push(value); },
		openIgnoredGames,
		openSetupWizard,
		copyDiagnostics,
		showUnavailable,
	};
	const actions = createGameSyncCommandActions({ composition, ui });
	return { actions, composition, createService, services, previews, summaries, ui, openIgnoredGames, openSetupWizard, copyDiagnostics, showUnavailable };
}

describe('createGameSyncCommandActions', () => {
	it.each([
		['syncAll', undefined],
		['syncSteam', ['steam']],
		['syncPlayStation', ['playstation']],
		['previewAllChanges', undefined],
		['previewSteamChanges', ['steam']],
		['previewPlayStationChanges', ['playstation']],
	] as const)('prepares %s with the expected provider scope', async (actionName, expectedScope) => {
		const fixtureValue = fixture();

		await fixtureValue.actions[actionName]();

		expect(fixtureValue.createService).toHaveBeenCalledWith(expectedScope);
		expect(fixtureValue.services[0]?.prepareCalls).toEqual([{}]);
	});

	it('force-refresh prepares a fresh all-provider service with force enabled', async () => {
		const fixtureValue = fixture();

		await fixtureValue.actions.forceRefreshAllData();

		expect(fixtureValue.createService).toHaveBeenCalledWith(undefined);
		expect(fixtureValue.services[0]?.prepareCalls).toEqual([{ force: true }]);
	});

	it('keeps preview commands preview-only and applies only after an explicit UI callback', async () => {
		const fixtureValue = fixture();

		await fixtureValue.actions.syncAll();
		expect(fixtureValue.services[0]?.applyCalls).toHaveLength(0);

		const preview = fixtureValue.previews[0];
		expect(preview).toBeDefined();
		if (preview === undefined) throw new Error('Preview was not opened.');
		await preview.onApply(preview.prepared, ['operation:one']);

		expect(fixtureValue.services[0]?.applyCalls).toEqual([{
			prepared: preview.prepared,
			ids: ['operation:one'],
			options: { explicit: true },
		}]);
		expect(fixtureValue.summaries).toHaveLength(1);
	});

	it('opens pending-match review without inventing a review decision', async () => {
		const fixtureValue = fixture();

		await fixtureValue.actions.reviewPendingMatches();
		const preview = fixtureValue.previews[0];
		expect(preview).toBeDefined();
		if (preview === undefined) throw new Error('Preview was not opened.');
		await preview.onReviewDecision({
			planId: 'plan:test',
			canonicalGameId: 'game-sync:test',
			action: 'merge',
		});

		expect(fixtureValue.services[0]?.prepareCalls).toEqual([{}]);
		expect(fixtureValue.services[0]?.applyCalls).toHaveLength(0);
	});

	it('builds library summary from a freshly loaded state', async () => {
		const currentState = state('fresh');
		const stateStore = new FakeStateStore(currentState);
		const fixtureValue = fixture();
		const actions = createGameSyncCommandActions({ composition: fixtureValue.composition, ui: fixtureValue.ui, stateStore });

		await actions.openLibrarySummary();

		expect(stateStore.loads).toBe(1);
		expect(fixtureValue.summaries).toEqual([buildLibrarySummary(currentState)]);
	});

	it('routes unavailable and auxiliary commands through the UI port', async () => {
		const fixtureValue = fixture();

		await fixtureValue.actions.manageGameMatches();
		await fixtureValue.actions.manageIgnoredGames();
		await fixtureValue.actions.copyDiagnosticInformation();
		await fixtureValue.actions.runSetupWizard();

		expect(fixtureValue.showUnavailable).toHaveBeenCalledWith('manage-game-matches');
		expect(fixtureValue.openIgnoredGames).toHaveBeenCalledOnce();
		expect(fixtureValue.copyDiagnostics).toHaveBeenCalledOnce();
		expect(fixtureValue.openSetupWizard).toHaveBeenCalledOnce();
	});

	it('serializes service preparation for concurrent manual commands', async () => {
		let releaseFirst!: () => void;
		let firstStarted!: () => void;
		const started = new Promise<void>((resolve) => { firstStarted = resolve; });
		const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
		const services: FakeService[] = [];
		const createService = vi.fn(async () => {
			const service = new FakeService(prepared(), state('one'), async () => {
				firstStarted();
				await firstRelease;
			});
			services.push(service);
			return service;
		});
		const ui: RuntimeUiPort = {
			openPreview: vi.fn(),
			openSummary: vi.fn(),
			openIgnoredGames: vi.fn(),
			openSetupWizard: vi.fn(),
			copyDiagnostics: vi.fn(),
			showUnavailable: vi.fn(),
		};
		const actions = createGameSyncCommandActions({ composition: { createService } as unknown as GameSyncRuntimeComposition, ui });

		const first = actions.syncAll();
		await started;
		const second = actions.syncSteam();
		await Promise.resolve();
		expect(createService).toHaveBeenCalledTimes(1);

		releaseFirst();
		await Promise.all([first, second]);
		expect(createService).toHaveBeenCalledTimes(2);
		expect(services).toHaveLength(2);
	});
});
