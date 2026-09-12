import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import { createStateStore } from '../src/state/store';
import { StateMigrationError } from '../src/network/errors';
import type { GameSyncData } from '../src/state/schema';

const stateSecrets = [
	'STEAM_TEST_SECRET_123',
	'NPSSO_TEST_SECRET_456',
	'ACCESS_TEST_SECRET_789',
	'REFRESH_TEST_SECRET_012',
];

describe('versioned plugin state', () => {
	it('turns empty state into schema version 1 defaults', () => {
		const state = migrateState(undefined);

		expect(state.schemaVersion).toBe(1);
		expect(state.settings).toEqual(DEFAULT_SETTINGS);
		expect(state.identityMappings).toEqual([]);
		expect(state.recentActivity).toEqual([]);
	});

	it('ignores unknown settings fields and does not persist secrets', () => {
		expect(() =>
			migrateState({
				schemaVersion: 1,
				settings: {
					notesFolder: 'My Games',
					unknownField: 'rejected',
					steamApiKey: stateSecrets[0],
				},
				secrets: { psnAccessToken: stateSecrets[2] },
			}),
		).toThrow(StateMigrationError);
	});

	it('rejects unknown persistence fields in every state container', () => {
		const base = migrateState(undefined);
		const invalidStates: unknown[] = [
			{ ...base, unexpected: stateSecrets[0] },
			{ ...base, settings: { ...base.settings, unexpected: stateSecrets[0] } },
			{ ...base, identityMappings: [{ canonicalId: 'game:one', provider: 'steam', providerGameId: '1', unexpected: stateSecrets[0] }] },
			{ ...base, negativeMappings: [{ leftCanonicalId: 'game:one', rightCanonicalId: 'game:two', unexpected: stateSecrets[1] }] },
			{ ...base, ignoredCanonicalIds: [{ value: stateSecrets[2] }] },
			{ ...base, ignoredProviderRefs: [{ value: stateSecrets[3] }] },
			{
				...base,
				presence: [
					{
						provider: 'steam',
						providerGameId: '1',
						canonicalGameId: 'game:one',
						owned: true,
						consecutiveMissing: 0,
						lastSnapshotStatus: 'complete',
						paginationComplete: true,
						unexpected: stateSecrets[0],
					},
				],
			},
			{ ...base, providerCursors: { steam: { page: 1, unexpected: stateSecrets[1] } } },
			{
				...base,
				lastSuccessfulProviderStates: {
					steam: {
						provider: 'steam',
						fetchedAt: '2026-09-12T12:00:00Z',
						gameIds: ['1'],
						status: 'complete',
						paginationComplete: true,
						unexpected: stateSecrets[2],
					},
				},
			},
			{
				...base,
				recentActivity: [{ id: '1', createdAt: '2026-09-12T12:00:00Z', kind: 'sync', message: 'ok', unexpected: stateSecrets[3] }],
			},
			{ ...base, identityIndex: [{ canonicalId: 'game:one', unexpected: stateSecrets[0] }] },
		];

		for (const invalidState of invalidStates) {
			expect(() => migrateState(invalidState)).toThrow(StateMigrationError);
		}
	});

	it('accepts successful provider state only after complete pagination', () => {
		const complete = migrateState({
			schemaVersion: 1,
			lastSuccessfulProviderStates: {
				steam: {
					provider: 'steam',
					fetchedAt: '2026-09-12T12:00:00Z',
					gameIds: ['1'],
					status: 'complete',
					paginationComplete: true,
				},
			},
		});
		expect(complete.lastSuccessfulProviderStates.steam?.paginationComplete).toBe(true);

		for (const state of [
			{ status: 'partial', paginationComplete: true },
			{ status: 'complete', paginationComplete: false },
		]) {
			expect(() =>
				migrateState({
					schemaVersion: 1,
					lastSuccessfulProviderStates: {
						steam: {
							provider: 'steam',
							fetchedAt: '2026-09-12T12:00:00Z',
							gameIds: ['1'],
							...state,
						},
					},
				}),
			).toThrow(StateMigrationError);
		}
	});

	it('rejects successful provider state whose embedded provider mismatches its map key', () => {
		expect(() =>
			migrateState({
				schemaVersion: 1,
				lastSuccessfulProviderStates: {
					steam: {
						provider: 'playstation',
						fetchedAt: '2026-09-12T12:00:00Z',
						gameIds: ['1'],
						status: 'complete',
						paginationComplete: true,
					},
				},
			}),
		).toThrow(StateMigrationError);
	});

	it('turns invalid provider state into a controlled migration error', () => {
		expect(() =>
			migrateState({
				schemaVersion: 1,
				providerCursors: { steam: 42 },
			}),
		).toThrow(StateMigrationError);
	});

	it('round-trips schema version 1 through the durable store', async () => {
		let raw: unknown;
		const store = createStateStore(
			async () => raw,
			async (value) => {
				raw = value;
			},
			stateSecrets,
		);

		const initial = await store.load();
		initial.settings.createBase = true;
		await store.save(initial);
		const loaded = await store.load();

		expect(loaded.schemaVersion).toBe(1);
		expect(loaded.settings.createBase).toBe(true);
		expect(JSON.stringify(raw)).not.toMatch(/secret|token|password/i);
	});

	it('sanitizes four secret forms across persisted state containers before writing', async () => {
		let raw: unknown;
		const state = migrateState(undefined);
		state.settings.notesFolder = stateSecrets[0];
		state.identityMappings = [{ canonicalId: stateSecrets[1], provider: 'steam', providerGameId: '1' }];
		state.negativeMappings = [{ leftCanonicalId: stateSecrets[2], rightCanonicalId: stateSecrets[3] }];
		state.ignoredCanonicalIds = [stateSecrets[2]];
		state.ignoredProviderRefs = [stateSecrets[3]];
		state.presence = [
			{
				provider: 'steam',
				providerGameId: stateSecrets[0],
				canonicalGameId: stateSecrets[1],
				owned: true,
				consecutiveMissing: 0,
				lastSnapshotStatus: 'partial',
				paginationComplete: false,
			},
		];
		state.providerCursors = { steam: { cursor: stateSecrets[2], page: 1 } };
		state.lastSuccessfulProviderStates = {
			steam: {
				provider: 'steam',
				fetchedAt: stateSecrets[3],
				gameIds: [stateSecrets[0]],
				status: 'complete',
				paginationComplete: true,
			},
		};
		state.recentActivity = [
			{
				id: 'activity-1',
				createdAt: '2026-09-12T12:00:00Z',
				kind: 'sync',
				message: stateSecrets[3],
			},
		];
		state.identityIndex = [{ canonicalId: stateSecrets[1], steamAppId: 10 }];
		const store = createStateStore(
			async () => raw,
			async (value) => {
				raw = value;
			},
			stateSecrets,
		);

		await store.save(state);

		expect(JSON.stringify(raw)).not.toContain('TEST_SECRET');
	});

	it('preserves standalone 64-character structural IDs while redacting activity text', async () => {
		let raw: unknown;
		const cursor = 'A'.repeat(64);
		const providerGameId = 'B'.repeat(64);
		const successfulGameId = 'C'.repeat(64);
		const activityId = 'E'.repeat(64);
		const activitySecret = 'D'.repeat(64);
		const state = migrateState(undefined);
		state.providerCursors = { steam: { cursor, page: 1 } };
		state.identityMappings = [{ canonicalId: 'game:structural', provider: 'steam', providerGameId }];
		state.lastSuccessfulProviderStates = {
			steam: {
				provider: 'steam',
				fetchedAt: '2026-09-12T12:00:00Z',
				gameIds: [successfulGameId],
				status: 'complete',
				paginationComplete: true,
			},
		};
		state.recentActivity = [
			{
				id: activityId,
				createdAt: '2026-09-12T12:00:00Z',
				kind: 'diagnostic',
				message: activitySecret,
			},
		];
		const store = createStateStore(
			async () => raw,
			async (value) => {
				raw = value;
			},
		);

		await store.save(state);

		const persisted = raw as GameSyncData;
		expect(persisted.providerCursors.steam?.cursor).toBe(cursor);
		expect(persisted.identityMappings[0]?.providerGameId).toBe(providerGameId);
		expect(persisted.lastSuccessfulProviderStates.steam?.gameIds[0]).toBe(successfulGameId);
		expect(persisted.recentActivity[0]?.id).toBe(activityId);
		expect(persisted.recentActivity[0]?.message).toBe('[REDACTED]');
	});
});
