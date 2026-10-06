import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { applyPrepared, createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot } from './fake-provider';

describe('existing-vault adoption', () => {
	it('adds managed provider data while retaining manual body and unmanaged frontmatter', async () => {
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Cyberpunk 2077')]));
		const { gateway, service } = await createIntegrationHarness({
			providers: [provider],
			initialFiles: {
				'Games/Cyberpunk 2077.md': '---\nsteam-id: "1"\ncustom: keep\n---\n# Manual body\n\nDo not rewrite',
			},
		});

		const prepared = await service.prepareAll();
		expect(prepared.plan.statuses[0]?.status).toBe('adopt');
		await applyPrepared(service, prepared);

		const content = await gateway.read('Games/Cyberpunk 2077.md');
		const parsed = parseFrontmatter(content);
		expect(parsed.frontmatter.custom).toBe('keep');
		expect(parsed.frontmatter['game-sync-id']).toEqual(expect.any(String));
		expect(parsed.frontmatter['steam-id']).toBe('1');
		expect(parsed.body).toBe('# Manual body\n\nDo not rewrite');
	});

	it('does not write when two plausible notes make adoption ambiguous', async () => {
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1', 'Example Game')]));
		const { gateway, service } = await createIntegrationHarness({
			providers: [provider],
			initialFiles: {
				'Games/One.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nOne',
				'Games/Two.md': '---\ntitle: Example Game\nreleased: 2024-01-01\n---\nTwo',
			},
		});

		const prepared = await service.prepareAll();
		const result = await service.applySelection(prepared, [], { explicit: true });

		expect(prepared.plan.statuses[0]?.status).toBe('conflict');
		expect(prepared.plan.operations).toHaveLength(0);
		expect(result.operationsApplied).toBe(0);
		expect(await gateway.read('Games/One.md')).toContain('\nOne');
		expect(await gateway.read('Games/Two.md')).toContain('\nTwo');
	});
});
