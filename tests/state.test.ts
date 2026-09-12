import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import { createStateStore } from '../src/state/store';
import { StateMigrationError } from '../src/network/errors';

describe('versioned plugin state', () => {
	it('turns empty state into schema version 1 defaults', () => {
		const state = migrateState(undefined);

		expect(state.schemaVersion).toBe(1);
		expect(state.settings).toEqual(DEFAULT_SETTINGS);
		expect(state.identityMappings).toEqual([]);
		expect(state.recentActivity).toEqual([]);
	});

	it('ignores unknown settings fields and does not persist secrets', () => {
		const state = migrateState({
			schemaVersion: 1,
			settings: {
				notesFolder: 'My Games',
				unknownField: 'ignored',
				steamApiKey: 'STEAM_TEST_SECRET_123',
			},
			secrets: { psnAccessToken: 'ACCESS_TEST_SECRET_789' },
		});

		expect(state.settings.notesFolder).toBe('My Games');
		expect(JSON.stringify(state)).not.toContain('STEAM_TEST_SECRET_123');
		expect(JSON.stringify(state)).not.toContain('ACCESS_TEST_SECRET_789');
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
		);

		const initial = await store.load();
		initial.settings.createBase = true;
		await store.save(initial);
		const loaded = await store.load();

		expect(loaded.schemaVersion).toBe(1);
		expect(loaded.settings.createBase).toBe(true);
		expect(JSON.stringify(raw)).not.toMatch(/secret|token|password/i);
	});
});
