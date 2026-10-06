import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { applyPrepared, createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot, identityMappings } from './fake-provider';

describe('fake-provider sync integration', () => {
	it('creates one canonical note with both provider properties', async () => {
		const canonicalId = 'game-sync:shared';
		const steam = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game')]));
		const playstation = new FakeProvider(fakeProviderSnapshot('playstation', [fakeProviderGame('playstation', 'psn-1', 'Example Game')]));
		const { gateway, service } = await createIntegrationHarness({
			providers: [steam, playstation],
			state: { identityMappings: identityMappings(['steam', '1', canonicalId], ['playstation', 'psn-1', canonicalId]) },
		});

		const prepared = await service.prepareAll();
		const result = await applyPrepared(service, prepared);
		const content = await gateway.read('Games/Example Game.md');
		const frontmatter = parseFrontmatter(content).frontmatter;

		expect(prepared.games).toHaveLength(1);
		expect(result.operationsApplied).toBe(1);
		expect(frontmatter['game-sync-id']).toBe(canonicalId);
		expect(frontmatter['providers']).toEqual(['steam', 'playstation']);
		expect(frontmatter['steam-id']).toBe('1');
		 expect(frontmatter['playstation-id']).toBe('psn-1');
	});

	it('requires two complete missing snapshots before reducing ownership', async () => {
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1')]));
		const { service } = await createIntegrationHarness({ providers: [provider] });

		const initial = await service.prepareAll();
		await applyPrepared(service, initial);

		provider.snapshot = fakeProviderSnapshot('steam', [], { status: 'partial' });
		const partial = await service.prepareAll();
		await applyPrepared(service, partial);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(0);

		provider.snapshot = fakeProviderSnapshot('steam', []);
		const firstMissing = await service.prepareAll();
		await applyPrepared(service, firstMissing);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(1);

		provider.snapshot = fakeProviderSnapshot('steam', [], { status: 'failed' });
		const failed = await service.prepareAll();
		await applyPrepared(service, failed);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(1);

		provider.snapshot = fakeProviderSnapshot('steam', []);
		const secondMissing = await service.prepareAll();
		await applyPrepared(service, secondMissing);
		expect((await service.getState()).presence[0]?.consecutiveMissing).toBe(2);
		expect(secondMissing.games[0]?.owned).toBe(false);
	});
});
