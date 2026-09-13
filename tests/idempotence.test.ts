import { describe, expect, it } from 'vitest';
import { migrateState } from '../src/state/migrations';
import { parseFrontmatter } from '../src/vault/frontmatter';
import { applyPrepared, createIntegrationHarness, FakeProvider, fakeProviderGame, fakeProviderSnapshot, identityMappings } from './fake-provider';

describe('sync lifecycle semantics', () => {
	it('leaves unchecked operations pending for the next sync', async () => {
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1')]));
		const first = await createIntegrationHarness({ providers: [provider] });
		const prepared = await first.service.prepareAll();
		const skipped = await first.service.applySelection(prepared, [], { explicit: true });

		expect(skipped.operationsApplied).toBe(0);
		expect(skipped.pendingOperationIds).toEqual(prepared.plan.operations.map((operation) => operation.id));

		const next = await first.service.prepareAll();
		expect(next.plan.operations.map((operation) => operation.id)).toEqual(prepared.plan.operations.map((operation) => operation.id));
	});

	it('is idempotent and supports ignore then restore', async () => {
		const provider = new FakeProvider(fakeProviderSnapshot('steam', [fakeProviderGame('steam', '1')]));
		const first = await createIntegrationHarness({ providers: [provider] });
		const initial = await first.service.prepareAll();
		const firstApply = await applyPrepared(first.service, initial);
		const second = await first.service.prepareAll();
		const secondApply = await applyPrepared(first.service, second);

		expect(firstApply.operationsApplied).toBe(1);
		expect(second.plan.operations).toHaveLength(0);
		expect(secondApply.operationsApplied).toBe(0);

		const canonicalId = 'game-sync:ignored';
		const ignored = await createIntegrationHarness({
			providers: [provider],
			state: migrateState({
				identityMappings: identityMappings(['steam', '1', canonicalId]),
				ignoredCanonicalIds: [canonicalId],
			}),
		});
		const ignoredPrepared = await ignored.service.prepareAll();
		expect(ignoredPrepared.ignored).toBe(1);
		expect(ignoredPrepared.plan.operations).toHaveLength(0);

		const restored = await createIntegrationHarness({
			providers: [provider],
			state: migrateState({
				identityMappings: identityMappings(['steam', '1', canonicalId]),
				ignoredCanonicalIds: [],
			}),
		});
		const restoredPrepared = await restored.service.prepareAll();
		expect(restoredPrepared.plan.operations).toHaveLength(1);
		await applyPrepared(restored.service, restoredPrepared);
		expect(parseFrontmatter(await restored.gateway.read('Games/Example Game.md')).frontmatter['game-sync-id']).toBe(canonicalId);
	});
});
