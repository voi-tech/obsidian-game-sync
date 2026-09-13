import { describe, expect, it } from 'vitest';
import { createSyncPlanner } from '../src/sync/planner';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';
import type { NormalizedGame } from '../src/model/game';
import { VaultWriter } from '../src/vault/writer';

function game(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
	return {
		identity: { canonicalId: 'game-sync:one', steamAppId: 1 }, canonicalId: 'game-sync:one', title: 'Example Game', releaseDate: '2024-01-01',
		developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], providers: {
			steam: { providerGameId: '1', title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], owned: true, freshness: { metadata: true, ownership: true, playtime: true, achievements: true },
		},
		}, owned: true, acquisitionType: 'unknown', playtimeMinutes: 90, ...overrides,
	};
}

describe('deterministic sync planner', () => {
	it('creates a note without a Control (1).md collision', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const plan = await planner.plan([game()], 'revision-1');

		expect(plan.statuses[0]?.status).toBe('create');
		expect(plan.operations[0]?.kind).toBe('create-note');
		expect(plan.operations[0]?.path).toBe('Games/Example Game.md');
	});

	it('adopts an existing provider note without treating it as a rename', async () => {
		const gateway = new FakeVaultGateway({ 'Games/Old.md': '---\nsteam-id: "1"\ncustom: keep\n---\n# User body' });
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const plan = await planner.plan([game()], 'revision-1');

		expect(plan.statuses[0]?.status).toBe('adopt');
		expect(plan.operations[0]?.kind).toBe('adopt-note');
		expect(plan.operations[0]?.path).toBe('Games/Old.md');
	});

	it('marks ambiguous matches as conflict and keeps them out of automatic operations', async () => {
		const gateway = new FakeVaultGateway({
			'Games/One.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nOne',
			'Games/Two.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nTwo',
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const plan = await planner.plan([{ ...game(), providers: {} }], 'revision-1');

		expect(plan.statuses[0]?.status).toBe('conflict');
		expect(plan.operations).toHaveLength(0);
	});

	it('refreshes the note index before each plan so an applied create is not planned twice', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const first = await planner.plan([game()], 'revision-1');
		const firstPath = first.operations[0]?.path;
		if (firstPath === undefined) throw new Error('Expected a create-note path.');
		await new VaultWriter(gateway).createNote({ path: firstPath, game: game(), expectedNoteFingerprint: null, updatedAt: '2026-09-12T12:00:00.000Z' });

		const second = await planner.plan([game()], 'revision-2');
		expect(second.operations).toHaveLength(0);
		expect(second.statuses[0]?.status).toBe('unchanged');
	});

	it('uses custom property mapping for index lookup, diff and adoption detection', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Custom.md': '---\nlogical-id: game-sync:one\nsource-id: "1"\nname: Old title\n---\nManual body',
		});
		const propertyMapping = { gameSyncId: 'logical-id', steamId: 'source-id', title: 'name' } as const;
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), propertyMapping, notesFolder: 'Games' });

		const plan = await planner.plan([game()], 'revision-custom');
		expect(plan.statuses[0]?.status).toBe('update');
		expect(plan.operations[0]?.path).toBe('Games/Custom.md');
	});

	it('marks two games resolving to one target path as conflicts without create operations', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const second = {
			...game(),
			canonicalId: 'game-sync:two',
			identity: { canonicalId: 'game-sync:two', steamAppId: 2 },
			providers: { steam: { ...game().providers.steam!, providerGameId: '2' } },
		};

		const plan = await planner.plan([game(), second], 'revision-collision');

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses.map((status) => status.status)).toEqual(['conflict', 'conflict']);
	});

	it('does not turn a correctly matched existing note into a collision conflict', async () => {
		const gateway = new FakeVaultGateway({
			'Games/One.md': '---\ngame-sync-id: game-sync:one\ntitle: Example Game\nsteam-id: "1"\n---\nManual body',
			'Games/Two.md': '---\ngame-sync-id: game-sync:two\ntitle: Example Game\nsteam-id: "2"\n---\nManual body',
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const second = {
			...game(),
			canonicalId: 'game-sync:two',
			identity: { canonicalId: 'game-sync:two', steamAppId: 2 },
			providers: { steam: { ...game().providers.steam!, providerGameId: '2' } },
		};

		const plan = await planner.plan([game(), second], 'revision-existing-collision');
		expect(plan.statuses[0]?.status).not.toBe('conflict');
		expect(plan.statuses[1]?.status).not.toBe('conflict');
	});

	it('conflicts unchanged and adopt/update assignments to the same matched note', async () => {
		const gateway = new FakeVaultGateway();
		const first = {
			...game(),
			identity: {
				...game().identity,
				playstation: { conceptId: 'concept-1', titleIds: ['title-1'], npCommunicationIds: ['comm-1'] },
			},
			providers: {
				...game().providers,
				playstation: { providerGameId: 'title-1', title: 'Example Game', developers: ['Studio'], publishers: [], genres: [], platforms: ['ps5'], owned: true, playtimeMinutes: 20, freshness: { metadata: true, ownership: true, playtime: true, achievements: true } },
			},
		};
		await new VaultWriter(gateway).createNote({ path: 'Games/Shared.md', game: first, expectedNoteFingerprint: null, updatedAt: '2026-09-12T12:00:00.000Z' });
		const second = {
			...first,
			canonicalId: 'game-sync:two',
			identity: { canonicalId: 'game-sync:two', playstation: first.identity.playstation },
			providers: { playstation: first.providers.playstation },
		};
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', propertyMapping: { gameSyncId: false } });

		const plan = await planner.plan([first, second], 'revision-unchanged-adopt');

		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses.map((status) => status.status)).toEqual(['conflict', 'conflict']);
	});

	it('conflicts operations targeting the same existing note after matching', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Shared.md': '---\nsteam-id: ["1", "2"]\ntitle: Shared\n---\nManual body',
		});
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games', filenamePattern: '{{title}}' });
		const first = { ...game(), title: 'Shared' };
		const second = {
			...first,
			canonicalId: 'game-sync:two',
			identity: { canonicalId: 'game-sync:two', steamAppId: 2 },
			providers: { steam: { ...first.providers.steam!, providerGameId: '2', title: 'Shared' } },
		};

		const plan = await planner.plan([first, second], 'revision-existing-shared');
		expect(plan.operations).toHaveLength(0);
		expect(plan.statuses.map((status) => status.status)).toEqual(['conflict', 'conflict']);
	});

	it('keeps an identical snapshot on the same deterministic plan revision', async () => {
		const gateway = new FakeVaultGateway();
		const planner = createSyncPlanner({ gateway, noteIndex: await buildNoteIndex(gateway), notesFolder: 'Games' });
		const first = await planner.plan([game()], 'revision-identical');
		const second = await planner.plan([game()], 'revision-identical');

		expect(second.id).toBe(first.id);
		expect(second.planRevision).toBe(first.planRevision);
	});
});
