import { describe, expect, it } from 'vitest';
import { buildNoteIndex } from '../src/vault/note-index';
import { FakeVaultGateway } from './fake-gateway';

describe('rebuildable note index', () => {
	it('indexes game sync, provider identifiers and lower-confidence title candidates', async () => {
		const gateway = new FakeVaultGateway({
			'Games/Cyberpunk 2077.md': '---\ngame-sync-id: game-sync:one\nsteam-id: "1091500"\nplaystation-id: concept-1\ntitle: Cyberpunk 2077\n---\nBody',
		});
		const index = await buildNoteIndex(gateway);

		expect(index.findByGameSyncId('game-sync:one')?.path).toBe('Games/Cyberpunk 2077.md');
		expect(index.findBySteamId('1091500')?.path).toBe('Games/Cyberpunk 2077.md');
		expect(index.findByPlayStationIdentifier('concept-1')?.path).toBe('Games/Cyberpunk 2077.md');
		expect(index.findCandidates('cyberpunk 2077')[0]?.path).toBe('Games/Cyberpunk 2077.md');
	});
});
