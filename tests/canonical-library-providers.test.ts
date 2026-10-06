import { describe, expect, it } from 'vitest';
import type { ProviderGame, ProviderSnapshot } from '../src/model/provider';
import type { GameProviderAdapter } from '../src/providers/provider';
import { createSteamLibraryProvider } from '../src/providers/steam/library-provider';
import { createPlayStationLibraryProvider } from '../src/providers/playstation/library-provider';
import { CanonicalProviderError, CanonicalSyncService } from '../src/sync/canonical-service';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { FakeVaultGateway } from './fake-gateway';

function steamGame(overrides: Partial<ProviderGame> = {}): ProviderGame {
	return {
		provider: 'steam',
		providerGameId: '440',
		title: 'Team Fortress 2',
		releaseDate: '2007-10-10',
		developers: ['Valve'],
		publishers: ['Valve'],
		genres: ['Action'],
		platforms: ['pc'],
		owned: true,
		playtimeMinutes: 120,
		lastPlayed: '2026-09-14T12:00:00.000Z',
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: { provider: 'steam', appId: 440 },
		...overrides,
	};
}

function playStationGame(overrides: Partial<ProviderGame> = {}): ProviderGame {
	return {
		provider: 'playstation',
		providerGameId: 'concept-1',
		title: 'PlayStation Game',
		developers: [],
		publishers: [],
		genres: [],
		platforms: ['ps5'],
		owned: true,
		playtimeMinutes: 90,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: { provider: 'playstation', conceptId: 'concept-1', titleIds: ['title-1'], npCommunicationIds: ['np-1'] },
		...overrides,
	};
}

function adapter(snapshot: ProviderSnapshot): GameProviderAdapter {
	return {
		id: snapshot.provider,
		getConnectionStatus: async () => ({ provider: snapshot.provider, state: 'connected', connected: true }),
		testConnection: async () => ({ provider: snapshot.provider, displayName: snapshot.provider, accountId: `${snapshot.provider}-account` }),
		fetchLibrary: async () => snapshot,
		disconnect: async () => undefined,
	};
}

function snapshot(game: ProviderGame, status: ProviderSnapshot['status'] = 'complete'): ProviderSnapshot {
	return {
		provider: game.provider,
		status,
		games: [game],
		fetchedAt: '2026-09-14T12:00:00.000Z',
		pagination: { complete: status === 'complete', pagesFetched: 1 },
		paginationComplete: status === 'complete',
	};
}

function mutableAdapter(initial: ProviderSnapshot): { adapter: GameProviderAdapter; setSnapshot: (next: ProviderSnapshot) => void } {
	let current = initial;
	return {
		adapter: {
			id: initial.provider,
			getConnectionStatus: async () => ({ provider: initial.provider, state: 'connected', connected: true }),
			testConnection: async () => ({ provider: initial.provider, displayName: initial.provider, accountId: `${initial.provider}-account` }),
			fetchLibrary: async () => current,
			disconnect: async () => undefined,
		},
		setSnapshot: (next) => { current = next; },
	};
}

describe('canonical Steam and PlayStation library providers', () => {
	it('normalizes Steam library membership into CanonicalGame', async () => {
		const result = await createSteamLibraryProvider({ adapter: adapter(snapshot(steamGame())) }).getSnapshot();

		expect(result.status).toBe('complete');
		expect(result.games[0]).toMatchObject({
			identity: { canonicalKey: 'steam:440', externalIds: { steam: '440' } },
			title: 'Team Fortress 2',
			platforms: [{ id: 'pc', owned: true, source: 'steam' }],
			playtime: { canonical: { minutes: 120, source: 'steam', confidence: 'high' } },
		});
	});

	it('normalizes PlayStation library membership into CanonicalGame', async () => {
		const result = await createPlayStationLibraryProvider({ adapter: adapter(snapshot(playStationGame())) }).getSnapshot();

		expect(result.status).toBe('complete');
		expect(result.games[0]).toMatchObject({
			identity: { canonicalKey: 'playstation:concept-1', externalIds: { playstation: 'concept-1' } },
			platforms: [{ id: 'playstation-5', owned: true, source: 'playstation' }],
			playtime: { canonical: { minutes: 90, source: 'playstation', confidence: 'high' } },
		});
	});

	it('preserves incomplete source status and does not present it as a complete library', async () => {
		const result = await createSteamLibraryProvider({ adapter: adapter(snapshot(steamGame(), 'partial')) }).getSnapshot();

		expect(result.status).toBe('partial');
		expect(result.games).toHaveLength(1);
	});

	it.each([
		{ name: 'Steam', create: createSteamLibraryProvider, game: steamGame() },
		{ name: 'PlayStation', create: createPlayStationLibraryProvider, game: playStationGame() },
	])('$name canonical preview survives a retrieval timestamp change', async ({ create, game }) => {
		const source = mutableAdapter(snapshot(game));
		const provider = create({ adapter: source.adapter });
		const gateway = new FakeVaultGateway();
		const service = new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });
		const preview = await service.preview();
		source.setSnapshot({ ...snapshot(game), fetchedAt: '2026-09-15T12:00:00.000Z' });

		await expect(service.applyPreview(preview)).resolves.toHaveLength(1);
	});

	it.each([
		{ name: 'Steam', create: createSteamLibraryProvider, game: steamGame() },
		{ name: 'PlayStation', create: createPlayStationLibraryProvider, game: playStationGame() },
	])('$name canonical preview rejects a changed managed value before writing', async ({ create, game }) => {
		const source = mutableAdapter(snapshot(game));
		const provider = create({ adapter: source.adapter });
		const gateway = new FakeVaultGateway();
		const service = new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });
		const preview = await service.preview();
		source.setSnapshot(snapshot({ ...game, title: `${game.title} Updated` }));

		await expect(service.applyPreview(preview)).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(gateway.frontMatterProcessCount).toBe(0);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it.each([
		{ name: 'Steam', create: createSteamLibraryProvider, game: steamGame({ description: 'Original summary', achievements: { earned: 1, total: 2, progress: 50, achievements: [{ id: 'a', name: 'First', description: 'Original detail', unlocked: true, hidden: false }] } }) },
		{ name: 'PlayStation', create: createPlayStationLibraryProvider, game: playStationGame({ description: 'Original summary', achievements: { earned: 1, total: 2, progress: 50, achievements: [{ id: 'a', name: 'First', description: 'Original detail', unlocked: true, hidden: false }] } }) },
	])('$name canonical preview rejects changed metadata or achievement details', async ({ create, game }) => {
		const source = mutableAdapter(snapshot(game));
		const provider = create({ adapter: source.adapter });
		const gateway = new FakeVaultGateway();
		const service = new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });
		const preview = await service.preview();
		const achievements = game.achievements;
		if (achievements === undefined) throw new Error('Test fixture must include achievements.');
		const changedAchievements = { ...achievements, achievements: [{ ...achievements.achievements[0], description: 'Changed detail' }] };
		source.setSnapshot(snapshot({ ...game, description: 'Changed summary', achievements: changedAchievements }));

		await expect(service.applyPreview(preview)).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(gateway.frontMatterProcessCount).toBe(0);
	});
});
