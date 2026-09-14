import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import {
	GAME_TRACK_UNAVAILABLE_CODES,
	getRecommendedLibraryProvider,
	isLibraryProviderId,
	type GameTrackRuntimeStatus,
} from '../src/model/library-provider';

describe('Phase 4A library provider selection', () => {
	it('migrates an unambiguous existing installation to its library provider', () => {
		const state = migrateState({ settings: { enabledProviders: { steam: true } } });

		expect(state.settings.libraryProvider).toBe('steam');
		expect(state.settings.enabledProviders.steam).toBe(true);
	});

	it('migrates the retired direct-database setting without restoring it', () => {
		const state = migrateState({
			settings: {
				libraryProvider: 'gametrack',
				gametrackDatabasePath: '/custom/GameData.sqlite',
				enabledProviders: { steam: true, playstation: false },
				steamAccountId: 'legacy-account',
			},
		});

		expect(state.settings.libraryProvider).toBe('gametrack');
		expect('gametrackDatabasePath' in state.settings).toBe(false);
		expect(state.settings.enabledProviders.steam).toBe(true);
		expect(state.settings.steamAccountId).toBe('legacy-account');
	});

	it('validates provider ids and recommends GameTrack only when ready on macOS', () => {
		expect(isLibraryProviderId('gametrack')).toBe(true);
		expect(isLibraryProviderId('xbox')).toBe(false);
		const ready: GameTrackRuntimeStatus = { code: 'READY', supported: true, database: 'found', schema: 'supported', games: 207, platforms: ['steam'] };
		const unavailable: GameTrackRuntimeStatus = { code: GAME_TRACK_UNAVAILABLE_CODES.UNSUPPORTED_OS, supported: false, database: 'unavailable', schema: 'unknown', games: 0, platforms: [] };
		expect(getRecommendedLibraryProvider(ready)).toBe('gametrack');
		expect(getRecommendedLibraryProvider(unavailable)).toBeUndefined();
	});

	it('retains the old default settings shape for untouched users', () => {
		expect(migrateState(undefined).settings).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps the current GameTrack export configuration stable across a second migration', () => {
		const once = migrateState({
			settings: {
				libraryProvider: 'gametrack',
				gametrackExportPath: '/private/tmp/GameTrack_Export.zip',
				gametrackExportName: 'GameTrack_Export.zip',
				gametrackExportSize: 763150,
				gametrackExportModifiedAt: 1789389647456,
				gametrackLastImportedAt: '2026-09-14T19:25:18.792Z',
			},
		});

		expect(migrateState(once)).toEqual(once);
	});

});
