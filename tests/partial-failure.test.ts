import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { applyPrepared, createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot, identityMappings } from './fake-provider';

describe('partial provider and achievement failures', () => {
	it('applies Steam changes while preserving existing PlayStation properties after PSN failure', async () => {
		const canonicalId = 'game-sync:shared';
		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game', { playtimeMinutes: 120 })]));
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [], {
			status: 'failed',
			error: { code: 'auth-failed', message: 'PlayStation unavailable.' },
		}));
		const { gateway, service } = await createIntegrationHarness({
			providers: [steam, playstation],
			initialFiles: {
				'Games/Example Game.md': '---\ngame-sync-id: game-sync:shared\ntitle: Example Game\nsteam-id: "1"\nsteam-playtime: 60\nplaystation-id: psn-1\nplaystation-playtime: 30\n---\nManual body',
			},
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]),
			},
		});

		const prepared = await service.prepareAll();
		const result = await applyPrepared(service, prepared);
		const frontmatter = parseFrontmatter(await gateway.read('Games/Example Game.md')).frontmatter;

		expect(prepared.providerStatuses.playstation?.state).toBe('failed');
		expect(prepared.providerStatuses.steam?.state).toBe('success');
		expect(result.operationsApplied).toBe(1);
		expect(frontmatter['steam-playtime']).toBe(120);
		expect(frontmatter['playstation-id']).toBe('psn-1');
		expect(frontmatter['playstation-playtime']).toBe(30);
	});

	it('updates playtime while retaining the managed achievement block when achievement data is partial', async () => {
		const game = fakeProviderGame('steam', '1', 'Example Game', {
			playtimeMinutes: 120,
			achievements: undefined,
			freshness: { metadata: true, ownership: true, playtime: true, achievements: false },
		});
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [game], {
			status: 'partial',
			error: { code: 'achievement-failed', message: 'Achievement request failed.' },
		}));
		const existingBlock = '%% game-sync:achievements %%\n\n## Steam achievements\n\n- [x] Existing achievement\n\n%% /game-sync:achievements %%';
		const { gateway, service } = await createIntegrationHarness({
			providers: [provider],
			initialFiles: {
				'Games/Example Game.md': `---\ngame-sync-id: game-sync:one\ntitle: Example Game\nsteam-id: "1"\nsteam-playtime: 60\nsteam-achievements-earned: 1\nsteam-achievements-total: 2\n---\nManual body\n\n${existingBlock}`,
			},
			state: {
				settings: { firstSyncCompleted: true },
				identityMappings: identityMappings(['steam', '1', 'game-sync:one']),
			},
		});

		const prepared = await service.prepareAll();
		const result = await applyPrepared(service, prepared);
		const content = await gateway.read('Games/Example Game.md');
		const frontmatter = parseFrontmatter(content).frontmatter;

		expect(prepared.providerStatuses.steam?.state).toBe('partial');
		expect(result.operationsApplied).toBe(1);
		expect(frontmatter['steam-playtime']).toBe(120);
		expect(frontmatter['steam-achievements-earned']).toBe(1);
		expect(content).toContain(existingBlock);
	});
});
