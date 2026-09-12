import { describe, expect, it } from 'vitest';
import { VaultConflictError } from '../src/network/errors';
import { buildTemplateContext } from '../src/vault/template';
import { VaultWriter } from '../src/vault/writer';
import { noteFingerprint } from '../src/vault/gateway';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { FakeVaultGateway } from './fake-gateway';
import type { NormalizedGame } from '../src/model/game';

const game: NormalizedGame = {
	identity: { canonicalId: 'game-sync:one', steamAppId: 1 },
	canonicalId: 'game-sync:one',
	title: 'New title',
	developers: [],
	publishers: [],
	genres: [],
	platforms: ['pc'],
	providers: {
		steam: {
			providerGameId: '1', title: 'New title', developers: [], publishers: [], genres: [], platforms: ['pc'],
			owned: true, freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		},
	},
	owned: true,
	acquisitionType: 'unknown',
	playtimeMinutes: 0,
};

describe('safe vault writer', () => {
	it('executes the template only when creating a note', async () => {
		const gateway = new FakeVaultGateway();
		const writer = new VaultWriter(gateway, { template: '# {{title}}\n\nCreated body' });
		await writer.createNote({ path: 'Games/one.md', game, expectedNoteFingerprint: null, updatedAt: '2026-09-12T00:00:00.000Z' });
		expect(await gateway.read('Games/one.md')).toContain('# New title');

		await writer.adoptNote({ path: 'Games/one.md', game: { ...game, title: 'Changed title' }, expectedNoteFingerprint: noteFingerprint(await gateway.read('Games/one.md')), updatedAt: '2026-09-12T00:00:00.000Z' });
		const adopted = await gateway.read('Games/one.md');
		expect(adopted).toContain('Created body');
		expect(adopted).not.toContain('# Changed title');
	});

	it('updates only managed areas and preserves body, filename and unmanaged frontmatter', async () => {
		const initial = '---\nstatus: playing\ncustom: keep\ntitle: Old title\n---\n# User body\n\nDo not touch';
		const gateway = new FakeVaultGateway({ 'Games/old-name.md': initial });
		const writer = new VaultWriter(gateway);
		await writer.updateNote({ path: 'Games/old-name.md', game, expectedNoteFingerprint: noteFingerprint(initial), updatedAt: '2026-09-12T00:00:00.000Z' });

		const updated = await gateway.read('Games/old-name.md');
		expect(parseFrontmatter(updated).frontmatter).toMatchObject({ status: 'playing', custom: 'keep', title: 'New title' });
		expect(parseFrontmatter(updated).body).toBe('# User body\n\nDo not touch');
		expect(await gateway.listMarkdownFiles()).toHaveLength(1);
		expect(gateway.frontMatterProcessCount).toBe(1);
	});

	it('rechecks the fingerprint before the separate managed-block process', async () => {
		const initial = '---\nstatus: playing\n---\n%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%';
		const gateway = new FakeVaultGateway({ 'Games/one.md': initial });
		const writer = new VaultWriter(gateway);
		gateway.beforeProcess = () => {
			gateway.beforeProcess = undefined;
			gateway.set('Games/one.md', `${initial}\nuser edit`);
		};

		await expect(writer.updateNote({ path: 'Games/one.md', game, expectedNoteFingerprint: noteFingerprint(initial), updatedAt: '2026-09-12T00:00:00.000Z' })).rejects.toThrow(/rollback is unsafe/i);
		expect(await gateway.read('Games/one.md')).toContain('user edit');
	});

	it('preserves an existing achievement block when achievement freshness is incomplete', async () => {
		const initial = '---\nstatus: playing\ntitle: Old title\nsteam-achievements-earned: 9\n---\n%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%';
		const gateway = new FakeVaultGateway({ 'Games/one.md': initial });
		const staleAchievementsGame = {
			...game,
			providers: {
				steam: {
					...game.providers.steam!,
					freshness: { ...game.providers.steam!.freshness, achievements: false },
					achievements: { earned: 1, total: 2, progress: 50, achievements: [{ id: 'new', name: 'New', unlocked: true, hidden: false }] },
				},
			},
		};
		const writer = new VaultWriter(gateway);

		await writer.updateNote({ path: 'Games/one.md', game: staleAchievementsGame, expectedNoteFingerprint: noteFingerprint(initial), updatedAt: '2026-09-12T00:00:00.000Z' });
		const updated = await gateway.read('Games/one.md');
		expect(updated).toContain('\nold\n');
		expect(updated).not.toContain('- [x] New');
		expect(parseFrontmatter(updated).frontmatter['steam-achievements-earned']).toBe(9);
	});

	it('rolls back managed Properties and the block after a second-stage failure', async () => {
		const initial = '---\nstatus: playing\ntitle: Old title\nsteam-achievements-earned: 9\n---\n%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%';
		const gateway = new FakeVaultGateway({ 'Games/one.md': initial });
		gateway.failProcessBeforeUpdate = new Error('managed block write failed');
		const writer = new VaultWriter(gateway);

		await expect(writer.updateNote({ path: 'Games/one.md', game: { ...game, title: 'New title', providers: { steam: { ...game.providers.steam!, freshness: { ...game.providers.steam!.freshness, achievements: true }, achievements: { earned: 1, total: 1, progress: 100, achievements: [{ id: 'new', name: 'New', unlocked: true, hidden: false }] } } } }, expectedNoteFingerprint: noteFingerprint(initial), updatedAt: '2026-09-12T00:00:00.000Z' })).rejects.toThrow('managed block write failed');
		const recovered = await gateway.read('Games/one.md');
		expect(parseFrontmatter(recovered).frontmatter.title).toBe('Old title');
		expect(parseFrontmatter(recovered).frontmatter['steam-achievements-earned']).toBe(9);
		expect(recovered).toContain('\nold\n');
		expect(recovered).not.toContain('- [x] New');
	});

	it('rejects stale previews and duplicate achievement blocks before writing', async () => {
		const initial = '---\nstatus: playing\n---\nBody';
		const gateway = new FakeVaultGateway({ 'Games/one.md': initial });
		const writer = new VaultWriter(gateway, { template: '# {{title}}' });
		gateway.set('Games/one.md', `${initial}\nChanged`);
		await expect(writer.updateNote({ path: 'Games/one.md', game, expectedNoteFingerprint: noteFingerprint(initial), updatedAt: '2026-09-12T00:00:00.000Z' })).rejects.toThrow(/stale/i);

		const duplicate = '%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%\n\n%% game-sync:achievements %%\nold\n%% /game-sync:achievements %%';
		gateway.set('Games/one.md', duplicate);
		const fingerprint = noteFingerprint(duplicate);
		await expect(writer.updateNote({ path: 'Games/one.md', game, expectedNoteFingerprint: fingerprint, updatedAt: '2026-09-12T00:00:00.000Z' })).rejects.toThrow(VaultConflictError);
		expect(await gateway.read('Games/one.md')).toBe(duplicate);
	});

	it('requires an explicit expected fingerprint for every existing-note mutation', async () => {
		const gateway = new FakeVaultGateway({ 'Games/one.md': '# One' });
		const writer = new VaultWriter(gateway);
		await expect(writer.adoptNote({ path: 'Games/one.md', game, expectedNoteFingerprint: '', updatedAt: '2026-09-12T00:00:00.000Z' })).rejects.toThrow(/fingerprint/i);
	});

	it('does not depend on template context property names for managed Properties', () => {
		expect(buildTemplateContext(game).title).toBe('New title');
	});
});
