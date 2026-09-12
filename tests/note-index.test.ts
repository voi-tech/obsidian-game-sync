import { describe, expect, it } from 'vitest';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';

describe('rebuildable note index', () => {
	it('indexes game sync, provider identifiers and lower-confidence title candidates', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Cyberpunk 2077.md': '---\ngame-sync-id: game-sync:one\nsteam-id: "1091500"\nplaystation-id: concept-1\ntitle: Cyberpunk 2077\n---\nBody',
			'Games/Cyberpunk 2077 (copy).md': '---\ngame-sync-id: game-sync:two\nsteam-id: "1091500"\ntitle: Other title\n---\nBody',
			'Games/Untitled.md': '---\ntitle: Mapped title\n---\nBody',
		});
		const index = await buildNoteIndex(gateway);

		expect(index.findByGameSyncId('game-sync:one').map((note) => note.path)).toEqual(['Games/Cyberpunk 2077.md']);
		expect(index.findBySteamId('1091500').map((note) => note.path)).toEqual(['Games/Cyberpunk 2077 (copy).md', 'Games/Cyberpunk 2077.md']);
		expect(index.findByPlayStationIdentifier('concept-1').map((note) => note.path)).toEqual(['Games/Cyberpunk 2077.md']);
		expect(index.findCandidates('cyberpunk 2077').map((note) => note.path)).toEqual(['Games/Cyberpunk 2077.md']);
		expect(index.findCandidates('untitled').map((note) => note.path)).toEqual(['Games/Untitled.md']);
	});
});
