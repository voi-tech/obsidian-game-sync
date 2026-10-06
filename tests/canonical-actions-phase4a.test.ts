import { describe, expect, it, vi } from 'vitest';
import { migrateState } from '../src/state/migrations';
import { createGameSyncCommandActions, type RuntimeUiPort } from '../src/runtime/actions';
import type { GameSyncRuntimeComposition } from '../src/runtime/composition';
import type { StateStore } from '../src/state/store';
import type { CanonicalPreviewResult } from '../src/sync/canonical-service';

function fixture() {
	const state = migrateState({ settings: { libraryProvider: 'gametrack' } });
	const preview: CanonicalPreviewResult = {
		snapshot: {
			status: 'complete', games: [], diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 0, gamesNormalized: 0, diagnostics: [] },
		},
		plan: { id: 'plan', planRevision: 'revision', operations: [], statuses: [], games: [] },
	};
	const service = { preview: vi.fn(async () => preview), applyPreview: vi.fn(async () => []) };
	const createCanonicalService = vi.fn(async () => service);
	const stateStore: StateStore = { load: vi.fn(async () => structuredClone(state)), save: vi.fn(async () => undefined) };
	const openCanonicalPreview = vi.fn<NonNullable<RuntimeUiPort['openCanonicalPreview']>>();
	const createService = vi.fn();
	const ui = {
		openPreview: vi.fn(), openCanonicalPreview, openSummary: vi.fn(), openIgnoredGames: vi.fn(), openSetupWizard: vi.fn(),
		copyDiagnostics: vi.fn(), openMatchManager: vi.fn(), showUnavailable: vi.fn(),
	} as unknown as RuntimeUiPort;
	const approveCanonicalBackgroundSync = vi.fn(async () => undefined);
	const composition = { createCanonicalService, createService, approveCanonicalBackgroundSync } as unknown as GameSyncRuntimeComposition;
	const actions = createGameSyncCommandActions({ composition, ui, stateStore });
	return { actions, service, createCanonicalService, createService, openCanonicalPreview, ui };
}

describe('GameTrack command routing', () => {
	it('routes primary sync and preview commands through the canonical provider', async () => {
		const value = fixture();

		await value.actions.syncAll();
		await value.actions.previewAllChanges();

		expect(value.createCanonicalService).toHaveBeenCalledTimes(2);
		expect(value.service.preview).toHaveBeenCalledTimes(2);
		expect(value.openCanonicalPreview).toHaveBeenCalledTimes(2);
		expect(value.createService).not.toHaveBeenCalled();
	});

	it.each(['steam', 'playstation'] as const)('treats migrated %s selection as the direct multi-provider path', async (provider) => {
		const state = migrateState({ settings: { libraryProvider: provider } });
		const service = { prepareAll: vi.fn(async () => ({ plan: { operations: [], statuses: [] }, providerStatuses: {}, games: [], gamesFetched: 0, operationsCreated: 0, warnings: [], reviewRequiredCount: 0, ignored: 0, previewRequired: true, presence: [] })), applySelection: vi.fn(async () => undefined) };
		const createCanonicalService = vi.fn(async () => service);
		const createService = vi.fn(async () => service);
		const stateStore: StateStore = { load: vi.fn(async () => structuredClone(state)), save: vi.fn(async () => undefined) };
		const openCanonicalPreview = vi.fn();
		const ui = { openPreview: vi.fn(), openCanonicalPreview, openSummary: vi.fn(), openIgnoredGames: vi.fn(), openSetupWizard: vi.fn(), copyDiagnostics: vi.fn(), openMatchManager: vi.fn(), showUnavailable: vi.fn() } as unknown as RuntimeUiPort;
		const actions = createGameSyncCommandActions({ composition: { createCanonicalService, createService } as unknown as GameSyncRuntimeComposition, ui, stateStore });

		await actions.syncAll();

		expect(createCanonicalService).not.toHaveBeenCalled();
		expect(createService).toHaveBeenCalledOnce();
		expect(openCanonicalPreview).not.toHaveBeenCalled();
	});

	it('forwards the complete canonical field selection from the preview UI to the service', async () => {
		const value = fixture();
		const selection = { operationIds: ['operation-1'], fieldIdsByOperation: { 'operation-1': ['field-1', 'field-2'] } } as const;
		value.openCanonicalPreview.mockImplementation(async (_preview, onApply) => { await onApply(selection); });

		await value.actions.syncAll();

		expect(value.service.applyPreview).toHaveBeenCalledWith(expect.anything(), selection);
	});

});
