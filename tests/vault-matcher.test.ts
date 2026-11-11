import { describe, expect, it } from 'vitest';
import { matchVaultNote } from '../src/vault/matcher';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';
import type { NormalizedGame } from '../src/model/game';

const game: NormalizedGame = {
	identity: { canonicalId: 'game-sync:one', steamAppId: 1 },
	canonicalId: 'game-sync:one', title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'],
	providers: { steam: { providerGameId: '1', title: 'Example Game', releaseDate: '2024-01-01', developers: ['Studio'], publishers: [], genres: [], platforms: ['pc'], freshness: { metadata: true, ownership: true, playtime: true, achievements: true } } },
	owned: true, acquisitionType: 'unknown', playtimeMinutes: 0,
};

describe('vault note matcher', () => {
	it('never offers notes outside the games folder as title guesses, but still honours stable IDs anywhere', async () => {
		const gateway = new FakeVaultGateway({
			'resources/filmy/Example Game (2024).md': '---\naliases: "Example Game"\nreleased: 2024\n---\nfilm',
			'resources/books/Example Game.md': '---\ntitle: Example Game\n---\nbook',
		});
		const guess = matchVaultNote(game, await buildNoteIndex(gateway), { candidateFolder: 'Games' });
		expect(guess.status).toBe('none');

		const withId = new FakeVaultGateway({ 'archive/Old.md': '---\nsteam-id: "1"\n---\nold game note' });
		const byId = matchVaultNote(game, await buildNoteIndex(withId), { candidateFolder: 'Games' });
		expect(byId.status).toBe('matched');
		expect(byId.note?.path).toBe('archive/Old.md');
	});

	it('prioritizes provider IDs over a filename candidate', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\n---\nfilename note',
			'Games/Other.md': '---\nsteam-id: "1"\ntitle: Other\n---\nprovider note',
		});
		const match = matchVaultNote(game, await buildNoteIndex(gateway), { targetPath: 'Games/Example Game.md' });

		expect(match.status).toBe('matched');
		expect(match.method).toBe('provider-id');
		expect(match.note?.path).toBe('Games/Other.md');
	});

	it('returns conflict when one provider ID points to two notes', async () => {
		const gateway = new FakeVaultGateway({
			'Games/One.md': '---\nsteam-id: "1"\n---\nOne',
			'Games/Two.md': '---\nsteam-id: "1"\n---\nTwo',
		});
		const match = matchVaultNote(game, await buildNoteIndex(gateway));

		expect(match.status).toBe('conflict');
		expect(match.candidates.map((note) => note.path)).toEqual(['Games/One.md', 'Games/Two.md']);
	});

	it('uses game-sync-id before an exact filename candidate', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Example Game.md': '---\ntitle: Example Game\n---\nfilename note',
			'Games/Canonical.md': '---\ngame-sync-id: game-sync:one\n---\ncanonical note',
		});
		const match = matchVaultNote(game, await buildNoteIndex(gateway), { targetPath: 'Games/Example Game.md' });

		expect(match.method).toBe('game-sync-id');
		expect(match.note?.path).toBe('Games/Canonical.md');
	});

	it('conflicts when a provider ID points to another game-sync-id, even beside the correct candidate', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Canonical.md': '---\ngame-sync-id: game-sync:one\nsteam-id: "2"\n---\ncanonical note',
			'Games/Other.md': '---\ngame-sync-id: game-sync:other\nsteam-id: "1"\n---\nconflicting provider note',
		});
		const match = matchVaultNote(game, await buildNoteIndex(gateway));

		expect(match.status).toBe('conflict');
		expect(match.note).toBeUndefined();
	});
});
