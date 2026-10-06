import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import type { CanonicalLibrarySnapshot, LibraryProvider } from '../src/model/canonical-provider';
import { CanonicalSyncService } from '../src/sync/canonical-service';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { GameSyncRuntimeComposition } from '../src/runtime/composition';
import type { StateStore } from '../src/state/store';
import type { GameSyncData } from '../src/state/schema';
import { migrateState } from '../src/state/migrations';
import { DEFAULT_SETTINGS } from '../src/state/defaults';
import { FakeVaultGateway } from './fake-gateway';

class MemoryStateStore implements StateStore {
	constructor(private state: GameSyncData) {}
	async load(): Promise<GameSyncData> { return structuredClone(this.state); }
	async save(state: GameSyncData): Promise<void> { this.state = structuredClone(state); }
}

function provider(): LibraryProvider {
	return {
		id: 'gametrack',
		getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }),
		isAvailable: async () => true, getSnapshot: async () => snapshot(), getLibrary: async () => snapshot().games, getDiagnostics: () => snapshot().diagnostics,
	};
}

function snapshot(): CanonicalLibrarySnapshot {
	const games: CanonicalGame[] = ['one', 'two'].map((id) => ({
		identity: { canonicalKey: `gametrack:${id}`, externalIds: { gametrack: id } },
		title: id, metadata: { developers: [], publishers: [], genres: [] },
		platforms: [], playtime: { observations: [] },
		provenance: { provider: 'gametrack', sourceId: id, schemaSignature: 'fixture' },
	}));
	return { status: 'complete', revision: 'fixture', games, diagnostics: { provider: 'gametrack', database: 'found', schema: 'supported', gamesRead: 2, gamesNormalized: 2, diagnostics: [] } };
}

function fixture(gateway = new FakeVaultGateway()) {
	let active = true;
	let revision = 'original';
	const service = new CanonicalSyncService({
		provider: provider(),
		planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway),
		configurationRevision: 'original', readConfigurationRevision: async () => revision, isActive: () => active,
	});
	return { service, gateway, stop: () => { active = false; }, change: () => { revision = 'changed'; } };
}

describe('canonical preview lifecycle', () => {
	it('refuses a preview prepared by a different service instance', async () => {
		const first = fixture();
		const second = fixture(first.gateway);
		const preview = await first.service.preview();
		await expect(second.service.applyPreview(preview)).rejects.toThrow(/another sync service/i);
		expect(await first.gateway.listMarkdownFiles()).toEqual([]);
	});

	it('refuses an old preview after configuration changes', async () => {
		const test = fixture();
		const preview = await test.service.preview();
		test.change();
		await expect(test.service.applyPreview(preview)).rejects.toThrow(/configuration/i);
		expect(await test.gateway.listMarkdownFiles()).toEqual([]);
	});

	it('does not apply a preview after the runtime stops', async () => {
		const test = fixture();
		const preview = await test.service.preview();
		test.stop();
		await expect(test.service.applyPreview(preview)).rejects.toThrow(/inactive|stopped/i);
		expect(await test.gateway.listMarkdownFiles()).toEqual([]);
	});

	it('checks lifecycle again between individual writes', async () => {
		const gateway = new FakeVaultGateway();
		const test = fixture(gateway);
		const originalCreate = gateway.create.bind(gateway);
		gateway.create = async (path, content) => { await originalCreate(path, content); test.stop(); };
		const preview = await test.service.preview();
		await expect(test.service.applyPreview(preview)).rejects.toThrow(/inactive|stopped/i);
		expect(await gateway.listMarkdownFiles()).toHaveLength(1);
	});

	it.each(['settings', 'mapping', 'template'])('binds a preview to current %s in runtime composition', async (change) => {
		const gateway = new FakeVaultGateway({ 'Templates/Game.md': '# {{title}}' });
		const stateStore = new MemoryStateStore(migrateState({ settings: { ...DEFAULT_SETTINGS, libraryProvider: 'gametrack', templatePath: 'Templates/Game.md' } }));
		const composition = new GameSyncRuntimeComposition({ stateStore, gateway, canonicalProvider: provider() });
		const service = await composition.createCanonicalService();
		if (service === undefined) throw new Error('Missing service');
		const preview = await service.preview();
		const state = await stateStore.load();
		if (change === 'settings') state.settings.notesFolder = 'Changed';
		if (change === 'mapping') state.propertyMapping.title = 'Game-title';
		if (change === 'template') gateway.set('Templates/Game.md', '# Changed {{title}}');
		await stateStore.save(state);
		await expect(service.applyPreview(preview)).rejects.toThrow(/configuration/i);
		expect(await gateway.listMarkdownFiles()).toHaveLength(1);
	});
});
