import { describe, expect, it, vi } from 'vitest';
import type { GameProviderAdapter } from '../src/providers/provider';
import type { GameProvider, ProviderGame, ProviderSnapshot } from '../src/model/provider';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { LibraryProvider } from '../src/model/canonical-provider';
import type { GameSyncData } from '../src/state/schema';
import type { StateStore } from '../src/state/store';
import type { PreparedSync } from '../src/sync/service';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { migrateState } from '../src/state/migrations';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { FakeVaultGateway } from './fake-gateway';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import { createGameSyncCommandActions, type RuntimeUiPort } from '../src/runtime/actions';

class MutableStateStore implements StateStore {

	loads = 0;
	saves = 0;

	constructor(public state: GameSyncData) {}

	async load(): Promise<GameSyncData> {
		this.loads += 1;
		return structuredClone(this.state);
	}

	async save(data: GameSyncData): Promise<void> {
		this.saves += 1;
		this.state = structuredClone(data);
	}
}

class CountingVaultGateway extends FakeVaultGateway {
	readonly reads: string[] = [];
	readonly existenceChecks: string[] = [];

	override async read(path: string): Promise<string> {
		this.reads.push(path);
		return super.read(path);
	}

	override async exists(path: string): Promise<boolean> {
		this.existenceChecks.push(path);
		return super.exists(path);
	}
}

function state(overrides: Partial<GameSyncData['settings']> = {}, propertyMapping: GameSyncData['propertyMapping'] = {}): GameSyncData {
	return migrateState({
		settings: {
			...DEFAULT_SETTINGS,
			...overrides,
			enabledProviders: {
				...DEFAULT_SETTINGS.enabledProviders,
				...overrides.enabledProviders,
			},
		},
		propertyMapping,
	});
}

function providerGame(provider: GameProvider, id: string, title = `${provider} game`): ProviderGame {
	return {
		provider,
		providerGameId: id,
		title,
		releaseDate: '2024-01-01',
		developers: ['Studio'],
		publishers: [],
		genres: [],
		platforms: provider === 'steam' ? ['pc'] : ['ps5'],
		owned: true,
		playtimeMinutes: 60,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		identity: provider === 'steam'
			? { provider: 'steam', appId: Number(id) || 1 }
			: { provider: 'playstation', conceptId: `concept-${id}`, titleIds: [`title-${id}`], npCommunicationIds: [`comm-${id}`] },
	};
}

function snapshot(game: ProviderGame): ProviderSnapshot {
	return {
		provider: game.provider,
		status: 'complete',
		games: [game],
		fetchedAt: '2026-09-12T12:00:00.000Z',
		pagination: { complete: true, pagesFetched: 1 },
		paginationComplete: true,
	};
}

function adapter(game: ProviderGame, onFetch: () => void): GameProviderAdapter {
	return {
		id: game.provider,
		getConnectionStatus: async () => ({ provider: game.provider, state: 'connected', connected: true }),
		testConnection: async () => ({ provider: game.provider, displayName: game.provider, accountId: `${game.provider}-account` }),
		fetchLibrary: async () => {
			onFetch();
			return snapshot(game);
		},
		disconnect: async () => undefined,
	};
}

function canonicalGame(): CanonicalGame {
	return {
		identity: { canonicalKey: 'gametrack:canonical-game', externalIds: { gametrack: 'canonical-game' } },
		title: 'Canonical Game',
		metadata: { developers: [], publishers: [], genres: [] },
		platforms: [{ id: 'steam', source: 'gametrack', owned: true }],
		playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: 'canonical-game', schemaSignature: 'schema' },
	};
}

function canonicalProvider(game: CanonicalGame): LibraryProvider {
	return {
		id: 'gametrack',
		getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
		isAvailable: async () => true,
		getSnapshot: async () => ({ status: 'complete', games: [game], revision: 'revision', diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 1, gamesNormalized: 1, diagnostics: [] } }),
		getLibrary: async () => [game],
		getDiagnostics: () => ({ provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 1, gamesNormalized: 1, diagnostics: [] }),
	};
}

function mutableProviderAdapter(initial: ProviderSnapshot, onFetch: () => void): { adapter: GameProviderAdapter; setSnapshot: (snapshot: ProviderSnapshot) => void } {
	let current = initial;
	return {
		adapter: {
			id: initial.provider,
			getConnectionStatus: async () => ({ provider: initial.provider, state: 'connected', connected: true }),
			testConnection: async () => ({ provider: initial.provider, displayName: initial.provider, accountId: `${initial.provider}-account` }),
			fetchLibrary: async () => { onFetch(); return current; },
			disconnect: async () => undefined,
		},
		setSnapshot: (snapshot) => { current = snapshot; },
	};
}

function richProviderGame(provider: GameProvider, id: string, playtimeMinutes: number, earned: number): ProviderGame {
	return {
		...providerGame(provider, id),
		playtimeMinutes,
		freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
		achievements: {
			earned,
			total: 2,
			progress: earned * 50,
			achievements: [
				{ id: 'first', name: 'First', description: 'First achievement', unlocked: earned > 0, hidden: false },
				{ id: 'second', name: 'Second', description: 'Second achievement', unlocked: earned > 1, hidden: false },
			],
		},
	};
}

describe('GameSyncRuntimeComposition', () => {
	it('reads current settings and keeps direct sync multi-provider', async () => {
		const steamFetches = { count: 0 };
		const playstationFetches = { count: 0 };
		const steam = adapter(providerGame('steam', '1'), () => { steamFetches.count += 1; });
		const playstation = adapter(providerGame('playstation', '2'), () => { playstationFetches.count += 1; });
		const store = new MutableStateStore(state({ enabledProviders: { steam: true, playstation: false } }));
		const composition = new GameSyncRuntimeComposition({ stateStore: store, gateway: new FakeVaultGateway(), adapters: [steam, playstation] });

		await (await composition.createService()).prepareAll();
		expect(steamFetches.count).toBe(1);
		expect(playstationFetches.count).toBe(0);

		store.state.settings.enabledProviders = { steam: false, playstation: true };
		await (await composition.createService()).prepareAll();
		expect(steamFetches.count).toBe(1);
		expect(playstationFetches.count).toBe(1);

		store.state.settings.enabledProviders = { steam: true, playstation: true };
		const explicitlyScoped = await composition.createService(['steam']);
		await explicitlyScoped.prepareAll();
		expect(steamFetches.count).toBe(2);
		expect(playstationFetches.count).toBe(2);
	});

	it('passes custom property mapping to planning and writing without changing the source state', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Custom.md': '---\nlogical-id: game-sync:one\nsource-id: "1"\nname: Old title\n---\nManual body',
		});
		const propertyMapping = { gameSyncId: 'logical-id', steamId: 'source-id', title: 'name' } as const;
		const store = new MutableStateStore(state({ enabledProviders: { steam: true, playstation: false } }, propertyMapping));
		store.state.identityMappings = [{ canonicalId: 'game-sync:one', provider: 'steam', providerGameId: '1' }];
		const before = structuredClone(store.state);
		const composition = new GameSyncRuntimeComposition({
			stateStore: store,
			gateway,
			adapters: [adapter(providerGame('steam', '1', 'New title'), () => undefined)],
		});
		const service = await composition.createService();
		expect(store.state).toEqual(before);

		const prepared = await service.prepareAll();
		expect(prepared.plan.statuses[0]?.status).toBe('update');
		expect(prepared.plan.operations[0]?.path).toBe('Games/Custom.md');
		await service.applySelection(prepared, prepared.plan.operations.map((operation) => operation.id), { explicit: true });

		const parsed = parseFrontmatter(await gateway.read('Games/Custom.md'));
		expect(parsed.frontmatter['logical-id']).toBe('game-sync:one');
		expect(parsed.frontmatter.name).toBe('New title');
		expect(parsed.frontmatter['source-id']).toBe('1');
		expect(parsed.frontmatter.title).toBeUndefined();
		expect(store.state.settings.firstSyncCompleted).toBe(true);
	});

	it('reads a template only after confirming that its path exists and leaves inputs untouched', async () => {
		const missingGateway = new CountingVaultGateway();
		const missingStore = new MutableStateStore(state({ templatePath: 'Templates/missing.tmpl' }));
		const missingBefore = structuredClone(missingStore.state);
		await new GameSyncRuntimeComposition({ stateStore: missingStore, gateway: missingGateway, adapters: [] }).createService();

		expect(missingGateway.existenceChecks).toEqual(['Templates/missing.tmpl']);
		expect(missingGateway.reads).toEqual([]);
		expect(missingStore.state).toEqual(missingBefore);

		const existingGateway = new CountingVaultGateway({ 'Templates/game.tmpl': '# {{title}}' });
		const existingStore = new MutableStateStore(state({ templatePath: 'Templates/game.tmpl' }));
		await new GameSyncRuntimeComposition({ stateStore: existingStore, gateway: existingGateway, adapters: [] }).createService();

		expect(existingGateway.existenceChecks).toEqual(['Templates/game.tmpl']);
		expect(existingGateway.reads).toEqual(['Templates/game.tmpl']);
	});

	it('passes the configured template path into the canonical preview', async () => {
		const gateway = new CountingVaultGateway({ 'Templates/game.tmpl': '# {{title}}\n{{playtime}}' });
		const store = new MutableStateStore(state({ libraryProvider: 'gametrack', templatePath: 'Templates/game.tmpl' }));
		const composition = new GameSyncRuntimeComposition({ stateStore: store, gateway, canonicalProvider: canonicalProvider(canonicalGame()) });

		const service = await composition.createCanonicalService();
		const preview = await service!.preview();
		expect(preview.plan?.operations[0]?.preview.body).toBe('# Canonical Game\n');
	});

	it('fails canonical preview when an explicitly configured template cannot be read', async () => {
		const gateway = new CountingVaultGateway();
		const store = new MutableStateStore(state({ libraryProvider: 'gametrack', templatePath: 'Templates/missing.tmpl' }));
		const composition = new GameSyncRuntimeComposition({ stateStore: store, gateway, canonicalProvider: canonicalProvider(canonicalGame()) });

		const service = await composition.createCanonicalService();
		await expect(service!.preview()).rejects.toThrow(/template.*missing\.tmpl.*clear|create/i);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it('runs direct Steam and PlayStation through one durable service lifecycle', async () => {
		const steamInitial = providerGame('steam', '440', 'steam game');
		const playStationInitial = providerGame('playstation', 'concept-1', 'playstation game');
		const steam = mutableProviderAdapter({ ...snapshot(steamInitial), games: [richProviderGame('steam', '440', 60, 1)] }, () => { steamFetches += 1; });
		const playstation = mutableProviderAdapter({ ...snapshot(playStationInitial), games: [richProviderGame('playstation', 'concept-1', 60, 1)] }, () => { playstationFetches += 1; });
		let steamFetches = 0;
		let playstationFetches = 0;
		const stateStore = new MutableStateStore(state({ enabledProviders: { steam: true, playstation: true } }));
		stateStore.state.identityMappings = [
			{ canonicalId: 'game-sync:shared', provider: 'steam', providerGameId: '440' },
			{ canonicalId: 'game-sync:shared', provider: 'playstation', providerGameId: 'concept-1' },
		];
		const gateway = new FakeVaultGateway();
		const createComposition = () => new GameSyncRuntimeComposition({ stateStore, gateway, adapters: [steam.adapter, playstation.adapter] });
		let previewPrepared: PreparedSync | undefined;
		let applyPreview: ((prepared: PreparedSync, ids: readonly string[]) => void | PromiseLike<void>) | undefined;
		const ui = {
			openPreview: vi.fn(async (prepared: PreparedSync, onApply: (prepared: PreparedSync, ids: readonly string[]) => void | PromiseLike<void>) => { previewPrepared = prepared; applyPreview = onApply; }),
			openCanonicalPreview: vi.fn(),
			openSummary: vi.fn(),
			openIgnoredGames: vi.fn(),
			openSetupWizard: vi.fn(),
			copyDiagnostics: vi.fn(),
			openMatchManager: vi.fn(),
			showUnavailable: vi.fn(),
		} as unknown as RuntimeUiPort;

		const firstActions = createGameSyncCommandActions({ composition: createComposition(), ui, stateStore });
		await firstActions.syncAll();
		expect(steamFetches).toBe(1);
		expect(playstationFetches).toBe(1);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
		expect(previewPrepared?.plan.operations).toHaveLength(1);
		if (previewPrepared === undefined || applyPreview === undefined) throw new Error('Direct preview was not opened.');
		await applyPreview(previewPrepared, previewPrepared.plan.operations.map((operation) => operation.id));
		expect((await gateway.listMarkdownFiles())).toHaveLength(1);

		const unchangedOpenPreview = vi.fn();
		const unchangedOpenSummary = vi.fn();
		const unchangedUi = { ...ui, openPreview: unchangedOpenPreview, openSummary: unchangedOpenSummary } as unknown as RuntimeUiPort;
		await createGameSyncCommandActions({ composition: createComposition(), ui: unchangedUi, stateStore }).syncAll();
		expect(unchangedOpenPreview).not.toHaveBeenCalled();
		expect(unchangedOpenSummary).toHaveBeenCalledOnce();

		steam.setSnapshot({ ...snapshot(richProviderGame('steam', '440', 90, 2)), provider: 'steam' });
		playstation.setSnapshot({ ...snapshot(richProviderGame('playstation', 'concept-1', 90, 2)), provider: 'playstation' });
		const deltaOpenPreview = vi.fn();
		const deltaOpenSummary = vi.fn();
		const deltaUi = { ...ui, openPreview: deltaOpenPreview, openSummary: deltaOpenSummary } as unknown as RuntimeUiPort;
		await createGameSyncCommandActions({ composition: createComposition(), ui: deltaUi, stateStore }).syncAll();
		expect(steamFetches).toBe(3);
		expect(playstationFetches).toBe(3);
		expect(deltaOpenPreview).not.toHaveBeenCalled();
		expect(deltaOpenSummary).toHaveBeenCalledOnce();
		const parsed = parseFrontmatter(await gateway.read('Games/steam game.md'));
		expect(parsed.frontmatter.playtime).toBe(180);
		expect(parsed.frontmatter['psn-trophies-earned']).toBe(2);
		expect(stateStore.state.identityMappings).toHaveLength(2);
	});
});
