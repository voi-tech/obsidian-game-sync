import { describe, expect, it } from 'vitest';
import type { CanonicalGame } from '../src/model/canonical-game';
import { canonicalGameFingerprint } from '../src/sync/canonical-state';
import { planCanonicalSync } from '../src/sync/canonical-planner';
import { buildCanonicalManagedProperties } from '../src/vault/canonical-projection';
import { matchCanonicalVaultNote } from '../src/vault/matcher';
import { buildNoteIndex } from '../src/vault/note-index';
import { CanonicalVaultWriter } from '../src/vault/canonical-writer';
import { CanonicalProviderError, CanonicalSyncService } from '../src/sync/canonical-service';
import { FakeVaultGateway } from './fake-gateway';

class UnreadableTemplateGateway extends FakeVaultGateway {
	override async read(path: string): Promise<string> {
		if (path === 'Templates/unreadable.tmpl') throw new Error('permission denied');
		return super.read(path);
	}
}

function game(overrides: Partial<CanonicalGame> = {}): CanonicalGame {
	return {
		identity: {
			canonicalKey: 'gametrack:game-1',
			externalIds: { gametrack: 'game-1', igdb: 1234 },
		},
		title: 'Example Game',
		metadata: { releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: ['Action'] },
		platforms: [{ id: 'steam', source: 'gametrack', owned: true }],
		playtime: {
			canonical: { minutes: 120, source: 'gametrack', confidence: 'high' },
			observations: [{ source: 'gametrack', rawValue: 2, rawUnit: 'hours', minutes: 120, confidence: 'high', valid: true }],
		},
		provenance: { provider: 'gametrack', sourceId: 'game-1', schemaSignature: 'schema-1' },
		...overrides,
	};
}

describe('Phase 3 canonical sync', () => {
	it('matches an existing note by IGDB before GameTrack ID and title', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\nigdb-id: 1234\ngametrack-id: another-id\n---\nmanual',
		});
		const match = matchCanonicalVaultNote(game(), await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('igdb-id');
		expect(match.confidence).toBe('explicit');
	});

	it('uses a legacy Steam identifier as a lower-priority stable match', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy.md': '---\ntitle: Legacy\nsteam-id: 440\n---\n' });
		const legacy = game({ title: 'Legacy', identity: { canonicalKey: 'gametrack:legacy', externalIds: { gametrack: 'legacy', steam: '440' } } });
		const match = matchCanonicalVaultNote(legacy, await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('provider-id');
	});

	it('uses a legacy PlayStation identifier as a lower-priority stable match', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy PS.md': '---\ntitle: Legacy PS\nplaystation-title-ids: 2001\n---\n' });
		const legacy = game({ title: 'Legacy PS', identity: { canonicalKey: 'gametrack:legacy-ps', externalIds: { gametrack: 'legacy-ps', playstation: '2001' } } });
		const match = matchCanonicalVaultNote(legacy, await buildNoteIndex(gateway));

		expect(match.status).toBe('matched');
		expect(match.method).toBe('provider-id');
	});

	it('uses a custom game-sync ID destination to update an existing note', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Old Title.md': '---\ncanonical-id: gametrack:game-1\ntitle: Old Title\n---\nmanual' });
		const renamed = game({ title: 'New Title' });
		const plan = await planCanonicalSync([renamed], { gateway, notesFolder: 'Games', propertyMapping: { gameSyncId: 'canonical-id' } });

		expect(plan.statuses[0]).toEqual(expect.objectContaining({ status: 'update', path: 'Games/Old Title.md' }));
		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]).toEqual(expect.objectContaining({ kind: 'update', path: 'Games/Old Title.md' }));
	});

	it('matches a case-insensitive custom game-sync ID destination without title fallback', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Old Title.md': '---\nLOGICAL-ID: gametrack:game-1\ntitle: Unrelated Existing Title\n---\nmanual' });
		const renamed = game({ title: 'New Title' });
		const plan = await planCanonicalSync([renamed], { gateway, notesFolder: 'Games', propertyMapping: { gameSyncId: 'logical-id' } });

		expect(plan.statuses[0]).toEqual(expect.objectContaining({ status: 'update', path: 'Games/Old Title.md' }));
		expect(plan.statuses[0]?.match?.method).toBe('game-sync-id');
		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]).toEqual(expect.objectContaining({ kind: 'update', path: 'Games/Old Title.md' }));
	});

	it('matches a note by a custom Steam destination when game-sync ID is disabled', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Old Steam Title.md': '---\nsteam-app-id: 440\ntitle: Old Steam Title\n---\nmanual' });
		const steamGame = game({ title: 'New Steam Title', identity: { canonicalKey: 'steam:440', externalIds: { steam: '440' } } });
		const plan = await planCanonicalSync([steamGame], { gateway, notesFolder: 'Games', propertyMapping: { gameSyncId: null, steamId: 'steam-app-id' } });

		expect(plan.statuses[0]).toEqual(expect.objectContaining({ status: 'update', path: 'Games/Old Steam Title.md' }));
		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]).toEqual(expect.objectContaining({ kind: 'update', path: 'Games/Old Steam Title.md' }));
	});

	it('matches a note by a custom PlayStation destination when game-sync ID is disabled', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Old PS Title.md': '---\nps-game-id: 2001\ntitle: Old PS Title\n---\nmanual' });
		const playStationGame = game({ title: 'New PS Title', identity: { canonicalKey: 'playstation:2001', externalIds: { playstation: '2001' } } });
		const plan = await planCanonicalSync([playStationGame], { gateway, notesFolder: 'Games', propertyMapping: { gameSyncId: null, playstationId: 'ps-game-id' } });

		expect(plan.statuses[0]).toEqual(expect.objectContaining({ status: 'update', path: 'Games/Old PS Title.md' }));
		expect(plan.operations).toHaveLength(1);
		expect(plan.operations[0]).toEqual(expect.objectContaining({ kind: 'update', path: 'Games/Old PS Title.md' }));
	});

	it('does not auto-merge a title-only ambiguous match', async () => {
		const gateway = new FakeVaultGateway({
			'Games/A.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\n',
			'Games/B.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\n',
		});
		const noIds = game({ identity: { canonicalKey: 'gametrack:game-2', externalIds: { gametrack: 'game-2' } } });
		const match = matchCanonicalVaultNote(noIds, await buildNoteIndex(gateway));

		expect(match.status).toBe('conflict');
		expect(match.method).toBe('ambiguous');
	});

	it('projects only defined provider fields and preserves user-owned/custom properties', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\nigdb-id: 1234\nstatus: playing\nrating: 5\ncustom: keep\n---\nnotes',
		});
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const writer = new CanonicalVaultWriter(gateway);
		await writer.apply(plan);
		const content = await gateway.read('Games/Example Game.md');

		expect(content).toContain('status: playing');
		expect(content).toContain('rating: 5');
		expect(content).toContain('custom: keep');
		expect(content).toContain('igdb-id: 1234');
		expect(content).toContain('gametrack-id: game-1');
		expect(content).toContain('playtime: 120');
	});

	it('rejects a user-owned destination before planning or writing', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ngame-sync-id: gametrack:game-1\nigdb-id: 1234\nstatus: old\ncustom: keep\n---\nnotes',
		});
		await expect(planCanonicalSync([game()], { gateway, notesFolder: 'Games', propertyMapping: { title: ' status ' } })).rejects.toThrow(/user-owned/i);
		expect(gateway.frontMatterProcessCount).toBe(0);
		const content = await gateway.read('Games/Example Game.md');

		expect(content).toContain('status: old');
		expect(content).toContain('custom: keep');
	});

	it('preserves an existing attribute when its source mapping is disabled', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ngame-sync-id: gametrack:game-1\nigdb-id: 1234\ntitle: Example Game\nplaytime: 90\n---\nmanual',
		});
		const mapping = { playtime: null } as const;
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', propertyMapping: mapping });
		await new CanonicalVaultWriter(gateway, { propertyMapping: mapping }).apply(plan);
		const content = await gateway.read('Games/Example Game.md');

		expect(content).toContain('playtime: 90');
	});

	it('applies only selected update fields and leaves the rest pending', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ngame-sync-id: gametrack:game-1\nigdb-id: 1234\ntitle: Example Game\nplaytime: 90\nplatforms:\n  - steam\n---\nmanual',
		});
		const changed = game({ platforms: [{ id: 'steam', source: 'gametrack', owned: true }, { id: 'xbox-series', source: 'gametrack', owned: true }], playtime: { canonical: { minutes: 120, source: 'gametrack', confidence: 'high' }, observations: [] } });
		const plan = await planCanonicalSync([changed], { gateway, notesFolder: 'Games' });
		const operation = plan.operations[0];
		const playtime = operation.preview.changes.find((change) => change.sourceField === 'playtime')!;
		await new CanonicalVaultWriter(gateway).apply(plan, { operationIds: [operation.id], fieldIdsByOperation: { [operation.id]: [playtime.fieldId] } });
		const content = await gateway.read('Games/Example Game.md');

		expect(content).toContain('playtime: 120');
		expect(content).toContain('  - steam');
		expect(content).not.toContain('  - xbox-series');
		const nextPlan = await planCanonicalSync([changed], { gateway, notesFolder: 'Games' });
		expect(nextPlan.statuses[0]?.status).toBe('update');
		expect(nextPlan.operations[0]?.preview.changes.some((change) => change.sourceField === 'platforms')).toBe(true);
	});

	it('requires a selected stable identity when partially creating a note', async () => {
		const gateway = new FakeVaultGateway();
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const operation = plan.operations[0];
		const title = operation.preview.changes.find((change) => change.sourceField === 'title')!;

		await expect(new CanonicalVaultWriter(gateway).apply(plan, { operationIds: [operation.id], fieldIdsByOperation: { [operation.id]: [title.fieldId] } })).rejects.toThrow(/stable game identity/i);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
		expect(gateway.hasFolder('Games')).toBe(false);
	});

	it('rejects malformed canonical selections before preparing target folders', async () => {
		const cases: readonly { readonly name: string; readonly selection: { operationIds: readonly string[]; fieldIdsByOperation: Readonly<Record<string, readonly string[]>> }; readonly message: RegExp }[] = [
			{ name: 'unknown operation', selection: { operationIds: ['missing-operation'], fieldIdsByOperation: { 'missing-operation': [] } }, message: /unknown canonical operation/i },
			{ name: 'duplicate operation', selection: { operationIds: ['duplicate', 'duplicate'], fieldIdsByOperation: {} }, message: /duplicate canonical operation/i },
			{ name: 'unknown field', selection: { operationIds: ['create-1'], fieldIdsByOperation: { 'create-1': ['missing-field'] } }, message: /unknown canonical field/i },
			{ name: 'unselected operation field', selection: { operationIds: [], fieldIdsByOperation: { 'create-1': [] } }, message: /unselected canonical operation/i },
			{ name: 'empty operation', selection: { operationIds: ['create-1'], fieldIdsByOperation: { 'create-1': [] } }, message: /without selecting a field/i },
		];

		for (const testCase of cases) {
			const gateway = new FakeVaultGateway();
			const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
			const operation = plan.operations[0];
			const selection = testCase.name === 'unknown field' || testCase.name === 'empty operation'
				? { ...testCase.selection, operationIds: [operation.id], fieldIdsByOperation: { [operation.id]: testCase.selection.fieldIdsByOperation['create-1'] ?? [] } }
				: testCase.name === 'unselected operation field'
					? { operationIds: [], fieldIdsByOperation: { [operation.id]: [] } }
					: testCase.name === 'duplicate operation'
						? { operationIds: [operation.id, operation.id], fieldIdsByOperation: {} }
						: testCase.selection;
			await expect(new CanonicalVaultWriter(gateway).apply(plan, selection)).rejects.toThrow(testCase.message);
			expect(gateway.hasFolder('Games')).toBe(false);
		}
	});

	it('creates only selected attributes while retaining a selected stable identity', async () => {
		const gateway = new FakeVaultGateway();
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const operation = plan.operations[0];
		const selected = operation.preview.changes.filter((change) => change.sourceField === 'igdbId' || change.sourceField === 'title').map((change) => change.fieldId);

		await new CanonicalVaultWriter(gateway).apply(plan, { operationIds: [operation.id], fieldIdsByOperation: { [operation.id]: selected } });
		const content = await gateway.read(operation.path);
		expect(content).toContain('title: "Example Game"');
		expect(content).toContain('igdb-id: 1234');
		expect(content).not.toContain('playtime: 120');
	});

	it('reports unchanged when provider-managed projection and fingerprint are stable', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ngame-sync-id: gametrack:game-1\nigdb-id: 1234\ngametrack-id: game-1\ntype: game\ntitle: Example Game\nreleased: 2024-01-01\ndevelopers:\n  - Studio\npublishers:\ngenres:\n  - Action\nplatforms:\n  - steam\nproviders:\n  - gametrack\nowned: true\nacquisition-type: unknown\nplaytime: 120\n---\n',
		});
		const first = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });
		const second = await planCanonicalSync([game()], { gateway, notesFolder: 'Games' });

		expect(first.statuses[0]?.status).toBe('unchanged');
		expect(second.operations).toHaveLength(0);
		expect(canonicalGameFingerprint(game())).toBe(canonicalGameFingerprint(game()));
	});

	it('does not emit achievement properties when values are undefined', () => {
		const properties = buildCanonicalManagedProperties(game({ achievements: [{ source: 'steam', platform: 'steam', unlocked: 3, confidence: 'low' }] }));

		expect(properties).toEqual(expect.objectContaining({ 'steam-achievements-earned': 3 }));
		expect(properties).not.toHaveProperty('achievements-unlocked');
	});

	it('preserves an existing legacy game-sync-id while adding canonical external IDs', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Legacy.md': '---\ngame-sync-id: game-sync:legacy\nsteam-id: 440\ntitle: Legacy\n---\nmanual' });
		const legacy = game({ title: 'Legacy', identity: { canonicalKey: 'gametrack:legacy', externalIds: { gametrack: 'legacy', steam: '440' } } });
		const plan = await planCanonicalSync([legacy], { gateway, notesFolder: 'Games' });
		await new CanonicalVaultWriter(gateway).apply(plan);
		const content = await gateway.read('Games/Legacy.md');

		expect(content).toContain('game-sync-id: game-sync:legacy');
		expect(content).toContain('gametrack-id: legacy');
	});

	it('blocks vault writes for a failed canonical snapshot', async () => {
		const gateway = new FakeVaultGateway();
		const provider = { id: 'gametrack', getCapabilities: () => ({ supported: true, desktop: true, mobile: false, automaticSync: false, library: true, metadata: true, platforms: true, playtime: true, achievementSummary: true }), isAvailable: async () => false, getSnapshot: async () => ({ status: 'failed' as const, games: [], diagnostics: { provider: 'gametrack', database: 'unavailable' as const, schema: 'unsupported' as const, gamesRead: 0, gamesNormalized: 0, diagnostics: [{ code: 'EXPORT_NOT_SELECTED', message: 'No export selected.' }] } }), getLibrary: async () => [], getDiagnostics: () => ({ provider: 'gametrack', database: 'unavailable' as const, schema: 'unsupported' as const, gamesRead: 0, gamesNormalized: 0, diagnostics: [] }) };
		const service = new CanonicalSyncService({ provider, planner: { gateway, notesFolder: 'Games' }, writer: new CanonicalVaultWriter(gateway) });

		await expect(service.sync()).rejects.toBeInstanceOf(CanonicalProviderError);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it('renders the configured canonical template into the create preview and writes that exact body', async () => {
		const gateway = new FakeVaultGateway({ 'Templates/game.tmpl': '# {{title}}\n\n{{playtime}} minutes\n' });
		const plan = await planCanonicalSync([game()], { gateway, notesFolder: 'Games', templatePath: 'Templates/game.tmpl' });
		const operation = plan.operations[0];
		expect(operation?.preview.body).toBe('# Example Game\n\n120 minutes\n');

		await new CanonicalVaultWriter(gateway, { template: () => '# diverging body\n' }).apply(plan);
		expect((await gateway.read(operation.path)).endsWith('# Example Game\n\n120 minutes\n')).toBe(true);
	});

	it('uses the default canonical body when no template path is configured', async () => {
		const plan = await planCanonicalSync([game()], { gateway: new FakeVaultGateway(), notesFolder: 'Games', templatePath: '   ' });
		expect(plan.operations[0]?.preview.body).toBe('# Example Game\n');
	});

	it('fails preview with an actionable error when an explicit canonical template is missing', async () => {
		const gateway = new FakeVaultGateway();
		await expect(planCanonicalSync([game()], { gateway, notesFolder: 'Games', templatePath: 'Templates/missing.tmpl' })).rejects.toThrow(/template.*missing\.tmpl.*clear|create/i);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

	it('fails preview with an actionable error when an explicit canonical template is unreadable', async () => {
		const gateway = new UnreadableTemplateGateway({ 'Templates/unreadable.tmpl': '# {{title}}' });
		await expect(planCanonicalSync([game()], { gateway, notesFolder: 'Games', templatePath: 'Templates/unreadable.tmpl' })).rejects.toThrow(/unable to read configured template.*unreadable\.tmpl.*readable/i);
		expect(await gateway.listMarkdownFiles()).toEqual([]);
	});

});
