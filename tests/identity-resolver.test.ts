import { describe, expect, it } from 'vitest';
import {
	addNegativeMapping,
	addPositiveMapping,
	areKeptSeparate,
	createKeepSeparateOperation,
	createPositiveMappingOperation,
	findCanonicalId,
	type IdentityMappingState,
} from '../src/identity/mappings';
import { createCanonicalGameId, createIdentityResolver } from '../src/identity/resolver';

const emptyState: IdentityMappingState = { identityMappings: [], negativeMappings: [] };

describe('durable identity resolver', () => {
	it('uses an injectable ID factory and does not derive IDs from title metadata', () => {
		expect(createCanonicalGameId(() => 'canonical-test-1')).toBe('canonical-test-1');
		expect(createCanonicalGameId(() => 'canonical-test-2')).not.toBe(createCanonicalGameId(() => 'canonical-test-1'));
	});

	it('resolves positive provider mappings without mutating the input state', () => {
		const mapping = { canonicalId: 'canonical-1', provider: 'steam' as const, providerGameId: '10' };
		const next = addPositiveMapping(emptyState, mapping);

		expect(findCanonicalId(next, { provider: 'steam', providerGameId: '10' })).toBe('canonical-1');
		expect(emptyState.identityMappings).toEqual([]);
		expect(createPositiveMappingOperation(mapping)).toEqual({ kind: 'add-positive', mapping });
	});

	it('stores Keep separate pairs as unordered durable mappings', () => {
		const next = addNegativeMapping(emptyState, 'canonical-b', 'canonical-a');

		expect(areKeptSeparate(next, 'canonical-a', 'canonical-b')).toBe(true);
		expect(areKeptSeparate(next, 'canonical-b', 'canonical-a')).toBe(true);
		expect(createKeepSeparateOperation('canonical-a', 'canonical-b')).toEqual({
			kind: 'keep-separate',
			mapping: { leftCanonicalId: 'canonical-a', rightCanonicalId: 'canonical-b' },
		});
	});

	it('suppresses future suggestions for a previously separated pair', () => {
		const resolver = createIdentityResolver({
			mappings: addNegativeMapping(emptyState, 'canonical-a', 'canonical-b'),
			idFactory: () => 'canonical-a',
		});
		const result = resolver.resolve(
			{ canonicalId: 'canonical-a', provider: 'steam', providerGameId: '10', title: 'Example Game', year: 2020 },
			[{ canonicalId: 'canonical-b', provider: 'playstation', providerGameId: 'concept-10', title: 'Example Game', year: 2020 }],
		);

		expect(result.suggestions).toEqual([]);
	});

	it('normalizes a reversed keep-separate operation before storing it', () => {
		const resolver = createIdentityResolver();
		resolver.apply({
			kind: 'keep-separate',
			mapping: { leftCanonicalId: 'canonical-b', rightCanonicalId: 'canonical-a' },
		});

		expect(areKeptSeparate(resolver.getMappings(), 'canonical-a', 'canonical-b')).toBe(true);
		expect(resolver.getMappings().negativeMappings).toEqual([
			{ leftCanonicalId: 'canonical-a', rightCanonicalId: 'canonical-b' },
		]);
	});

	it('never auto-merges existing candidate notes when another provider or metadata appears', () => {
		const ids = ['canonical-new', 'canonical-second'];
		const resolver = createIdentityResolver({ idFactory: () => ids.shift() ?? 'canonical-fallback' });
		const first = resolver.resolve({ provider: 'steam', providerGameId: '10', title: 'Example Game', year: 2020 });
		const second = resolver.resolve(
			{ provider: 'playstation', providerGameId: 'concept-10', title: 'Example Game', year: 2020 },
			[{ canonicalId: first.canonicalId, provider: 'steam', providerGameId: '10', title: 'Example Game', year: 2020 }],
		);

		expect(first.canonicalId).toBe('canonical-new');
		expect(second.canonicalId).not.toBe(first.canonicalId);
		expect(second.suggestions[0]?.canonicalId).toBe(first.canonicalId);
		expect(second.operation).toBeUndefined();
	});
});
