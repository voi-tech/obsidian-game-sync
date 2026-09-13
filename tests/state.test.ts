import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import { createStateStore } from '../src/state/store';
import { StateMigrationError } from '../src/network/errors';
import type { GameSyncData } from '../src/state/schema';
import { createOperation } from '../src/model/operations';
import { isSupportedBackgroundIntervalMinutes, SUPPORTED_BACKGROUND_INTERVAL_MINUTES } from '../src/model/settings';

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
		expect(state.propertyMapping).toEqual({});
		expect(state.identityMappings).toEqual([]);
		expect(state.recentActivity).toEqual([]);
	});

	it('persists a valid custom property mapping without changing schema version', () => {
		const state = migrateState({
			schemaVersion: 1,
			propertyMapping: { title: 'game-title', steamId: null, type: false },
		});

		expect(state.schemaVersion).toBe(1);
		expect(state.propertyMapping).toEqual({ title: 'game-title', steamId: null, type: false });
	});

	it('rejects unknown property mapping keys and invalid values', () => {
		for (const invalidMapping of [null, [], 'mapping', 42]) {
			expect(() => migrateState({ schemaVersion: 1, propertyMapping: invalidMapping })).toThrow(StateMigrationError);
		}

		for (const invalidMapping of [
			{ unknown: 'game-title' },
			{ title: '' },
			{ title: '   ' },
			{ title: 42 },
			{ title: true },
			{ title: {} },
			{ title: [] },
		]) {
			expect(() => migrateState({ schemaVersion: 1, propertyMapping: invalidMapping })).toThrow(StateMigrationError);
		}
	});

	it('rejects duplicate property mapping destinations without exposing their value', () => {
		const secretDestination = stateSecrets[0];

		try {
			migrateState({ schemaVersion: 1, propertyMapping: { title: secretDestination, type: secretDestination } });
			expect.fail('Expected duplicate property mapping to be rejected.');
		} catch (error) {
			expect(error).toBeInstanceOf(StateMigrationError);
			expect(String(error)).not.toContain(secretDestination);
		}
	});

	it('accepts only the supported background intervals and keeps the 360-minute default', () => {
		expect(SUPPORTED_BACKGROUND_INTERVAL_MINUTES).toEqual([30, 60, 360, 720, 1440]);
		for (const interval of SUPPORTED_BACKGROUND_INTERVAL_MINUTES) expect(isSupportedBackgroundIntervalMinutes(interval)).toBe(true);
		expect(isSupportedBackgroundIntervalMinutes(15)).toBe(false);
		expect(migrateState(undefined).settings.backgroundIntervalMinutes).toBe(360);
		for (const interval of [15, 90, 180, 2880]) {
			expect(() => migrateState({ settings: { backgroundIntervalMinutes: interval } })).toThrow(StateMigrationError);
		}
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

	it('validates and sanitizes durable provider snapshots while preserving schema version 1', () => {
		const state = migrateState({
			schemaVersion: 1,
			lastSuccessfulProviderSnapshots: {
				steam: [{
					provider: 'steam', providerGameId: '1', title: 'Example', developers: [], publishers: [], genres: [], platforms: [], owned: true,
					playtimeMinutes: 60, sourceUrl: 'https://example.test/?access_token=secret',
					freshness: { metadata: true, ownership: true, playtime: true, achievements: false }, identity: { provider: 'steam', appId: 1 },
				}],
			},
			lastAppliedProviderSnapshots: {
				steam: [{
					provider: 'steam', providerGameId: '1', title: 'Example', developers: [], publishers: [], genres: [], platforms: [], owned: true,
					playtimeMinutes: 90, sourceUrl: 'https://example.test/?access_token=secret',
					freshness: { metadata: true, ownership: true, playtime: true, achievements: false }, identity: { provider: 'steam', appId: 1 },
				}],
			},
		});

		expect(state.schemaVersion).toBe(1);
		expect(state.lastSuccessfulProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(60);
		expect(state.lastSuccessfulProviderSnapshots.steam?.[0]?.sourceUrl).toBeUndefined();
		expect(state.lastAppliedProviderSnapshots.steam?.[0]?.playtimeMinutes).toBe(90);
		expect(state.lastAppliedProviderSnapshots.steam?.[0]?.sourceUrl).toBeUndefined();
		expect(() => migrateState({
			schemaVersion: 1,
			lastSuccessfulProviderSnapshots: {
				steam: [{
					provider: 'steam', providerGameId: '1', title: 'Example', developers: [], publishers: [], genres: [], platforms: [],
					freshness: { metadata: true, ownership: true, playtime: true, achievements: false }, identity: { provider: 'steam', appId: 1 }, unexpected: 'reject',
				}],
			},
		})).toThrow(StateMigrationError);
	});

	it('strictly validates achievement totals, progress, rarity and journal achievement fields', () => {
		const baseAchievement = { id: 'achievement-1', name: 'Achievement', unlocked: true, hidden: false, rarityPercent: 50 };
		const baseSet = { earned: 1, total: 1, progress: 100, achievements: [baseAchievement] };
		const snapshotGame = {
			provider: 'steam', providerGameId: '1', title: 'Example', developers: [], publishers: [], genres: [], platforms: [], owned: true,
			freshness: { metadata: true, ownership: true, playtime: true, achievements: true }, identity: { provider: 'steam', appId: 1 }, achievements: baseSet,
		};
		const invalidSets = [
			{ ...baseSet, earned: 1.5 },
			{ ...baseSet, total: -1 },
			{ ...baseSet, earned: 2, total: 1 },
			{ ...baseSet, total: 2 },
			{ ...baseSet, earned: 0 },
			{ ...baseSet, progress: 101 },
			{ ...baseSet, achievements: [{ ...baseAchievement, rarityPercent: 101 }] },
			{ ...baseSet, achievements: [{ ...baseAchievement, unlocked: 'yes' }] },
		];
		for (const achievements of invalidSets) {
			expect(() => migrateState({ schemaVersion: 1, lastSuccessfulProviderSnapshots: { steam: [{ ...snapshotGame, achievements }] } })).toThrow(StateMigrationError);
		}

		const operation = createOperation({ canonicalGameId: 'game-sync:one', kind: 'create-note', path: 'Games/Example.md', risk: 'safe', summary: 'Create note.', planRevision: 'revision-1', expectedNoteFingerprint: null });
		const journalGame = {
			identity: { canonicalId: 'game-sync:one', steamAppId: 1 }, canonicalId: 'game-sync:one', title: 'Example', developers: [], publishers: [], genres: [], platforms: [],
			providers: { steam: { providerGameId: '1', title: 'Example', developers: [], publishers: [], genres: [], platforms: [], owned: true, achievements: baseSet, freshness: { metadata: true, ownership: true, playtime: true, achievements: true } } },
			owned: true, acquisitionType: 'unknown', playtimeMinutes: 0,
		};
		for (const achievements of invalidSets) {
			expect(() => migrateState({ schemaVersion: 1, operationJournal: [{ operation, game: { ...journalGame, providers: { steam: { ...journalGame.providers.steam, achievements } } }, noteApplied: false, providerStateApplied: false, historyApplied: false, cacheApplied: false }] })).toThrow(StateMigrationError);
		}
	});

	it('rejects inconsistent operation journal flags and malformed create fingerprints', () => {
		const base = migrateState(undefined);
		const operation = createOperation({ canonicalGameId: 'game-sync:one', kind: 'create-note', path: 'Games/Example.md', risk: 'safe', summary: 'Create note.', planRevision: 'revision-1', expectedNoteFingerprint: null });
		const entry = { operation, noteApplied: false, providerStateApplied: false, historyApplied: false, cacheApplied: false };

		for (const invalid of [
			{ ...entry, providerStateApplied: true },
			{ ...entry, noteApplied: true },
			{ ...entry, noteFingerprintAfter: 'fingerprint' },
			{ ...entry, operation: { ...operation, expectedNoteFingerprint: 'not-null' } },
			{ ...entry, unexpected: 'reject' },
		]) {
			expect(() => migrateState({ ...base, operationJournal: [invalid] })).toThrow(StateMigrationError);
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
		initial.propertyMapping = { title: 'game-title', steamId: null };
		await store.save(initial);
		const loaded = await store.load();

		expect(loaded.schemaVersion).toBe(1);
		expect(loaded.settings.createBase).toBe(true);
		expect(loaded.propertyMapping).toEqual({ title: 'game-title', steamId: null });
		expect((raw as GameSyncData).propertyMapping).toEqual({ title: 'game-title', steamId: null });
		expect(JSON.stringify(raw)).not.toMatch(/secret|token|password/i);
	});

	it('round-trips the public Steam account identity without persisting credentials', async () => {
		let raw: unknown;
		const store = createStateStore(
			async () => raw,
			async (value) => {
				raw = value;
			},
			stateSecrets,
		);

		const state = await store.load();
		state.settings.steamAccountId = '76561198000000001';
		await store.save(state);

		const loaded = await store.load();
		expect(loaded.settings.steamAccountId).toBe('76561198000000001');
		expect(JSON.stringify(raw)).toContain('76561198000000001');
		expect(JSON.stringify(raw)).not.toMatch(/STEAM_TEST_SECRET|NPSSO_TEST_SECRET|ACCESS_TEST_SECRET|REFRESH_TEST_SECRET|apiKey|npsso|token/i);
	});

	it('defaults to no public Steam identity and no credential fields', () => {
		const state = migrateState(undefined);

		expect(state.settings.steamAccountId).toBeUndefined();
		expect(JSON.stringify(state)).not.toMatch(/apiKey|npsso|accessToken|refreshToken|password/i);
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
